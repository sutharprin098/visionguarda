"""Helmet detection module — RT-DETR (Apache-2.0), a SECOND detector loaded only
when a camera's zone profile asks for it. Modelled on app/ai/face.py; swapped
from a YOLOv8 decode to RT-DETR while keeping the public API identical, so
pipeline.py / analytics.py / the evidence path are untouched.

Why RT-DETR
-----------
The official RT-DETR (github.com/lyuwenyu/RT-DETR, Apache-2.0) is NMS-free and
licence-clean — unlike the YOLOv8/Ultralytics weights (AGPL-3.0) this replaces.
That matters because CamAI ships to a buyer: an AGPL weight in the frozen engine
re-contaminates the binary (see LICENSING.md). RT-DETR-R18 / R50 both export to
the same ONNX contract handled here.

What was NOT changed (backward compatibility)
---------------------------------------------
- Public surface: get_detector() / is_loaded() / unload() and
  HelmetDetector.detect_on_riders(frame, motorcycle_boxes, person_boxes) return
  the exact same detection shape {"class","confidence","bbox"} as before.
- The rider-crop logic (helmet inference runs ONLY on motorcycle+rider crops,
  never the full frame), the fail-loud-never-fake contract, and the lazy
  process-wide singleton.

The RT-DETR ONNX contract (official export)
-------------------------------------------
Inputs : images [N,3,S,S] (RGB /255, CHW) + orig_target_sizes [N,2] int64.
Outputs: labels [N,300] (int class id), boxes [N,300,4] (xyxy, scaled to
         orig_target_sizes), scores [N,300]. NMS-free, top-300.
We letterbox each crop into SxS and pass orig_target_sizes=[S,S], so boxes come
back in SxS pixel space and are un-letterboxed to crop -> frame coords. A single
fused-output export ([1,300,4+nc], cxcywh normalised) is also auto-detected and
decoded, so a differently-exported RT-DETR still works.

Classes are NOT hardcoded — they are read from classes.txt next to the model:
    helmet
    no_helmet
Each line's index is the model's class id; the name is canonicalised to the
engine's helmet/no_helmet vocabulary (so "with helmet"/"No Helmet" also map).
"""
from __future__ import annotations

import os
import re
import sys
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from app import config

try:
    import onnxruntime as ort
    HAS_ORT = True
except Exception:  # pragma: no cover - onnxruntime is a hard dep of the engine
    HAS_ORT = False

_PAD_VALUE = 114           # letterbox pad (grey)
_RIDER_PAD = 0.12          # motorcycle boxes clip the rider's head/helmet
_MIN_CROP_PX = 32          # below this a crop carries no recoverable helmet

CANON_HELMET = "helmet"
CANON_NO_HELMET = "no_helmet"
CANON = (CANON_HELMET, CANON_NO_HELMET)

# Provider preference: CUDA -> DirectML -> CPU. Only those actually present in
# the installed onnxruntime build are offered; the rest fall through to CPU.
_PROVIDER_PREF = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]


def _canon(raw: str) -> Optional[str]:
    """Map a raw class name to helmet / no_helmet / None (ignore). Conservative:
    a name must clearly say helmet, and clearly negate it, to be no_helmet."""
    low = str(raw).strip().lower()
    if "helmet" not in low and "nohelmet" not in low:
        return None
    negated = bool(re.search(r"\b(no|non|without|missing|un)\b", low)) or "nohelmet" in low or low.startswith("no")
    return CANON_NO_HELMET if negated else CANON_HELMET


def _candidate_dirs() -> List[str]:
    """Model search: the configured helmet dir first, then (frozen exe layout)
    alongside the exe / bundle, then the dev tree — mirrors face.py/backend.py."""
    dirs: List[str] = [str(config.HELMET_MODEL_DIR)]
    if getattr(sys, "frozen", False):
        exe_dir = os.path.dirname(sys.executable)
        dirs += [os.path.join(exe_dir, "helmet"), exe_dir, os.path.join(exe_dir, "_internal")]
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            dirs.append(os.path.join(meipass, "helmet"))
    here = os.path.dirname(os.path.abspath(__file__))
    dirs += [
        os.path.join(here, "..", "..", "models", "helmet"),
        os.path.join(here, "..", "..", "models_helmet"),
    ]
    return [os.path.normpath(d) for d in dirs]


def _resolve_model_path() -> Optional[str]:
    """Absolute path to the helmet ONNX, or None. config.HELMET_MODEL may be an
    absolute path or a bare filename resolved against the candidate dirs."""
    name = config.HELMET_MODEL
    if os.path.isabs(name) and os.path.exists(name):
        return name
    for d in _candidate_dirs():
        p = os.path.join(d, name)
        if os.path.exists(p):
            return p
    return None


def _load_classes(model_path: str) -> Dict[int, str]:
    """Read classes.txt (one class per line) next to the model and map each
    line index -> canonical engine class. Refusing to hardcode the mapping is
    the point: a mislabelled index is how a helmet detector reports every helmet
    as a violation."""
    classes_path = os.path.join(os.path.dirname(model_path), config.HELMET_CLASSES_FILE)
    if not os.path.exists(classes_path):
        raise FileNotFoundError(
            f"{config.HELMET_CLASSES_FILE} not found next to the helmet model "
            f"({classes_path}). It names the model's class ids (one per line, "
            "e.g. 'helmet' then 'no_helmet') and without it the detector cannot "
            "tell a violation from compliance."
        )
    out: Dict[int, str] = {}
    with open(classes_path, "r", encoding="utf-8") as fh:
        for idx, line in enumerate(fh):
            name = line.strip()
            if not name:
                continue
            canon = _canon(name)
            if canon:
                out[idx] = canon
    if not out:
        raise ValueError(
            f"{classes_path} maps no line to {CANON} — the helmet model would "
            "produce nothing. It should list 'helmet' and 'no_helmet'."
        )
    return out


def _select_providers() -> List[str]:
    avail = set(ort.get_available_providers()) if HAS_ORT else set()
    chosen = [p for p in _PROVIDER_PREF if p in avail]
    if "CPUExecutionProvider" not in chosen:
        chosen.append("CPUExecutionProvider")  # always a valid last resort
    return chosen


def _letterbox(img: np.ndarray, size: int) -> Tuple[np.ndarray, float]:
    """Aspect-preserving fit into size x size, padded with 114 at bottom/right
    (top-left placement, so un-letterbox is a single divide by scale)."""
    h, w = img.shape[:2]
    s = min(size / w, size / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    canvas = np.full((size, size, 3), _PAD_VALUE, np.uint8)
    canvas[:nh, :nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return canvas, s


def _iou(a: Dict[str, float], b: Dict[str, float]) -> float:
    ix1 = max(a["x1"], b["x1"]); iy1 = max(a["y1"], b["y1"])
    ix2 = min(a["x2"], b["x2"]); iy2 = min(a["y2"], b["y2"])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = (a["x2"] - a["x1"]) * (a["y2"] - a["y1"])
    area_b = (b["x2"] - b["x1"]) * (b["y2"] - b["y1"])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


class HelmetDetector:
    """Lazily constructed. A frame with no motorcycle costs zero inference even
    when enabled; the module disabled costs zero and never loads."""

    def __init__(self, model_path: str, conf: float, nms: float, input_size: int):
        if not HAS_ORT:
            raise RuntimeError("onnxruntime unavailable; cannot run helmet model")
        self.model_path = model_path
        self.conf = float(conf)
        self.nms = float(nms)
        self.input_size = int(input_size)
        self.class_map = _load_classes(model_path)
        self.last_error: Optional[str] = None
        self.last_infer_ms: float = 0.0
        self._lock = threading.Lock()

        t0 = time.time()
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # The pipeline already runs one thread per camera; a few intra-op threads
        # speed a single crop's forward pass without oversubscribing the box.
        so.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2)))
        so.log_severity_level = 3
        self.providers = _select_providers()
        self.session = ort.InferenceSession(model_path, sess_options=so, providers=self.providers)
        self.active_provider = self.session.get_providers()[0]
        try:
            from app.ai.accelerator import guard_cpu_fallback
            guard_cpu_fallback("helmet detector", self.active_provider)
        except RuntimeError:
            raise
        except Exception:
            pass

        # Inspect the REAL model I/O rather than assuming a contract.
        ins = self.session.get_inputs()
        outs = self.session.get_outputs()
        self._in_image = ins[0].name
        self._in_sizes = next((i.name for i in ins if i.name != self._in_image), None)
        # float16 model? feed the dtype it declares ("if supported").
        self._in_dtype = np.float16 if "float16" in ins[0].type else np.float32
        self._sizes_dtype = np.int64
        if self._in_sizes is not None:
            sd = next(i.type for i in ins if i.name == self._in_sizes)
            self._sizes_dtype = np.int32 if "int32" in sd else np.int64

        out_names = [o.name for o in outs]
        if self._in_sizes is not None and len(outs) >= 3:
            self._contract = "triple"   # official RT-DETR: labels/boxes/scores
            self._out_boxes = next((n for n in out_names if "box" in n.lower()), None)
            self._out_labels = next((n for n in out_names if "label" in n.lower() or "class" in n.lower()), None)
            self._out_scores = next((n for n in out_names if "score" in n.lower() or "conf" in n.lower()), None)
            # Fall back to shape-based assignment if names are non-standard.
            if not (self._out_boxes and self._out_labels and self._out_scores):
                self._assign_triple_by_shape(outs)
        else:
            self._contract = "single"   # fused [1,N,4+nc] cxcywh normalised
            self._out_single = out_names[0]

        # Preallocated buffers — reused every call (no per-frame alloc).
        S = self.input_size
        self._blob = np.empty((1, 3, S, S), dtype=self._in_dtype)
        self._sizes = np.array([[S, S]], dtype=self._sizes_dtype)  # square => order-agnostic

        load_ms = (time.time() - t0) * 1000
        print(f"[helmet] RT-DETR loaded from {model_path} in {load_ms:.0f}ms "
              f"| provider={self.active_provider} | contract={self._contract} "
              f"| classes={self.class_map} | input={S}", flush=True)

    def _assign_triple_by_shape(self, outs) -> None:
        """Name-agnostic fallback: boxes is the only 3-D output; of the two 2-D
        outputs, integer dtype => labels, float => scores."""
        self._out_boxes = self._out_labels = self._out_scores = None
        for o in outs:
            shp = o.shape
            if len(shp) == 3:
                self._out_boxes = o.name
            elif "int" in o.type:
                self._out_labels = o.name
            else:
                self._out_scores = o.name

    def set_confidence(self, conf: float) -> None:
        self.conf = float(conf)

    # -- inference ---------------------------------------------------------
    def _run(self, canvas_rgb: np.ndarray) -> List[np.ndarray]:
        """Fill the reusable blob from a letterboxed RGB canvas and run via ORT
        IO binding (works on CPU and GPU EPs; the requested fast path on GPU)."""
        # HWC uint8 RGB -> CHW normalised into the preallocated blob.
        chw = canvas_rgb.astype(self._in_dtype).transpose(2, 0, 1) / self._in_dtype(255)
        np.copyto(self._blob[0], chw)
        io = self.session.io_binding()
        io.bind_cpu_input(self._in_image, self._blob)
        if self._in_sizes is not None:
            io.bind_cpu_input(self._in_sizes, self._sizes)
        if self._contract == "triple":
            for n in (self._out_boxes, self._out_labels, self._out_scores):
                io.bind_output(n)
        else:
            io.bind_output(self._out_single)
        t0 = time.time()
        self.session.run_with_iobinding(io)
        self.last_infer_ms = (time.time() - t0) * 1000
        return io.copy_outputs_to_cpu()

    def _decode(self, outputs: List[np.ndarray], scale: float,
                cx1: int, cy1: int) -> List[Dict[str, Any]]:
        if self._contract == "triple":
            # copy_outputs_to_cpu() returns outputs in the order we bound them:
            # boxes, labels, scores (see _run).
            boxes, labels, scores = outputs[0], outputs[1], outputs[2]
            return self._decode_triple(boxes, labels, scores, scale, cx1, cy1)
        return self._decode_single(outputs[0], scale, cx1, cy1)

    def _decode_triple(self, boxes, labels, scores, scale, cx1, cy1) -> List[Dict[str, Any]]:
        """RT-DETR official: boxes xyxy in SxS px, labels int, scores float."""
        boxes = np.asarray(boxes).reshape(-1, 4)
        labels = np.asarray(labels).reshape(-1)
        scores = np.asarray(scores).reshape(-1)
        S = float(self.input_size)
        out: List[Dict[str, Any]] = []
        for (x1, y1, x2, y2), lab, sc in zip(boxes, labels, scores):
            if sc < self.conf:
                continue
            canon = self.class_map.get(int(lab))
            if canon is None:
                continue
            out.append(self._to_frame(float(x1), float(y1), float(x2), float(y2),
                                      float(sc), canon, scale, cx1, cy1, S))
        return [d for d in out if d]

    def _decode_single(self, out, scale, cx1, cy1) -> List[Dict[str, Any]]:
        """Fused export: [1,N,4+nc] or [1,4+nc,N], row = cx,cy,w,h + class scores,
        no objectness. Handles BOTH coordinate conventions: a plain YOLOv8 detect
        export gives cx,cy,w,h in INPUT PIXELS (0..S), while some fused exports
        give them normalised (0..1). We detect which from the value range rather
        than assume — assuming normalised on a pixel export scaled every box by S
        and produced nothing."""
        arr = np.asarray(out)
        if arr.ndim == 3:
            arr = arr[0]
        if arr.shape[0] < arr.shape[1]:   # [4+nc, N] -> [N, 4+nc]
            arr = arr.T
        nc = arr.shape[1] - 4
        if nc <= 0:
            self.last_error = f"helmet model output has no class columns: {np.asarray(out).shape}"
            return []
        S = float(self.input_size)
        cxcywh = arr[:, :4]
        scores_all = arr[:, 4:]
        cls_ids = np.argmax(scores_all, axis=1)
        cls_conf = scores_all[np.arange(scores_all.shape[0]), cls_ids]
        keep = cls_conf >= self.conf
        cxcywh = cxcywh[keep]; cls_ids = cls_ids[keep]; cls_conf = cls_conf[keep]
        # normalised if every coord sits in [0,~1]; else already input pixels.
        coord_scale = S if (cxcywh.size and float(cxcywh.max()) <= 1.5) else 1.0
        results: List[Dict[str, Any]] = []
        for (cx, cy, w, h), cid, sc in zip(cxcywh, cls_ids, cls_conf):
            canon = self.class_map.get(int(cid))
            if canon is None:
                continue
            x1 = (cx - w / 2) * coord_scale; y1 = (cy - h / 2) * coord_scale
            x2 = (cx + w / 2) * coord_scale; y2 = (cy + h / 2) * coord_scale
            d = self._to_frame(x1, y1, x2, y2, float(sc), canon, scale, cx1, cy1, S)
            if d:
                results.append(d)
        return results

    def _to_frame(self, x1, y1, x2, y2, sc, canon, scale, cx1, cy1, S) -> Optional[Dict[str, Any]]:
        # clamp to the letterboxed content, then SxS px -> crop px -> frame px
        x1 = min(max(x1, 0.0), S); y1 = min(max(y1, 0.0), S)
        x2 = min(max(x2, 0.0), S); y2 = min(max(y2, 0.0), S)
        fx1 = cx1 + x1 / scale; fy1 = cy1 + y1 / scale
        fx2 = cx1 + x2 / scale; fy2 = cy1 + y2 / scale
        if fx2 - fx1 < 2 or fy2 - fy1 < 2:
            return None
        return {"class": canon, "confidence": sc,
                "bbox": {"x1": fx1, "y1": fy1, "x2": fx2, "y2": fy2}}

    def _nms(self, dets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Class-agnostic NMS across crops. RT-DETR is NMS-free within one image,
        but adjacent rider crops overlap, so the same head can decode twice; and
        helmet vs no_helmet on one head must not both survive."""
        if len(dets) < 2:
            return dets
        order = sorted(dets, key=lambda d: d["confidence"], reverse=True)
        keep: List[Dict[str, Any]] = []
        for d in order:
            if all(_iou(d["bbox"], k["bbox"]) <= self.nms for k in keep):
                keep.append(d)
        return keep

    # -- rider association (unchanged) ------------------------------------
    def _rider_crops(self, frame, motorcycle_boxes, person_boxes) -> List[Tuple[int, int, int, int]]:
        fh, fw = frame.shape[:2]
        crops: List[Tuple[int, int, int, int]] = []
        for mb in motorcycle_boxes:
            mx1, my1 = float(mb["x1"]), float(mb["y1"])
            mx2, my2 = float(mb["x2"]), float(mb["y2"])
            ux1, uy1, ux2, uy2 = mx1, my1, mx2, my2
            for pb in person_boxes:
                if pb["x2"] < mx1 or pb["x1"] > mx2:
                    continue
                ux1 = min(ux1, float(pb["x1"])); uy1 = min(uy1, float(pb["y1"]))
                ux2 = max(ux2, float(pb["x2"])); uy2 = max(uy2, float(pb["y2"]))
            bw, bh = ux2 - ux1, uy2 - uy1
            if bw <= 0 or bh <= 0:
                continue
            px, py = bw * _RIDER_PAD, bh * _RIDER_PAD
            cx1 = max(0, int(ux1 - px)); cy1 = max(0, int(uy1 - py))
            cx2 = min(fw, int(ux2 + px)); cy2 = min(fh, int(uy2 + py))
            if cx2 - cx1 < _MIN_CROP_PX or cy2 - cy1 < _MIN_CROP_PX:
                continue
            crops.append((cx1, cy1, cx2, cy2))
        return crops

    def detect_on_riders(self, frame: np.ndarray, motorcycle_boxes: List[Dict[str, float]],
                         person_boxes: List[Dict[str, float]]) -> List[Dict[str, Any]]:
        """helmet/no_helmet detections in absolute frame pixels, shaped like the
        yolox detections so downstream code needs no special case. Never raises —
        one bad crop is recorded in last_error and skipped (fail-safe)."""
        if not motorcycle_boxes:
            return []
        crops = self._rider_crops(frame, motorcycle_boxes, person_boxes)
        if not crops:
            return []
        out: List[Dict[str, Any]] = []
        for (cx1, cy1, cx2, cy2) in crops:
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue
            canvas, scale = _letterbox(crop, self.input_size)
            rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
            try:
                with self._lock:
                    outputs = self._run(rgb)
                    dets = self._decode(outputs, scale, cx1, cy1)
                out.extend(dets)
            except Exception as e:
                self.last_error = str(e)
                continue
        return self._nms(out)


_INSTANCE: Optional[HelmetDetector] = None
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
    print("[helmet] RT-DETR unloaded — no camera requires it", flush=True)
    return True


def get_detector(conf: Optional[float] = None) -> Optional[HelmetDetector]:
    """Process-wide singleton. Returns None (once, loudly) if helmet detection
    is globally disabled, or the model / classes.txt is missing — the feature
    then disables itself and the rest of CamAI runs untouched (fail-safe)."""
    global _INSTANCE, _LOAD_FAILED
    if not config.HELMET_ENABLED:
        return None
    conf = config.HELMET_THRESHOLD if conf is None else conf
    with _LOAD_LOCK:
        if _INSTANCE is not None:
            _INSTANCE.set_confidence(conf)
            return _INSTANCE
        if _LOAD_FAILED:
            return None
        path = _resolve_model_path()
        if not path:
            _LOAD_FAILED = True
            print(
                f"[helmet] '{config.HELMET_MODEL}' not found in {_candidate_dirs()} — "
                "helmet_detection is enabled but cannot run. Place an RT-DETR "
                "ONNX + classes.txt there (see server/prepare_helmet_model.py). "
                "Helmet detection is disabled; the rest of CamAI is unaffected.",
                flush=True,
            )
            return None
        try:
            _INSTANCE = HelmetDetector(path, conf, config.HELMET_NMS, config.HELMET_INPUT_SIZE)
            return _INSTANCE
        except Exception as e:
            _LOAD_FAILED = True
            print(f"[helmet] failed to load RT-DETR from {path}: {e} — helmet "
                  "detection disabled, CamAI continues.", flush=True)
            return None
