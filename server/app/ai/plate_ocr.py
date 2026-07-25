"""ANPR OCR stage — reads the characters off a gated plate crop with a CRNN
(OpenCV Zoo text_recognition_crnn, Apache-2.0). Modelled on the same lazy,
fail-safe, config-driven pattern as app/ai/plate.py.

It is a SEPARATE, OPTIONAL stage. app/ai/plate.py localises + gates plate
regions and leaves plate_text=None; this fills it. If the OCR model or its
charset is missing, plates are still localised and CamAI keeps running — OCR
never crashes the engine and never invents a plate number.

CRNN contract (OpenCV Zoo)
--------------------------
Input : grayscale, 100x32 (WxH), blobFromImage scale 1/127.5, mean 127.5 ->
        [-1,1], shape [1,1,32,100].
Output: [T,1,C] logits over C = len(charset)+1 classes; class 0 is the CTC
        blank. Greedy CTC: argmax per timestep, collapse adjacent duplicates,
        drop blanks.
Charset is loaded from a file (config.ANPR_OCR_CHARSET) — the EN model uses
0-9a-z (36). Output is upper-cased and reduced to alphanumerics: a plate number
is [A-Z0-9], and upper-casing makes the lower-case EN charset match how plates
are written.
"""
from __future__ import annotations

import os
import re
import sys
import threading
import time
from typing import List, Optional, Tuple

import cv2
import numpy as np

from app import config

try:
    import onnxruntime as ort
    HAS_ORT = True
except Exception:  # pragma: no cover
    HAS_ORT = False

_OCR_W, _OCR_H = 100, 32
_PROVIDER_PREF = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]


def _select_providers() -> List[str]:
    avail = set(ort.get_available_providers()) if HAS_ORT else set()
    chosen = [p for p in _PROVIDER_PREF if p in avail]
    if "CPUExecutionProvider" not in chosen:
        chosen.append("CPUExecutionProvider")
    return chosen


def _candidate_dirs() -> List[str]:
    dirs: List[str] = [str(config.ANPR_MODEL_DIR)]
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        dirs += [os.path.join(exe_dir, "plate"), exe_dir, os.path.join(exe_dir, "_internal")]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            dirs.append(os.path.join(meipass, "plate"))
    here = os.path.dirname(os.path.abspath(__file__))
    dirs += [os.path.join(here, "..", "..", "models", "plate")]
    return [os.path.normpath(d) for d in dirs]


def _resolve(name: str) -> Optional[str]:
    if os.path.isabs(name) and os.path.exists(name):
        return name
    for d in _candidate_dirs():
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


def _load_charset(path: str) -> str:
    """Charset from a file — one char per line, OR a single line holding the
    whole charset. Never hardcoded, so a CN/CH model with a different alphabet
    just works by shipping its own charset file."""
    with open(path, "r", encoding="utf-8") as fh:
        lines = [ln.rstrip("\n") for ln in fh]
    lines = [ln for ln in lines if ln != ""]
    if len(lines) == 1 and len(lines[0]) > 1:
        return lines[0]                       # single-string charset
    return "".join(lines)                     # one char per line


def ctc_greedy_decode(output: np.ndarray, charset: str) -> Tuple[str, float]:
    """Greedy CTC over a [T,1,C] / [1,T,C] / [T,C] tensor. Class 0 is blank;
    charset indexes classes 1..C-1. Returns (text, mean confidence over the kept
    timesteps)."""
    arr = np.asarray(output)
    if arr.ndim == 3:
        arr = arr[:, 0, :] if arr.shape[1] == 1 else arr[0]
    if arr.ndim != 2:
        return "", 0.0
    # softmax per timestep for a calibrated confidence (output may be logits).
    z = arr - arr.max(axis=1, keepdims=True)
    probs = np.exp(z)
    probs /= probs.sum(axis=1, keepdims=True)
    idxs = probs.argmax(axis=1)
    conf_per_t = probs[np.arange(len(idxs)), idxs]

    chars: List[str] = []
    confs: List[float] = []
    prev = -1
    for t, idx in enumerate(idxs):
        if idx != prev and idx != 0:           # collapse repeats, drop blank
            ci = int(idx) - 1
            if 0 <= ci < len(charset):
                chars.append(charset[ci])
                confs.append(float(conf_per_t[t]))
        prev = int(idx)
    if not chars:
        return "", 0.0
    return "".join(chars), float(np.mean(confs))


def normalise_plate(text: str) -> str:
    """A plate number is [A-Z0-9]; upper-case (the EN charset is lower-case) and
    drop anything else."""
    return re.sub(r"[^A-Z0-9]", "", text.upper())


class PlateOCR:
    def __init__(self, model_path: str, charset_path: str):
        if not HAS_ORT:
            raise RuntimeError("onnxruntime unavailable; cannot run OCR model")
        self.charset = _load_charset(charset_path)
        if not self.charset:
            raise ValueError(f"empty charset in {charset_path}")
        self.last_error: Optional[str] = None
        self.last_infer_ms: float = 0.0
        self._lock = threading.Lock()

        t0 = time.time()
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = max(1, min(2, (os.cpu_count() or 2)))
        so.log_severity_level = 3
        self.providers = _select_providers()
        self.session = ort.InferenceSession(model_path, sess_options=so, providers=self.providers)
        self.active_provider = self.session.get_providers()[0]
        try:
            from app.ai.accelerator import guard_cpu_fallback
            guard_cpu_fallback("ANPR OCR", self.active_provider)
        except RuntimeError:
            raise
        except Exception:
            pass
        self._in_name = self.session.get_inputs()[0].name
        # BGR CN models keep 3 channels; EN uses grayscale. Follow the model.
        self._channels = 3 if self.session.get_inputs()[0].shape[1] == 3 else 1
        print(f"[anpr-ocr] CRNN loaded from {model_path} in {(time.time()-t0)*1000:.0f}ms "
              f"| provider={self.active_provider} | charset={len(self.charset)} "
              f"| channels={self._channels}", flush=True)

    def _preprocess(self, plate_bgr: np.ndarray) -> np.ndarray:
        if self._channels == 1:
            img = cv2.cvtColor(plate_bgr, cv2.COLOR_BGR2GRAY)
        else:
            img = plate_bgr
        return cv2.dnn.blobFromImage(img, scalefactor=1 / 127.5, size=(_OCR_W, _OCR_H), mean=127.5)

    def read(self, plate_bgr: np.ndarray) -> Tuple[str, float]:
        """(plate_text, confidence). Never raises — a failure is recorded in
        last_error and returns ('', 0.0) so localisation is unaffected."""
        if plate_bgr is None or plate_bgr.size == 0:
            return "", 0.0
        try:
            blob = self._preprocess(plate_bgr)
            with self._lock:
                t0 = time.time()
                out = self.session.run(None, {self._in_name: blob})[0]
                self.last_infer_ms = (time.time() - t0) * 1000
            raw, conf = ctc_greedy_decode(out, self.charset)
            text = normalise_plate(raw)
            if len(text) < config.ANPR_OCR_MIN_LEN:
                return "", 0.0                 # too short to be a real plate
            return text, conf
        except Exception as e:
            self.last_error = str(e)
            return "", 0.0


_INSTANCE: Optional[PlateOCR] = None
_LOAD_FAILED = False
_LOAD_LOCK = threading.Lock()


def is_loaded() -> bool:
    return _INSTANCE is not None


def unload() -> bool:
    global _INSTANCE, _LOAD_FAILED
    with _LOAD_LOCK:
        if _INSTANCE is None:
            return False
        _INSTANCE = None
        _LOAD_FAILED = False
    print("[anpr-ocr] CRNN unloaded", flush=True)
    return True


def get_recognizer() -> Optional[PlateOCR]:
    """Process-wide singleton, or None (once, loudly) if OCR is disabled or the
    model/charset is missing — plate localisation then runs without text."""
    global _INSTANCE, _LOAD_FAILED
    if not (config.ANPR_ENABLED and config.ANPR_OCR_ENABLED):
        return None
    with _LOAD_LOCK:
        if _INSTANCE is not None:
            return _INSTANCE
        if _LOAD_FAILED:
            return None
        model = _resolve(config.ANPR_OCR_MODEL)
        charset = _resolve(config.ANPR_OCR_CHARSET)
        if not model or not charset:
            _LOAD_FAILED = True
            missing = "model" if not model else "charset"
            print(f"[anpr-ocr] {config.ANPR_OCR_MODEL if not model else config.ANPR_OCR_CHARSET} "
                  f"({missing}) not found in {_candidate_dirs()} — plates are "
                  "localised but not read. OCR disabled; CamAI continues.", flush=True)
            return None
        try:
            _INSTANCE = PlateOCR(model, charset)
            return _INSTANCE
        except Exception as e:
            _LOAD_FAILED = True
            print(f"[anpr-ocr] failed to load CRNN: {e} — OCR disabled, CamAI continues.", flush=True)
            return None
