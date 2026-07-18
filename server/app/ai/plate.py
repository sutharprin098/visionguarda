"""ANPR number-plate LOCALISATION — the vehicle-crop + gating core, a separate
detector loaded only when a camera's zone profile enables ANPR. Modelled on
app/ai/helmet.py.

Scope of THIS module
--------------------
It finds plate REGIONS on vehicles and gates them; reading the characters (OCR)
is a separate stage (app/ai/plate_ocr.py, next). Emits detections shaped like
the yolox ones with class "number_plate" and a "plate_text" slot that OCR fills
later:
    {"class":"number_plate","confidence":float,"bbox":{...},"plate_text":None}

Why vehicle crops + gating (the reason ANPR was stuck at "coming soon")
----------------------------------------------------------------------
On the full frame the plate detector latched onto any rectangular text block —
the previous attempt scored the word "emisiones" painted on a bus at 0.81 (see
desktop/src/lib/zoneProfiles.ts anpr note). Two fixes, both here:
  1. Run ONLY on car/truck/bus/motorcycle crops that yolox already produces, so
     the detector never sees off-vehicle signage at all.
  2. Gate every candidate by aspect ratio, absolute width, and area fraction of
     its vehicle — a real plate is a small, plate-shaped patch, not half the bus.
The aspect band deliberately admits two-row plates (~1.3-2.5:1), because Indian
two-wheeler plates — the DM pilot's target — are commonly two-row, not the wide
single-row a Western-tuned band would assume.

Model
-----
Pluggable ONNX plate detector (config.ANPR_MODEL under config.ANPR_MODEL_DIR).
Two ONNX contracts are auto-detected from the real model I/O:
  * generic single-output box detector ([1,N,4+nc] cxcywh, or [N,>=5] xyxy+score)
    — what a YOLO-family plate model exports; the practical India path.
  * LPD-YuNet (OpenCV Zoo, Apache-2.0): three outputs loc/conf/iou, SSD priors.
    NOTE it is trained on Chinese plates, so treat it as a starting detector and
    swap an India-tuned model in via config — one file, no pipeline change.
Fail-safe: a missing/bad model disables ANPR only and logs why; CamAI never
crashes and never invents a plate.
"""
from __future__ import annotations

import math
import os
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from app import config
from app.ai import plate_ocr

try:
    import onnxruntime as ort
    HAS_ORT = True
except Exception:  # pragma: no cover
    HAS_ORT = False

# Plates only exist on these; bicycles have none, so they are excluded.
PLATE_VEHICLES = ("car", "truck", "bus", "motorcycle")
_VEHICLE_PAD = 0.02          # a hair of context; the crop is already the vehicle
_MIN_VEHICLE_PX = 48         # a vehicle smaller than this shows no legible plate
CANON_PLATE = "number_plate"

_PROVIDER_PREF = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]

# LPD-YuNet SSD config (OpenCV Zoo license_plate_detection_yunet).
_LPD_W, _LPD_H = 320, 240
_LPD_STRIDES = [8, 16, 32, 64]
_LPD_MIN_SIZES = {8: [10, 16, 24], 16: [32, 48], 32: [64, 96], 64: [128, 192, 256]}
_LPD_VARIANCE = [0.1, 0.2]


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


def _resolve_model_path() -> Optional[str]:
    name = config.ANPR_MODEL
    if os.path.isabs(name) and os.path.exists(name):
        return name
    for d in _candidate_dirs():
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


def _iou(a: Dict[str, float], b: Dict[str, float]) -> float:
    ix1 = max(a["x1"], b["x1"]); iy1 = max(a["y1"], b["y1"])
    ix2 = min(a["x2"], b["x2"]); iy2 = min(a["y2"], b["y2"])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    aa = (a["x2"] - a["x1"]) * (a["y2"] - a["y1"])
    ab = (b["x2"] - b["x1"]) * (b["y2"] - b["y1"])
    u = aa + ab - inter
    return inter / u if u > 0 else 0.0


def _letterbox(img: np.ndarray, size: int) -> Tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    s = min(size / w, size / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    canvas = np.full((size, size, 3), 114, np.uint8)
    canvas[:nh, :nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return canvas, s


def gate_plate(bx1: float, by1: float, bx2: float, by2: float,
               crop_w: int, crop_h: int) -> bool:
    """True if a candidate box is plausibly a plate. This is the anti-false-
    positive core: reject wrong aspect (painted banners are very wide, logos are
    square-ish and large), too-small-to-read, or too-large-to-be-a-plate."""
    w = bx2 - bx1
    h = by2 - by1
    if w < config.ANPR_MIN_PLATE_W or h < 8:
        return False
    aspect = w / h if h > 0 else 0.0
    if not (config.ANPR_ASPECT_MIN <= aspect <= config.ANPR_ASPECT_MAX):
        return False
    crop_area = max(1.0, float(crop_w) * float(crop_h))
    if (w * h) / crop_area > config.ANPR_MAX_AREA_FRAC:
        return False
    return True


class PlateDetector:
    def __init__(self, model_path: str, conf: float, nms: float):
        if not HAS_ORT:
            raise RuntimeError("onnxruntime unavailable; cannot run plate model")
        self.model_path = model_path
        self.conf = float(conf)
        self.nms = float(nms)
        self.last_error: Optional[str] = None
        self.last_infer_ms: float = 0.0
        self._lock = threading.Lock()

        t0 = time.time()
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2)))
        so.log_severity_level = 3
        self.providers = _select_providers()
        self.session = ort.InferenceSession(model_path, sess_options=so, providers=self.providers)
        self.active_provider = self.session.get_providers()[0]

        ins = self.session.get_inputs()
        outs = self.session.get_outputs()
        self._in_name = ins[0].name
        out_names = [o.name.lower() for o in outs]
        # LPD-YuNet: exactly the loc/conf/iou triad.
        if len(outs) == 3 and any("loc" in n for n in out_names) and any("conf" in n for n in out_names):
            self._contract = "lpd_yunet"
            self._out_loc = next(o.name for o in outs if "loc" in o.name.lower())
            self._out_conf = next(o.name for o in outs if "conf" in o.name.lower())
            self._out_iou = next(o.name for o in outs if "iou" in o.name.lower())
            self._priors = self._make_lpd_priors()
            self.input_size = (_LPD_W, _LPD_H)
        else:
            self._contract = "generic"
            self._out_single = outs[0].name
            # Fixed square input if the model declares one, else default 640.
            shp = ins[0].shape
            s = shp[2] if isinstance(shp[2], int) and isinstance(shp[3], int) else 640
            self.input_size = (int(s), int(s))

        load_ms = (time.time() - t0) * 1000
        print(f"[anpr] plate detector loaded from {model_path} in {load_ms:.0f}ms "
              f"| provider={self.active_provider} | contract={self._contract} "
              f"| input={self.input_size}", flush=True)

    def set_confidence(self, conf: float) -> None:
        self.conf = float(conf)

    # -- LPD-YuNet SSD priors + decode ------------------------------------
    def _make_lpd_priors(self) -> np.ndarray:
        """SSD prior boxes [cx,cy,sw,sh] normalised to input, matching the
        OpenCV Zoo LPD-YuNet PriorBox (strides 8/16/32/64)."""
        priors = []
        for stride in _LPD_STRIDES:
            fh = int(math.ceil(_LPD_H / stride))
            fw = int(math.ceil(_LPD_W / stride))
            for i in range(fh):
                for j in range(fw):
                    for m in _LPD_MIN_SIZES[stride]:
                        cx = (j + 0.5) * stride / _LPD_W
                        cy = (i + 0.5) * stride / _LPD_H
                        priors.append([cx, cy, m / _LPD_W, m / _LPD_H])
        return np.asarray(priors, np.float32)

    def _decode_lpd(self, loc, conf, iou, crop_w, crop_h) -> List[Dict[str, Any]]:
        loc = np.asarray(loc).reshape(-1, loc.shape[-1])
        conf = np.asarray(conf).reshape(-1, conf.shape[-1])
        iou = np.asarray(iou).reshape(-1)
        n = min(len(self._priors), len(loc), len(conf), len(iou))
        pri = self._priors[:n]
        loc = loc[:n]; conf = conf[:n]; iou = iou[:n]
        cls_scores = conf[:, 1] if conf.shape[1] > 1 else conf[:, 0]
        iou_scores = np.clip(iou, 0.0, 1.0)
        scores = np.sqrt(np.maximum(cls_scores * iou_scores, 0.0))
        keep = scores >= self.conf
        if not np.any(keep):
            return []
        pri = pri[keep]; loc = loc[keep]; scores = scores[keep]
        # Four corner offsets live at channels [4:6],[6:8],[10:12],[12:14].
        corner_ch = [(4, 6), (6, 8), (10, 12), (12, 14)]
        out: List[Dict[str, Any]] = []
        for p, l, sc in zip(pri, loc, scores):
            xs, ys = [], []
            for (a, b) in corner_ch:
                if b > l.shape[0]:
                    continue
                px = p[0] + l[a] * _LPD_VARIANCE[0] * p[2]
                py = p[1] + l[a + 1] * _LPD_VARIANCE[1] * p[3]
                xs.append(px * crop_w); ys.append(py * crop_h)
            if len(xs) < 2:
                continue
            out.append({"_box": (min(xs), min(ys), max(xs), max(ys)), "_score": float(sc)})
        return out

    # -- generic single-output decode -------------------------------------
    def _decode_generic(self, out, scale, crop_w, crop_h) -> List[Dict[str, Any]]:
        arr = np.asarray(out)
        if arr.ndim == 3:
            arr = arr[0]
        if arr.ndim != 2:
            self.last_error = f"unexpected plate model output shape {np.asarray(out).shape}"
            return []
        # A YOLOv8 detect export is [4+nc, N] (channels-first, N≈8400 anchors);
        # some exports transpose to [N, 4+nc]. Put the many anchors on the rows
        # so each row is one candidate — without this the decoder read 5 rows of
        # 8400 values and produced garbage boxes with confidences in the hundreds.
        # Transpose only when axis 0 is a plausible feature count (>=5: 4 box +
        # >=1 class) and the smaller dim, so a tiny [N,4+nc] batch (N<5) is left
        # alone rather than flipped into nonsense.
        if 5 <= arr.shape[0] < arr.shape[1]:
            arr = arr.T
        S = float(self.input_size[0])
        results: List[Dict[str, Any]] = []
        cols = arr.shape[1]
        if cols >= 6 or (cols == 5):
            # Could be [x1,y1,x2,y2,score(,cls)] in input px, or YOLO
            # [cx,cy,w,h,score(,cls...)]. Disambiguate by whether the first four
            # look normalised (<=1.5) => cx,cy,w,h normalised.
            sample = arr[:, :4]
            normalised = np.nanmax(sample) <= 1.5 if sample.size else False
            for row in arr:
                if cols == 5:
                    score = float(row[4])
                else:
                    # last columns are class scores; take max
                    score = float(np.max(row[4:]))
                if score < self.conf:
                    continue
                a, b, c, d = float(row[0]), float(row[1]), float(row[2]), float(row[3])
                if normalised:               # cx,cy,w,h normalised 0-1
                    x1 = (a - c / 2) * S; y1 = (b - d / 2) * S
                    x2 = (a + c / 2) * S; y2 = (b + d / 2) * S
                elif c > a and d > b:        # already xyxy in input px
                    x1, y1, x2, y2 = a, b, c, d
                else:                        # cx,cy,w,h in input px
                    x1 = a - c / 2; y1 = b - d / 2; x2 = a + c / 2; y2 = b + d / 2
                # input px -> crop px
                results.append({"_box": (x1 / scale, y1 / scale, x2 / scale, y2 / scale),
                                "_score": score})
        else:
            self.last_error = f"plate model output has too few columns: {cols}"
        return results

    # -- gating + NMS + emit ----------------------------------------------
    def _finalise(self, raw: List[Dict[str, Any]], crop_w, crop_h,
                  ox: int, oy: int) -> List[Dict[str, Any]]:
        gated: List[Dict[str, Any]] = []
        for r in raw:
            x1, y1, x2, y2 = r["_box"]
            x1 = max(0.0, min(float(crop_w), x1)); x2 = max(0.0, min(float(crop_w), x2))
            y1 = max(0.0, min(float(crop_h), y1)); y2 = max(0.0, min(float(crop_h), y2))
            if not gate_plate(x1, y1, x2, y2, crop_w, crop_h):
                continue
            gated.append({
                "class": CANON_PLATE,
                "confidence": r["_score"],
                "bbox": {"x1": ox + x1, "y1": oy + y1, "x2": ox + x2, "y2": oy + y2},
                "plate_text": None,   # filled by the OCR stage
            })
        # NMS within a vehicle crop (a plate can fire on several priors).
        if len(gated) < 2:
            return gated
        gated.sort(key=lambda d: d["confidence"], reverse=True)
        keep: List[Dict[str, Any]] = []
        for d in gated:
            if all(_iou(d["bbox"], k["bbox"]) <= self.nms for k in keep):
                keep.append(d)
        return keep

    def _run(self, crop: np.ndarray) -> List[Dict[str, Any]]:
        ch, cw = crop.shape[:2]
        if self._contract == "lpd_yunet":
            blob = cv2.dnn.blobFromImage(crop, size=(_LPD_W, _LPD_H))  # BGR 0-255
            with self._lock:
                t0 = time.time()
                res = self.session.run([self._out_loc, self._out_conf, self._out_iou],
                                       {self._in_name: blob})
                self.last_infer_ms = (time.time() - t0) * 1000
            dets = self._finalise(self._decode_lpd(res[0], res[1], res[2], cw, ch), cw, ch, 0, 0)
        else:
            S = self.input_size[0]
            canvas, scale = _letterbox(crop, S)
            rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            blob = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])
            with self._lock:
                t0 = time.time()
                res = self.session.run([self._out_single], {self._in_name: blob})
                self.last_infer_ms = (time.time() - t0) * 1000
            dets = self._finalise(self._decode_generic(res[0], scale, cw, ch), cw, ch, 0, 0)
        self._read_text(crop, dets)
        return dets

    def _read_text(self, crop: np.ndarray, dets: List[Dict[str, Any]]) -> None:
        """Fill plate_text with the OCR read of each gated plate. Optional and
        fail-safe: if no OCR model is installed the plates stay localised with
        plate_text=None, and an OCR error on one plate never drops the plate."""
        if not dets:
            return
        rec = plate_ocr.get_recognizer()
        if rec is None:
            return
        ch, cw = crop.shape[:2]
        for d in dets:
            b = d["bbox"]                       # crop-local here (offset added later)
            x1 = max(0, int(b["x1"])); y1 = max(0, int(b["y1"]))
            x2 = min(cw, int(b["x2"])); y2 = min(ch, int(b["y2"]))
            if x2 - x1 < 2 or y2 - y1 < 2:
                continue
            text, conf = rec.read(crop[y1:y2, x1:x2])
            if text:
                d["plate_text"] = text
                d["plate_text_confidence"] = round(conf, 3)

    def _vehicle_crops(self, frame, vehicle_boxes) -> List[Tuple[int, int, int, int]]:
        fh, fw = frame.shape[:2]
        crops = []
        for vb in vehicle_boxes:
            x1, y1 = float(vb["x1"]), float(vb["y1"])
            x2, y2 = float(vb["x2"]), float(vb["y2"])
            bw, bh = x2 - x1, y2 - y1
            if bw < _MIN_VEHICLE_PX or bh < _MIN_VEHICLE_PX:
                continue
            px, py = bw * _VEHICLE_PAD, bh * _VEHICLE_PAD
            cx1 = max(0, int(x1 - px)); cy1 = max(0, int(y1 - py))
            cx2 = min(fw, int(x2 + px)); cy2 = min(fh, int(y2 + py))
            if cx2 - cx1 >= _MIN_VEHICLE_PX and cy2 - cy1 >= _MIN_VEHICLE_PX:
                crops.append((cx1, cy1, cx2, cy2))
        return crops

    def detect_on_vehicles(self, frame: np.ndarray,
                           vehicle_boxes: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        """number_plate detections (localised + gated, text not yet read) in
        absolute frame pixels. Never raises — one bad crop is recorded in
        last_error and skipped (fail-safe)."""
        if not vehicle_boxes:
            return []
        out: List[Dict[str, Any]] = []
        for (cx1, cy1, cx2, cy2) in self._vehicle_crops(frame, vehicle_boxes):
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue
            try:
                dets = self._run(crop)   # takes self._lock around inference
            except Exception as e:
                self.last_error = str(e)
                continue
            for d in dets:                       # crop-local -> frame coords
                d["bbox"]["x1"] += cx1; d["bbox"]["x2"] += cx1
                d["bbox"]["y1"] += cy1; d["bbox"]["y2"] += cy1
                out.append(d)
        return out


_INSTANCE: Optional[PlateDetector] = None
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
    print("[anpr] plate detector unloaded — no camera requires it", flush=True)
    return True


def get_detector(conf: Optional[float] = None) -> Optional[PlateDetector]:
    """Process-wide singleton. Returns None (once, loudly) if ANPR is globally
    disabled or the model is missing — ANPR then disables itself and the rest of
    CamAI runs untouched (fail-safe)."""
    global _INSTANCE, _LOAD_FAILED
    if not config.ANPR_ENABLED:
        return None
    conf = config.ANPR_THRESHOLD if conf is None else conf
    with _LOAD_LOCK:
        if _INSTANCE is not None:
            _INSTANCE.set_confidence(conf)
            return _INSTANCE
        if _LOAD_FAILED:
            return None
        path = _resolve_model_path()
        if not path:
            _LOAD_FAILED = True
            print(f"[anpr] '{config.ANPR_MODEL}' not found in {_candidate_dirs()} — "
                  "ANPR is enabled but cannot run. Install a plate-detector ONNX "
                  "there. ANPR disabled; the rest of CamAI is unaffected.", flush=True)
            return None
        try:
            _INSTANCE = PlateDetector(path, conf, config.ANPR_NMS)
            return _INSTANCE
        except Exception as e:
            _LOAD_FAILED = True
            print(f"[anpr] failed to load plate detector from {path}: {e} — "
                  "ANPR disabled, CamAI continues.", flush=True)
            return None
