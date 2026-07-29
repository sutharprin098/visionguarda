"""Asynchronous helmet worker — rider helmet inference off the tracking thread.

Why
---
The helmet net is a second full model run on rider crops, and it was executing
inline inside the tracking stage. Measured on a live camera: a tracking
iteration cost ~25ms on a plain frame and ~850ms on one that also ran the
helmet pass, so the tracking stage alternated between ~25 FPS and ~1 FPS.

That is not merely slow, it is a correctness problem for tracking. A tracker
associates detections to tracks using motion prediction over the interval
between iterations; an interval that swings by 30x makes the object's
between-iteration displacement swing by the same factor. The tracker's
prediction then lands nowhere near the object's real position on the stalled
iterations, association fails, and a NEW id is minted for an object already
being tracked. On a live camera this produced ~16 new ids in 22 seconds on a
scene holding only 12 objects.

The tracker has since been made time-aware, so it survives an irregular cadence
rather than churning ids through it (see ByteTracker). This worker removes the
irregularity itself: the pipeline SUBMITS a frame and returns immediately, and
overlays whatever the worker has most recently published. Tracking cadence is
therefore independent of helmet cost by construction — a slow helmet pass
lowers helmet cadence and nothing else.

Mirrors app/ai/plate_worker.py, which did the same thing for ANPR; queue policy
is likewise drop-oldest with depth 1, because when the worker is busy the right
frame to process is the freshest one, not a backlog of stale ones. Dropping is
cheap here: a rider's helmet does not change between frames, and results carry
a TTL slightly longer than the submit cadence so boxes persist between passes
instead of flickering, and expire rather than going stale if the worker dies.
"""
from __future__ import annotations

import copy
import threading
import time
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from app import config
from app.ai import helmet as helmet_detect


class HelmetWorker:
    """One per camera pipeline. Thread-safe; `submit` and `latest` are called
    from the pipeline thread, everything else runs on the worker thread."""

    def __init__(self, camera_id: str = "") -> None:
        self.camera_id = camera_id
        self.last_error: Optional[str] = None
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
        self._thread = threading.Thread(target=self._loop, name=f"helmet-{self.camera_id}",
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
    def submit(self, frame: np.ndarray, motorcycle_boxes: Sequence[Dict[str, float]],
               person_boxes: Sequence[Dict[str, float]], confidence: float) -> bool:
        """Hand a frame to the worker. Never blocks. Returns False if there was
        nothing to do, or the frame was dropped because a job was pending.

        A frame with no motorcycle costs nothing at all — the helmet model only
        ever looks at rider crops, so there is no job to queue."""
        if self._stop.is_set() or not motorcycle_boxes:
            return False
        # The pipeline reuses its frame buffers, so the worker must own a copy;
        # otherwise it would read a frame already overwritten by capture.
        job = {
            "frame": frame.copy(),
            "moto": [dict(b) for b in motorcycle_boxes],
            "person": [dict(b) for b in person_boxes],
            "conf": float(confidence),
            "t": time.time(),
        }
        with self._job_lock:
            if self._job is not None:
                self.dropped += 1
            self._job = job          # drop-oldest: the newest frame wins
        self._wake.set()
        return True

    def latest(self) -> List[Dict[str, Any]]:
        """Most recently published helmet detections, or [] once they go stale.
        Returns deep copies — the pipeline mutates detections (track ids,
        profile filters) and must not corrupt the worker's state."""
        ttl = float(config.HELMET_RESULT_TTL_S)
        with self._results_lock:
            if not self._results or (time.time() - self._results_at) > ttl:
                return []
            return [copy.deepcopy(d) for d in self._results]

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
                print(f"[helmet] worker error on camera {self.camera_id}: {e}", flush=True)

    def _process(self, job: Dict[str, Any]) -> None:
        t0 = time.perf_counter()
        hd = helmet_detect.get_detector(job["conf"])
        if hd is None:
            # Model globally disabled or missing. Publish emptiness rather than
            # leaving the previous results to age out, so the overlay reflects
            # "no helmet data" instead of a frozen last-known answer.
            with self._results_lock:
                self._results, self._results_at = [], time.time()
            return
        dets = hd.detect_on_riders(job["frame"], job["moto"], job["person"])
        if hd.last_error:
            self.last_error = hd.last_error
            hd.last_error = None

        self.passes += 1
        self.last_pass_ms = (time.perf_counter() - t0) * 1000.0
        with self._results_lock:
            self._results = dets
            self._results_at = time.time()
