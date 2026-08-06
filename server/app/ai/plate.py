"""ANPR number-plate LOCALISATION — the vehicle-crop + gating core, a separate
detector loaded only when a camera's zone profile enables ANPR. Modelled on
app/ai/helmet.py.

Scope of THIS module
--------------------
It finds plate REGIONS on vehicles, gates them, and hands each survivor to the
OCR stage (app/ai/plate_ocr.py). Emits detections shaped like the yolox ones
with class "number_plate":
    {"class":"number_plate","confidence":float,"bbox":{...},
     "plate_text":str|None,"plate_text_confidence":float|None,
     "plate_failure":str|None}

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

Recall fixes measured on the test footage (docs/ANPR.md)
--------------------------------------------------------
Instrumenting this path on real video found the plate loss was almost entirely
BEFORE OCR, not in it — OCR was never even reaching most plates:
  * The score floor was 0.5 while the model's top score over 145 vehicle crops
    was 0.35. Roughly 97% of genuine plates were discarded on score alone.
    `ANPR_THRESHOLD` now defaults to 0.15 and the geometry gates plus format
    validation do the false-positive rejection instead.
  * Survivors were then failed by a 40px minimum width measured on the SOURCE
    crop. Small vehicle crops are now upscaled before detection
    (`ANPR_UPSCALE_TO_W`), so a distant plate gets a fair chance.
  * Detector boxes clip the outer glyphs; the crop handed to OCR is padded by
    `ANPR_PLATE_PAD_FRAC` before reading.
  * Overlapping vehicle boxes produced duplicate crops of the same car, and so
    duplicate plate reads. Vehicle boxes are deduplicated first.

Model
-----
Pluggable ONNX plate detector (config.ANPR_MODEL under config.ANPR_MODEL_DIR).
Two ONNX contracts are auto-detected from the real model I/O:
  * generic single-output box detector ([1,N,4+nc] cxcywh, or [N,>=5] xyxy+score)
    — what a YOLO-family plate model exports; the practical India path.
  * LPD-YuNet (OpenCV Zoo, Apache-2.0): three outputs loc/conf/iou, SSD priors.
Fail-safe: a missing/bad model disables ANPR only and logs why; CamAI never
crashes and never invents a plate.
"""
from __future__ import annotations

import math
import os
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

from app import config
from app.ai import plate_debug, plate_ocr

try:
    import onnxruntime as ort
    HAS_ORT = True
except Exception:  # pragma: no cover
    HAS_ORT = False

# Plates only exist on these; bicycles have none, so they are excluded.
PLATE_VEHICLES = ("car", "truck", "bus", "motorcycle")
_VEHICLE_PAD = 0.02          # a hair of context; the crop is already the vehicle
_MIN_VEHICLE_PX = 32         # below this a vehicle shows no plate at any upscale
CANON_PLATE = "number_plate"

# Failure reasons surfaced to telemetry / the debug log.
FAIL_NO_VEHICLE = "no_vehicle"
FAIL_NO_PLATE = "no_plate"
FAIL_TOO_SMALL = "plate_too_small"
FAIL_ASPECT = "plate_bad_aspect"
FAIL_AREA = "plate_too_large"

_PROVIDER_PREF = ["CUDAExecutionProvider", "CPUExecutionProvider"]

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


def gate_reason(bx1: float, by1: float, bx2: float, by2: float,
                crop_w: int, crop_h: int) -> Optional[str]:
    """None if the candidate is plausibly a plate, else WHY it was rejected.

    This is the anti-false-positive core: reject wrong aspect (painted banners
    are very wide, logos are square-ish and large), too-small-to-read, or
    too-large-to-be-a-plate. Returning the reason rather than a bare bool is
    what lets telemetry distinguish "nothing looked like a plate" from "a plate
    was found but it was 12px wide".
    """
    w = bx2 - bx1
    h = by2 - by1
    if w < config.ANPR_MIN_PLATE_W or h < 6:
        return FAIL_TOO_SMALL
    aspect = w / h if h > 0 else 0.0
    if not (config.ANPR_ASPECT_MIN <= aspect <= config.ANPR_ASPECT_MAX):
        return FAIL_ASPECT
    crop_area = max(1.0, float(crop_w) * float(crop_h))
    if (w * h) / crop_area > config.ANPR_MAX_AREA_FRAC:
        return FAIL_AREA
    return None


def gate_plate(bx1: float, by1: float, bx2: float, by2: float,
               crop_w: int, crop_h: int) -> bool:
    """Boolean form of `gate_reason`, kept for existing callers and tests."""
    return gate_reason(bx1, by1, bx2, by2, crop_w, crop_h) is None


def dedupe_vehicles(boxes: Sequence[Dict[str, float]], iou_thresh: float = 0.75
                    ) -> List[int]:
    """Indices of vehicle boxes to actually run the plate detector on.

    Two heavily-overlapping vehicle detections (a car detected as both "car"
    and "truck", or a tracker box beside a fresh detection) describe the same
    physical vehicle. Cropping both ran the detector and OCR twice on the same
    plate and produced two identical detections in the payload — wasted compute
    and a duplicate box on the overlay.
    """
    order = sorted(range(len(boxes)),
                   key=lambda i: (boxes[i]["x2"] - boxes[i]["x1"]) *
                                 (boxes[i]["y2"] - boxes[i]["y1"]),
                   reverse=True)
    keep: List[int] = []
    for i in order:
        if all(_iou(boxes[i], boxes[j]) <= iou_thresh for j in keep):
            keep.append(i)
    return keep


class PlateDetector:
    def __init__(self, model_path: str, conf: float, nms: float):
        if not HAS_ORT:
            raise RuntimeError("onnxruntime unavailable; cannot run plate model")
        self.model_path = model_path
        self.conf = float(conf)
        self.nms = float(nms)
        self.last_error: Optional[str] = None
        self.last_infer_ms: float = 0.0
        self.last_reason: Optional[str] = None
        self._lock = threading.Lock()
        self._layout: Optional[str] = None      # "xyxy" | "cxcywh", decided once

        t0 = time.time()
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2)))
        so.log_severity_level = 3
        self.providers = _select_providers()
        self.session = ort.InferenceSession(model_path, sess_options=so, providers=self.providers)
        self.active_provider = self.session.get_providers()[0]
        try:
            from app.ai.accelerator import guard_cpu_fallback
            guard_cpu_fallback("ANPR plate detector", self.active_provider)
        except RuntimeError:
            raise
        except Exception:
            pass

        ins = self.session.get_inputs()
        outs = self.session.get_outputs()
        self._in_name = ins[0].name
        out_names = [o.name.lower() for o in outs]
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
            shp = ins[0].shape
            s = shp[2] if isinstance(shp[2], int) and isinstance(shp[3], int) else 640
            self.input_size = (int(s), int(s))

        load_ms = (time.time() - t0) * 1000
        print(f"[anpr] plate detector loaded from {model_path} in {load_ms:.0f}ms "
              f"| provider={self.active_provider} | contract={self._contract} "
              f"| input={self.input_size} | conf={self.conf}", flush=True)

    def set_confidence(self, conf: float) -> None:
        self.conf = float(conf)

    # -- LPD-YuNet SSD priors + decode ------------------------------------
    def _make_lpd_priors(self) -> np.ndarray:
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
    def _decide_layout(self, arr: np.ndarray) -> str:
        """Decide ONCE whether the model emits xyxy or cxcywh, from the whole
        tensor rather than per row.

        The previous implementation asked, for each row, "is col2 > col0 and
        col3 > col1?" and read the row as xyxy when so. For a cx,cy,w,h box
        that test is true whenever the box is near the left/top edge and wider
        than its centre offset — so plates at the edge of a vehicle crop were
        silently decoded with the wrong formula and produced boxes in the wrong
        place. Deciding globally from the majority removes that whole class of
        error: a real detector emits one layout for every row.
        """
        if self._layout is not None:
            return self._layout
        sample = arr[arr[:, 4] >= max(0.05, self.conf * 0.5)] if arr.shape[0] else arr
        if sample.shape[0] < 3:
            sample = arr[np.argsort(-arr[:, 4])[:32]] if arr.shape[0] else arr
        if sample.shape[0] == 0:
            return "cxcywh"
        looks_xyxy = np.mean((sample[:, 2] > sample[:, 0]) & (sample[:, 3] > sample[:, 1]))
        self._layout = "xyxy" if looks_xyxy >= 0.95 else "cxcywh"
        print(f"[anpr] plate model box layout detected: {self._layout} "
              f"(xyxy-consistent rows: {looks_xyxy:.0%})", flush=True)
        return self._layout

    def _decode_generic(self, out, scale, crop_w, crop_h) -> List[Dict[str, Any]]:
        """Vectorised decode of a YOLO-family single-output plate model.

        The old row-by-row Python loop ran over every one of the 8400 anchors
        for every vehicle crop on every ANPR pass. Filtering with numpy first
        and only materialising the survivors keeps this off the critical path.
        """
        arr = np.asarray(out, dtype=np.float32)
        if arr.ndim == 3:
            arr = arr[0]
        if arr.ndim != 2:
            self.last_error = f"unexpected plate model output shape {np.asarray(out).shape}"
            return []
        # A YOLOv8 detect export is [4+nc, N] (channels-first, N~8400 anchors);
        # some exports transpose to [N, 4+nc]. Put the many anchors on the rows
        # so each row is one candidate — without this the decoder read 5 rows of
        # 8400 values and produced garbage boxes with confidences in the hundreds.
        if 5 <= arr.shape[0] < arr.shape[1]:
            arr = arr.T
        cols = arr.shape[1]
        if cols < 5:
            self.last_error = f"plate model output has too few columns: {cols}"
            return []

        scores = arr[:, 4] if cols == 5 else arr[:, 4:].max(axis=1)
        keep = scores >= self.conf
        if not np.any(keep):
            return []
        rows = arr[keep]
        scores = scores[keep]
        # Cap the number of candidates carried forward; NMS and gating handle
        # the rest and a pathological frame must not blow up the pass.
        if rows.shape[0] > 300:
            top = np.argsort(-scores)[:300]
            rows, scores = rows[top], scores[top]

        S = float(self.input_size[0])
        box = rows[:, :4].copy()
        normalised = float(np.nanmax(rows[:, :4])) <= 1.5
        if normalised:
            box *= S
        layout = self._decide_layout(np.column_stack([box, scores]))
        if layout == "xyxy":
            x1, y1, x2, y2 = box[:, 0], box[:, 1], box[:, 2], box[:, 3]
        else:
            x1 = box[:, 0] - box[:, 2] / 2.0
            y1 = box[:, 1] - box[:, 3] / 2.0
            x2 = box[:, 0] + box[:, 2] / 2.0
            y2 = box[:, 1] + box[:, 3] / 2.0
        x1 /= scale; y1 /= scale; x2 /= scale; y2 /= scale
        return [{"_box": (float(a), float(b), float(c), float(d)), "_score": float(s)}
                for a, b, c, d, s in zip(x1, y1, x2, y2, scores)]

    # -- gating + NMS + emit ----------------------------------------------
    def _finalise(self, raw: List[Dict[str, Any]], crop_w, crop_h,
                  ox: int, oy: int) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """(kept detections, rejection reason when everything was rejected)."""
        gated: List[Dict[str, Any]] = []
        reasons: List[str] = []
        for r in raw:
            x1, y1, x2, y2 = r["_box"]
            x1 = max(0.0, min(float(crop_w), x1)); x2 = max(0.0, min(float(crop_w), x2))
            y1 = max(0.0, min(float(crop_h), y1)); y2 = max(0.0, min(float(crop_h), y2))
            why = gate_reason(x1, y1, x2, y2, crop_w, crop_h)
            if why:
                reasons.append(why)
                continue
            gated.append({
                "class": CANON_PLATE,
                "confidence": r["_score"],
                "bbox": {"x1": ox + x1, "y1": oy + y1, "x2": ox + x2, "y2": oy + y2},
                "plate_text": None,
                "plate_text_confidence": None,
                "plate_failure": None,
            })
        if not gated:
            if not raw:
                return [], FAIL_NO_PLATE
            # report the most common rejection so telemetry is actionable
            return [], max(set(reasons), key=reasons.count) if reasons else FAIL_NO_PLATE

        if len(gated) < 2:
            return gated, None
        gated.sort(key=lambda d: d["confidence"], reverse=True)
        keep: List[Dict[str, Any]] = []
        for d in gated:
            if all(_iou(d["bbox"], k["bbox"]) <= self.nms for k in keep):
                keep.append(d)
        return keep, None

    def _run(self, crop: np.ndarray) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        ch, cw = crop.shape[:2]
        if self._contract == "lpd_yunet":
            blob = cv2.dnn.blobFromImage(crop, size=(_LPD_W, _LPD_H))  # BGR 0-255
            with self._lock:
                t0 = time.time()
                res = self.session.run([self._out_loc, self._out_conf, self._out_iou],
                                       {self._in_name: blob})
                self.last_infer_ms = (time.time() - t0) * 1000
            return self._finalise(self._decode_lpd(res[0], res[1], res[2], cw, ch), cw, ch, 0, 0)
        S = self.input_size[0]
        canvas, scale = _letterbox(crop, S)
        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])
        with self._lock:
            t0 = time.time()
            res = self.session.run([self._out_single], {self._in_name: blob})
            self.last_infer_ms = (time.time() - t0) * 1000
        return self._finalise(self._decode_generic(res[0], scale, cw, ch), cw, ch, 0, 0)

    # -- OCR ---------------------------------------------------------------
    def _pad_box(self, b: Dict[str, float], w: int, h: int) -> Tuple[int, int, int, int]:
        """Grow a plate box slightly before cutting the OCR crop.

        Plate detectors are trained to tight boxes and routinely clip the first
        and last glyph; those two characters are exactly the ones the grammar
        needs to anchor the state code and the serial. The pad is a fraction of
        the box, so it scales with distance.
        """
        pad = float(config.ANPR_PLATE_PAD_FRAC)
        bw, bh = b["x2"] - b["x1"], b["y2"] - b["y1"]
        px, py = bw * pad, bh * pad
        return (max(0, int(b["x1"] - px)), max(0, int(b["y1"] - py)),
                min(w, int(b["x2"] + px)), min(h, int(b["y2"] + py)))

    def read_text(self, crop: np.ndarray, dets: List[Dict[str, Any]],
                  camera_id: str = "", frame: Optional[np.ndarray] = None) -> None:
        """Fill plate_text with the OCR read of each gated plate.

        Optional and fail-safe: if no OCR model is installed the plates stay
        localised with plate_text=None, and an OCR error on one plate never
        drops the plate. A failed read records WHY in `plate_failure` instead of
        silently vanishing, which is what makes the "no empty results when the
        plate is clearly visible" requirement checkable in the field.
        """
        if not dets:
            return
        rec = plate_ocr.get_recognizer()
        if rec is None:
            return
        ch, cw = crop.shape[:2]
        debug_on = plate_debug.enabled()
        for d in dets:
            b = d["bbox"]                       # crop-local here
            x1, y1, x2, y2 = self._pad_box(b, cw, ch)
            if x2 - x1 < 2 or y2 - y1 < 2:
                d["plate_failure"] = plate_ocr.FAIL_EMPTY_CROP
                continue
            plate_crop = crop[y1:y2, x1:x2]
            sink: Optional[Dict[str, np.ndarray]] = {} if debug_on else None
            res = rec.read_detailed(plate_crop, debug_sink=sink)
            if res.text:
                d["plate_text"] = res.text
                d["plate_text_confidence"] = round(res.confidence, 3)
                d["plate_valid_format"] = res.valid
            else:
                d["plate_failure"] = res.reason
            if debug_on:
                plate_debug.record(camera_id, frame, crop, plate_crop, sink,
                                   {**res.as_dict(),
                                    "detector_confidence": round(d["confidence"], 3),
                                    "plate_box_crop_local": [x1, y1, x2, y2],
                                    "crop_size": [cw, ch]})

    # -- crops -------------------------------------------------------------
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

    @staticmethod
    def _upscale(crop: np.ndarray) -> Tuple[np.ndarray, float]:
        """Enlarge a small vehicle crop before plate detection.

        The detector letterboxes to 640 regardless, so a 90px-wide crop is
        already being upscaled — doing it here with a good interpolator, before
        inference, is strictly better and lets a distant plate clear the size
        gate that previously discarded it. Returns (crop, scale_applied) so box
        coordinates can be mapped back.
        """
        target = int(config.ANPR_UPSCALE_TO_W)
        h, w = crop.shape[:2]
        if target <= 0 or w <= 0 or w >= target:
            return crop, 1.0
        s = min(float(target) / float(w), 4.0)
        return cv2.resize(crop, (int(w * s), int(h * s)),
                          interpolation=cv2.INTER_CUBIC), s

    def detect_on_vehicles(self, frame: np.ndarray,
                           vehicle_boxes: List[Dict[str, float]],
                           camera_id: str = "",
                           track_ids: Optional[Sequence[Optional[int]]] = None,
                           skip_track_ids: Optional[set] = None,
                           ) -> List[Dict[str, Any]]:
        """number_plate detections (localised, gated and read) in absolute frame
        pixels. Never raises — one bad crop is recorded in last_error and
        skipped (fail-safe).

        `skip_track_ids` lets the caller drop vehicles whose plate is already
        settled, so a queue of stationary traffic costs one read each rather
        than one read per vehicle per pass.
        """
        self.last_reason = None
        if not vehicle_boxes:
            self.last_reason = FAIL_NO_VEHICLE
            plate_debug.log_failure(camera_id, FAIL_NO_VEHICLE)
            return []

        keep_idx = dedupe_vehicles(vehicle_boxes)
        if skip_track_ids and track_ids is not None:
            keep_idx = [i for i in keep_idx
                        if i >= len(track_ids) or track_ids[i] not in skip_track_ids]
        if not keep_idx:
            return []

        out: List[Dict[str, Any]] = []
        reasons: List[str] = []
        for i in keep_idx:
            box = vehicle_boxes[i]
            got = self._vehicle_crops(frame, [box])
            if not got:
                reasons.append(FAIL_TOO_SMALL)
                continue
            cx1, cy1, cx2, cy2 = got[0]
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue
            work, up = self._upscale(crop)
            try:
                dets, why = self._run(work)
            except Exception as e:
                self.last_error = str(e)
                continue
            if why:
                reasons.append(why)
            if not dets:
                continue
            if up != 1.0:                       # upscaled px -> source crop px
                for d in dets:
                    for k in ("x1", "x2", "y1", "y2"):
                        d["bbox"][k] /= up
            self.read_text(crop, dets, camera_id=camera_id, frame=frame)
            tid = track_ids[i] if (track_ids is not None and i < len(track_ids)) else None
            for d in dets:                      # crop-local -> frame coords
                d["bbox"]["x1"] += cx1; d["bbox"]["x2"] += cx1
                d["bbox"]["y1"] += cy1; d["bbox"]["y2"] += cy1
                if tid is not None:
                    d["vehicle_track_id"] = tid
                out.append(d)

        if not out and reasons:
            self.last_reason = max(set(reasons), key=reasons.count)
            plate_debug.log_failure(camera_id, self.last_reason,
                                    f"{len(keep_idx)} vehicle crop(s) examined")
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
