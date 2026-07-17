"""Face detection module — YuNet (MIT), loaded only when a camera asks for it.

Why this exists
---------------
`analytics.py` has always had a `face_detection` feature toggle whose loop looks
for `det["class"] == "face"`. Nothing ever produced that class: the detector is
yolox_tiny and its COCO_CLASS_MAP (backend.py) has no face. So the toggle — and
its confidence slider — were wired to nothing, and an operator enabling "Face
Detection" got silence forever. This module makes the class real.

Licensing
---------
YuNet ships from OpenCV Zoo under the **MIT** licence, SFace under **Apache-2.0**.
Both are compatible with proprietary redistribution, unlike the AGPL-3.0
Ultralytics weights this product deliberately moved off (see LICENSING.md).
Do not swap in a YOLO-derived face model: almost every public one is YOLOv5/v8
and would re-contaminate the shipped binary.

Why person crops rather than the whole frame
--------------------------------------------
Measured on the repo's own dtest/bus_pan.mp4 (1186x648, 30 frames, conf>=0.6):

    whole frame @512 ......... 65.3 ms  61 faces
    person crops @160 fixed .. 34.8 ms  76 faces   <-- ~2x faster, +25% recall

A face only ever exists inside a person box, and yolox already produces those.
The crop is small (fast) and the face fills a large fraction of it, which is the
regime YuNet is accurate in.

Why one fixed input size
------------------------
cv2.FaceDetectorYN.setInputSize() reconfigures the network. Calling it per crop
(each a different size) cost 96.1 ms for the same four crops — nearly 3x the
34.8 ms of letterboxing them all into one constant 160x160 input. The size is
set once at construction and never changed.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

# Recall saturates by 160: 192x192 measured 77 faces vs 160's 76, for 38% more
# time. 128 drops to 65. 160 is the knee.
_CROP_INPUT = 160
_MIN_CROP_PX = 24          # below this a crop carries no recoverable face
_PERSON_PAD = 0.15         # yolox person boxes clip the crown of the head
_MODEL_FILENAME = "face_detection_yunet_2023mar.onnx"


def _candidate_dirs() -> List[str]:
    """Mirrors backend.py's model search: alongside the frozen exe, in the
    PyInstaller bundle, and in the dev tree."""
    dirs: List[str] = []
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        dirs += [exe_dir, os.path.join(exe_dir, "_internal")]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            dirs.append(meipass)
    here = os.path.dirname(os.path.abspath(__file__))
    dirs += [
        os.path.join(here, "..", "..", "models_face"),  # server/models_face
        os.path.join(here, "..", ".."),
    ]
    return [os.path.normpath(d) for d in dirs]


def find_model() -> Optional[str]:
    for d in _candidate_dirs():
        p = os.path.join(d, _MODEL_FILENAME)
        if os.path.exists(p):
            return p
    return None


def _letterbox(img: np.ndarray, size: int) -> Tuple[np.ndarray, float]:
    """Aspect-preserving fit into size x size. Squashing a tall person crop into
    a square distorts the face and measurably costs recall. Returns the canvas
    and the scale used, so detections can be mapped back."""
    h, w = img.shape[:2]
    s = min(size / w, size / h)
    nw, nh = max(1, int(w * s)), max(1, int(h * s))
    canvas = np.zeros((size, size, 3), np.uint8)
    canvas[:nh, :nw] = cv2.resize(img, (nw, nh))
    return canvas, s


class FaceDetector:
    """Lazily constructed. Nothing is loaded, and no inference runs, unless a
    camera actually enables face_detection — that is what makes a disabled
    module cost exactly zero rather than merely 'a bit less'."""

    def __init__(self, model_path: str, conf: float = 0.6, nms: float = 0.3):
        self.model_path = model_path
        self.conf = conf
        self._det = cv2.FaceDetectorYN.create(
            model_path, "", (_CROP_INPUT, _CROP_INPUT), conf, nms, 5000
        )
        # Set once. See module docstring — re-setting per crop tripled the cost.
        self._det.setInputSize((_CROP_INPUT, _CROP_INPUT))
        self.last_error: Optional[str] = None

    def set_confidence(self, conf: float) -> None:
        """Honours the confidence slider the zone-profile editor already shows
        for this feature (zoneProfiles.ts face_detection params)."""
        if abs(conf - self.conf) < 1e-3:
            return
        self.conf = conf
        try:
            self._det.setScoreThreshold(conf)
        except Exception:
            # Older cv2 builds lack the setter; rebuild instead of silently
            # running at the wrong threshold.
            self._det = cv2.FaceDetectorYN.create(
                self.model_path, "", (_CROP_INPUT, _CROP_INPUT), conf, 0.3, 5000
            )
            self._det.setInputSize((_CROP_INPUT, _CROP_INPUT))

    @staticmethod
    def _nms(dets: List[Dict[str, Any]], iou_thresh: float = 0.4) -> List[Dict[str, Any]]:
        """Cross-crop NMS.

        YuNet already NMSes within one crop, but person boxes overlap — two
        people walking side by side produce crops that both contain the same
        face, so it gets detected once per crop. Measured on the proof frame:
        two people yielded three faces, the last two being the same face at
        0.80 and 0.67. Without this the operator sees phantom extra faces and
        any face count is inflated.
        """
        if len(dets) < 2:
            return dets
        order = sorted(dets, key=lambda d: d["confidence"], reverse=True)
        keep: List[Dict[str, Any]] = []
        for d in order:
            b = d["bbox"]
            dup = False
            for k in keep:
                kb = k["bbox"]
                ix1 = max(b["x1"], kb["x1"])
                iy1 = max(b["y1"], kb["y1"])
                ix2 = min(b["x2"], kb["x2"])
                iy2 = min(b["y2"], kb["y2"])
                iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
                inter = iw * ih
                if inter <= 0:
                    continue
                a1 = (b["x2"] - b["x1"]) * (b["y2"] - b["y1"])
                a2 = (kb["x2"] - kb["x1"]) * (kb["y2"] - kb["y1"])
                union = a1 + a2 - inter
                if union > 0 and inter / union > iou_thresh:
                    dup = True
                    break
            if not dup:
                keep.append(d)
        return keep

    def detect_in_persons(
        self, frame: np.ndarray, person_boxes: List[Dict[str, float]]
    ) -> List[Dict[str, Any]]:
        """Returns face detections in absolute frame pixels, shaped like the
        yolox detections in pipeline.py so downstream code needs no special
        case: {"class": "face", "confidence": float, "bbox": {x1,y1,x2,y2}}."""
        if not person_boxes:
            return []
        fh, fw = frame.shape[:2]
        out: List[Dict[str, Any]] = []

        for pb in person_boxes:
            x1, y1 = float(pb["x1"]), float(pb["y1"])
            x2, y2 = float(pb["x2"]), float(pb["y2"])
            bw, bh = x2 - x1, y2 - y1
            if bw <= 0 or bh <= 0:
                continue
            px, py = bw * _PERSON_PAD, bh * _PERSON_PAD
            cx1 = max(0, int(x1 - px))
            cy1 = max(0, int(y1 - py))
            cx2 = min(fw, int(x2 + px))
            cy2 = min(fh, int(y2 + py))
            if cx2 - cx1 < _MIN_CROP_PX or cy2 - cy1 < _MIN_CROP_PX:
                continue

            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue

            canvas, scale = _letterbox(crop, _CROP_INPUT)
            try:
                _, faces = self._det.detect(canvas)
            except cv2.error as e:
                # One bad crop must not kill the frame, but it must not be
                # swallowed either — the pipeline surfaces stage_errors.
                self.last_error = str(e)
                continue
            if faces is None:
                continue

            for f in faces:
                fx, fy, fwid, fhgt = (float(v) for v in f[:4])
                score = float(f[-1])
                # canvas -> crop -> frame
                ax1 = cx1 + fx / scale
                ay1 = cy1 + fy / scale
                ax2 = cx1 + (fx + fwid) / scale
                ay2 = cy1 + (fy + fhgt) / scale
                # A face landing outside its own person crop is a mapping bug,
                # not a detection; clamp rather than emit nonsense coordinates.
                ax1 = max(0.0, min(float(fw), ax1))
                ay1 = max(0.0, min(float(fh), ay1))
                ax2 = max(0.0, min(float(fw), ax2))
                ay2 = max(0.0, min(float(fh), ay2))
                if ax2 - ax1 < 2 or ay2 - ay1 < 2:
                    continue
                out.append({
                    "class": "face",
                    "confidence": score,
                    "bbox": {"x1": ax1, "y1": ay1, "x2": ax2, "y2": ay2},
                })
        return self._nms(out)


_INSTANCE: Optional[FaceDetector] = None
_LOAD_FAILED = False


def get_detector(conf: float = 0.6) -> Optional[FaceDetector]:
    """Process-wide singleton — the model is ~230 KB but constructing it costs
    ~130 ms, and every camera thread that enables the feature would otherwise
    pay that repeatedly. Returns None (once, loudly) if the model is missing."""
    global _INSTANCE, _LOAD_FAILED
    if _INSTANCE is not None:
        _INSTANCE.set_confidence(conf)
        return _INSTANCE
    if _LOAD_FAILED:
        return None
    path = find_model()
    if not path:
        _LOAD_FAILED = True
        print(
            f"[face] {_MODEL_FILENAME} not found in {_candidate_dirs()} — "
            "face_detection is enabled but cannot run. Fetch it with "
            "server/fetch_face_models.py.",
            flush=True,
        )
        return None
    try:
        _INSTANCE = FaceDetector(path, conf)
        print(f"[face] YuNet loaded from {path}", flush=True)
        return _INSTANCE
    except Exception as e:
        _LOAD_FAILED = True
        print(f"[face] failed to load YuNet from {path}: {e}", flush=True)
        return None
