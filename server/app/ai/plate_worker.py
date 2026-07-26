"""Asynchronous ANPR worker — plate detection + OCR off the capture thread.

Why
---
ANPR is by far the heaviest pass in the pipeline: a detector inference per
vehicle crop, then up to a few recogniser inferences per plate. Run inline it
dominated the loop — the previous code had to throttle it to once per second
just to keep the pipeline moving, and even then a busy frame stalled tracking.

This worker inverts that. The pipeline SUBMITS a frame and returns immediately;
the worker publishes results when it has them, and the pipeline overlays
whatever is currently published. FPS is therefore independent of ANPR cost by
construction — a slow OCR pass lowers ANPR cadence and nothing else.

Queue policy is drop-oldest with depth 1 (`ANPR_QUEUE_MAX`): when the worker is
busy, the right thing is to process the FRESHEST frame, not to build a backlog
of stale ones. A dropped frame costs nothing because plates are read across
many frames and voted on (app/ai/plate_track.py).

Published results carry a TTL (`ANPR_RESULT_TTL_S`) slightly longer than the
submit cadence, so plate boxes stay on the overlay between passes instead of
flickering, and disappear rather than going stale if the worker dies.
"""
from __future__ import annotations

import copy
import threading
import time
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app import config
from app.ai import plate as plate_detect
from app.ai import plate_track


class AnprWorker:
    """One per camera pipeline. Thread-safe; `submit` and `latest` are called
    from the pipeline thread, everything else runs on the worker thread."""

    def __init__(self, camera_id: str = "") -> None:
        self.camera_id = camera_id
        self.tracker = plate_track.PlateTracker()
        self.last_error: Optional[str] = None
        self.last_reason: Optional[str] = None
        self.last_pass_ms: float = 0.0
        self.passes: int = 0
        self.dropped: int = 0

        self._job: Optional[Dict[str, Any]] = None
        self._job_lock = threading.Lock()
        self._wake = threading.Event()
        self._results: List[Dict[str, Any]] = []
        self._results_at: float = 0.0
        self._results_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -- lifecycle ----------------------------------------------------------
    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name=f"anpr-{self.camera_id}",
                                        daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop.set()
        self._wake.set()
        t = self._thread
        if t is not None and t.is_alive():
            t.join(timeout=timeout)
        self._thread = None

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    # -- pipeline-side API --------------------------------------------------
    def submit(self, frame: np.ndarray, vehicle_boxes: Sequence[Dict[str, float]],
               track_ids: Sequence[Optional[int]], confidence: float) -> bool:
        """Hand a frame to the worker. Never blocks. Returns False if the frame
        was dropped because a job was already pending."""
        if self._stop.is_set() or not vehicle_boxes:
            return False
        # The pipeline reuses its frame buffers, so the worker must own a copy;
        # otherwise it would read a frame that has already been overwritten.
        job = {
            "frame": frame.copy(),
            "boxes": [dict(b) for b in vehicle_boxes],
            "track_ids": list(track_ids),
            "conf": float(confidence),
            "t": time.time(),
        }
        with self._job_lock:
            if self._job is not None:
                self.dropped += 1
                if int(config.ANPR_QUEUE_MAX) <= 1:
                    self._job = job          # drop-oldest: newest frame wins
                    self._wake.set()
                    return True
                return False
            self._job = job
        self._wake.set()
        return True

    def latest(self) -> List[Dict[str, Any]]:
        """Most recently published plate detections, or [] once they go stale.
        Returns deep copies — the pipeline mutates detections (adds track ids,
        applies profile filters) and must not corrupt the worker's state."""
        ttl = float(config.ANPR_RESULT_TTL_S)
        with self._results_lock:
            if not self._results or (time.time() - self._results_at) > ttl:
                return []
            return [copy.deepcopy(d) for d in self._results]

    def settled_track_ids(self) -> set:
        """Vehicle tracks whose plate is already decided — the caller skips
        them, which is where the "avoid unnecessary OCR calls" saving comes
        from on scenes with standing traffic."""
        out = set()
        for row in self.tracker.snapshot():
            tid = row.get("track_id")
            if tid is not None and self.tracker.is_settled(tid):
                out.add(tid)
        return out

    # -- worker thread ------------------------------------------------------
    def _loop(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(timeout=0.5)
            self._wake.clear()
            if self._stop.is_set():
                break
            with self._job_lock:
                job, self._job = self._job, None
            if job is None:
                continue
            try:
                self._process(job)
            except Exception as e:              # a worker must never die
                self.last_error = str(e)
                print(f"[anpr] worker error on camera {self.camera_id}: {e}", flush=True)

    def _process(self, job: Dict[str, Any]) -> None:
        t0 = time.perf_counter()
        pd = plate_detect.get_detector(job["conf"])
        if pd is None:
            return
        dets = pd.detect_on_vehicles(
            job["frame"], job["boxes"],
            camera_id=self.camera_id,
            track_ids=job["track_ids"],
            skip_track_ids=self.settled_track_ids(),
        )
        if pd.last_error:
            self.last_error = pd.last_error
            pd.last_error = None
        self.last_reason = pd.last_reason

        now = time.time()
        # Feed every read into the per-track vote, then REPLACE each detection's
        # text with the track's current winner. A single frame's read is the
        # weakest evidence available; the voted answer is what should reach the
        # overlay, the event log and the operator.
        for d in dets:
            tid = d.get("vehicle_track_id")
            if tid is None:
                continue
            if d.get("plate_text"):
                self.tracker.observe(tid, d["plate_text"],
                                     float(d.get("plate_text_confidence") or 0.0),
                                     bool(d.get("plate_valid_format")), now)
            elif d.get("plate_failure"):
                self.tracker.observe_failure(tid, d["plate_failure"], now)
            best = self.tracker.best(tid)
            if best:
                text, conf, reads = best
                d["plate_text"] = text
                d["plate_text_confidence"] = round(conf, 3)
                d["plate_reads"] = reads
                d["plate_failure"] = None
        self.tracker.prune(now)

        with self._results_lock:
            self._results = dets
            self._results_at = now
        self.passes += 1
        self.last_pass_ms = (time.perf_counter() - t0) * 1000

    # -- telemetry ----------------------------------------------------------
    def stats(self) -> Dict[str, Any]:
        s = dict(self.tracker.stats())
        s.update({"passes": self.passes, "dropped_frames": self.dropped,
                  "last_pass_ms": round(self.last_pass_ms, 1),
                  "running": self.is_running(),
                  "last_failure_reason": self.last_reason,
                  "last_error": self.last_error})
        return s
