"""ANPR debug mode — the evidence chain for "why was THAT plate not read?".

When `CAMAI_ANPR_DEBUG=1`, every attempt writes the whole chain to
`ANPR_DEBUG_DIR/<camera>/<timestamp>_<seq>/`:

    frame.jpg              the full source frame
    vehicle.jpg            the vehicle crop the plate detector ran on
    plate.jpg              the gated plate crop, as cut from the frame
    enhanced_<variant>.png each preprocessed tensor actually fed to the OCR
    attempt.json           text, confidences, geometry, timings, failure reason

and appends one row per attempt to `ANPR_DEBUG_DIR/attempts.jsonl` so a whole
session can be analysed without walking the directory tree.

Everything here is best-effort and swallows its own errors: debugging must
never be able to break the pipeline it is instrumenting. It is also bounded —
`ANPR_DEBUG_MAX_ATTEMPTS` caps how many attempt directories a process writes,
because a session accidentally left in debug mode would otherwise fill the disk.
By default only FAILED attempts are written, which is the case anyone turns
debug mode on to look at.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Dict, Optional

import cv2
import numpy as np

from app import config

_seq = 0
_written = 0
_lock = threading.Lock()
_jsonl_path: Optional[str] = None


def enabled() -> bool:
    return bool(config.ANPR_DEBUG)


def _next_seq() -> int:
    global _seq
    with _lock:
        _seq += 1
        return _seq


def _budget_ok() -> bool:
    global _written
    with _lock:
        if _written >= int(config.ANPR_DEBUG_MAX_ATTEMPTS):
            return False
        _written += 1
        return True


def _safe_write(path: str, img: Optional[np.ndarray]) -> None:
    if img is None or getattr(img, "size", 0) == 0:
        return
    try:
        cv2.imwrite(path, img)
    except Exception:
        pass


def record(camera_id: str,
           frame: Optional[np.ndarray],
           vehicle_crop: Optional[np.ndarray],
           plate_crop: Optional[np.ndarray],
           artifacts: Optional[Dict[str, np.ndarray]],
           info: Dict[str, Any]) -> Optional[str]:
    """Persist one ANPR attempt. Returns the directory written, or None.

    `artifacts` is the dict `PlateOCR.read_detailed` filled with its
    intermediate images — this module is the only thing that knows they go to
    disk, so the OCR stage stays free of I/O.
    """
    if not enabled():
        return None
    ok = bool(info.get("text"))
    if ok and not config.ANPR_DEBUG_SAVE_SUCCESS:
        return None
    if not _budget_ok():
        return None

    try:
        seq = _next_seq()
        stamp = time.strftime("%Y%m%d-%H%M%S")
        safe_cam = "".join(c if c.isalnum() or c in "-_" else "_" for c in str(camera_id))
        root = os.path.join(str(config.ANPR_DEBUG_DIR), safe_cam, f"{stamp}_{seq:05d}")
        os.makedirs(root, exist_ok=True)

        _safe_write(os.path.join(root, "frame.jpg"), frame)
        _safe_write(os.path.join(root, "vehicle.jpg"), vehicle_crop)
        _safe_write(os.path.join(root, "plate.jpg"), plate_crop)
        for name, img in (artifacts or {}).items():
            _safe_write(os.path.join(root, f"enhanced_{name}.png"), img)

        row = dict(info)
        row.update({"camera_id": camera_id, "seq": seq, "dir": root,
                    "ts": time.time(), "ts_iso": time.strftime("%Y-%m-%dT%H:%M:%S")})
        with open(os.path.join(root, "attempt.json"), "w", encoding="utf-8") as fh:
            json.dump(row, fh, indent=2, default=str)

        global _jsonl_path
        if _jsonl_path is None:
            os.makedirs(str(config.ANPR_DEBUG_DIR), exist_ok=True)
            _jsonl_path = os.path.join(str(config.ANPR_DEBUG_DIR), "attempts.jsonl")
        with _lock:
            with open(_jsonl_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(row, default=str) + "\n")
        return root
    except Exception as e:                     # never break the pipeline
        print(f"[anpr-debug] could not write attempt: {e}", flush=True)
        return None


def log_failure(camera_id: str, reason: str, detail: str = "") -> None:
    """One-line reason log for the cases that never reach an OCR attempt —
    no vehicle in frame, no plate on the vehicle, plate below the size gate.
    Cheap enough to leave on whenever debug mode is on."""
    if not enabled():
        return
    print(f"[anpr-debug] cam={camera_id} {reason}"
          f"{(' | ' + detail) if detail else ''}", flush=True)


def summary() -> Dict[str, Any]:
    return {"enabled": enabled(), "attempts_written": _written,
            "budget": int(config.ANPR_DEBUG_MAX_ATTEMPTS),
            "dir": str(config.ANPR_DEBUG_DIR), "jsonl": _jsonl_path}
