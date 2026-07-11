import os
import time
import threading
import numpy as np
import cv2

# Try importing execution backends
try:
    import openvino as ov
    HAS_OPENVINO = True
except ImportError:
    HAS_OPENVINO = False

try:
    import onnxruntime as ort
    HAS_ONNXRUNTIME = True
except ImportError:
    HAS_ONNXRUNTIME = False

# Try importing PyTorch/Ultralytics as fallback
try:
    from ultralytics import YOLO
    import torch
    HAS_ULTRALYTICS = True
except ImportError:
    HAS_ULTRALYTICS = False


COCO_CLASS_MAP = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    9: "traffic_light",
    11: "stop_sign",
    # Unattended-item classes — enabled specifically so abandoned-object
    # detection (CameraAnalytics.ITEM_CLASSES) has real detections to work
    # with instead of being permanently a no-op.
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    28: "suitcase",
}
CLASS_IDS_OF_INTEREST = list(COCO_CLASS_MAP.keys())

# Generous per-class geometric plausibility bounds, applied to every
# detection before it ever reaches the tracker. Deliberately loose — this
# rejects only truly degenerate boxes (sub-pixel noise, corrupted
# mask-decode slivers, near-full-frame blowups) rather than anything a real
# vehicle could plausibly look like from some camera angle. CCTV mounting
# varies from steep overhead to low oblique roadside, and vehicles range
# from a distant speck to a truck filling most of the frame at a toll
# gate — narrow bounds here would just trade false positives for false
# negatives, which the goal cares about equally.
_GEOMETRY_BOUNDS = {
    "person":     {"min_area_frac": 0.00005, "max_area_frac": 0.90, "max_aspect": 6.0},
    "bicycle":    {"min_area_frac": 0.00005, "max_area_frac": 0.60, "max_aspect": 6.0},
    "motorcycle": {"min_area_frac": 0.00005, "max_area_frac": 0.60, "max_aspect": 6.0},
    "car":        {"min_area_frac": 0.00010, "max_area_frac": 0.85, "max_aspect": 6.0},
    "bus":        {"min_area_frac": 0.00010, "max_area_frac": 0.90, "max_aspect": 8.0},
    "truck":      {"min_area_frac": 0.00010, "max_area_frac": 0.90, "max_aspect": 8.0},
    "traffic_light": {"min_area_frac": 0.00001, "max_area_frac": 0.20, "max_aspect": 8.0},
    "stop_sign":     {"min_area_frac": 0.00002, "max_area_frac": 0.25, "max_aspect": 4.0},
}
_DEFAULT_GEOMETRY_BOUNDS = {"min_area_frac": 0.00005, "max_area_frac": 0.90, "max_aspect": 8.0}


def _passes_geometry_filter(class_name, x1, y1, x2, y2, frame_w, frame_h) -> bool:
    """False for geometrically-degenerate detections (near-zero-area
    slivers, near-full-frame blowups, extreme aspect-ratio streaks) --
    exactly the shapes a shadow, reflection, or a corrupted decode artifact
    tends to produce, and not what any real vehicle/person looks like from
    any normal camera angle."""
    w = max(1.0, x2 - x1)
    h = max(1.0, y2 - y1)
    area_frac = (w * h) / max(1.0, frame_w * frame_h)
    bounds = _GEOMETRY_BOUNDS.get(class_name, _DEFAULT_GEOMETRY_BOUNDS)
    if area_frac < bounds["min_area_frac"] or area_frac > bounds["max_area_frac"]:
        return False
    aspect = max(w / h, h / w)
    return aspect <= bounds["max_aspect"]


def nms(boxes, scores, iou_threshold):
    """
    Perform Non-Maximum Suppression (NMS) on bounding boxes.
    boxes: numpy array of shape [N, 4] (x1, y1, x2, y2)
    scores: numpy array of shape [N]
    """
    if len(boxes) == 0:
        return []

    x1 = boxes[:, 0]
    y1 = boxes[:, 1]
    x2 = boxes[:, 2]
    y2 = boxes[:, 3]

    areas = (x2 - x1) * (y2 - y1)
    order = scores.argsort()[::-1]

    keep = []
    while order.size > 0:
        i = order[0]
        keep.append(i)

        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])

        w = np.maximum(0.0, xx2 - xx1)
        h = np.maximum(0.0, yy2 - yy1)
        inter = w * h

        ovr = inter / (areas[i] + areas[order[1:]] - inter)

        inds = np.where(ovr <= iou_threshold)[0]
        order = order[inds + 1]

    return keep


class EngineBackend:
    def __init__(self, model_name: str = "yolo11n-seg.pt", preferred_backends=None):
        self.model_name = model_name
        self.backend_type = None  # 'openvino', 'onnx', 'pytorch'
        self.backend_device = None  # 'GPU', 'CPU', 'CUDA', etc.

        # OpenVINO specific
        self.ov_core = None
        self.ov_model = None
        self.ov_compiled = None
        self.ov_output0 = None
        self.ov_output1 = None
        # One InferRequest per calling thread (one per camera pipeline) sharing
        # the same compiled model — this is OpenVINO's supported pattern for
        # concurrent multi-stream inference. A single shared InferRequest (or a
        # Python-level lock serializing compiled_model() calls) forces every
        # camera's AI thread onto one queue: a busy/slow camera can then starve
        # every other camera's detections for tens of seconds.
        self._ov_requests = {}
        self._ov_requests_lock = threading.Lock()

        # ONNX specific
        self.ort_session = None

        # PyTorch specific
        self.yolo_model = None
        # Ultralytics' YOLO() wraps a stateful predictor that isn't documented
        # thread-safe for concurrent calls, unlike OpenVINO/ONNX Runtime — keep
        # this path (rarely used; only when neither OpenVINO nor ONNX models
        # are available) serialized per-instance.
        self._pt_lock = threading.Lock()

        self.preferred_backends = preferred_backends or ["openvino", "onnx", "pytorch"]

        # Load and configure the backend
        self._initialize_backend()

    def _backend_score(self, backend_type: str) -> int:
        """Higher = stronger real acceleration available right now on this
        machine. Candidates are tried in descending score order so a genuine
        NVIDIA CUDA/TensorRT path (goal: "GPU inference with CUDA. TensorRT
        or ONNX optimization. FP16 inference.") always wins when present,
        instead of whichever backend happens to be listed first in
        preferred_backends — that list only filters which backend *types*
        are eligible at all, ordering is decided by actual hardware.
        """
        if backend_type == "onnx" and HAS_ONNXRUNTIME:
            try:
                providers = ort.get_available_providers()
            except Exception:
                providers = []
            if "TensorrtExecutionProvider" in providers:
                return 100  # TensorRT: fused FP16 engine, fastest available
            if "CUDAExecutionProvider" in providers:
                return 90   # plain CUDA EP
            return 10        # CPU-only ONNX Runtime build
        if backend_type == "pytorch" and HAS_ULTRALYTICS:
            try:
                if torch.cuda.is_available():
                    return 85
            except Exception:
                pass
            return 5
        if backend_type == "openvino" and HAS_OPENVINO:
            try:
                if "GPU" in ov.Core().available_devices:
                    return 80  # Intel iGPU/dGPU — real GPU accel, but not CUDA/TensorRT
            except Exception:
                pass
            return 15
        return 0

    def _initialize_backend(self):
        base_name = os.path.splitext(self.model_name)[0]
        ov_xml_path = os.path.join(os.path.dirname(self.model_name) or ".", f"{base_name}_openvino_model", f"{base_name}.xml")
        onnx_path = os.path.join(os.path.dirname(self.model_name) or ".", f"{base_name}.onnx")
        pt_path = self.model_name

        candidates = []
        if "openvino" in self.preferred_backends and HAS_OPENVINO:
            if os.path.exists(ov_xml_path):
                candidates.append(("openvino", ov_xml_path))
            elif os.path.exists(onnx_path):
                candidates.append(("openvino", onnx_path))

        if "onnx" in self.preferred_backends and HAS_ONNXRUNTIME and os.path.exists(onnx_path):
            candidates.append(("onnx", onnx_path))

        if "pytorch" in self.preferred_backends and HAS_ULTRALYTICS and os.path.exists(pt_path):
            candidates.append(("pytorch", pt_path))

        if not candidates:
            raise RuntimeError(
                f"No supported backend source found for {self.model_name}. "
                f"OpenVINO model path: {ov_xml_path}, ONNX path: {onnx_path}, PT path: {pt_path}"
            )

        # Stable sort: ties (e.g. two CPU-only options) keep preferred_backends order.
        candidates.sort(key=lambda c: self._backend_score(c[0]), reverse=True)
        print(f"[AI Backend] Candidate order (best acceleration first): "
              f"{[(bt, self._backend_score(bt)) for bt, _ in candidates]}", flush=True)

        for backend_type, path in candidates:
            try:
                if backend_type == "openvino":
                    self._load_openvino(path)
                elif backend_type == "onnx":
                    self._load_onnx(path)
                elif backend_type == "pytorch":
                    self._load_pytorch(path)
                return
            except Exception as e:
                print(f"[AI Backend] Failed to initialize {backend_type} for {path}: {e}. Trying next backend.")

        raise RuntimeError(f"Failed to initialize any backend for {self.model_name}.")

    def _load_openvino(self, model_path):
        self.ov_core = ov.Core()
        devices = self.ov_core.available_devices
        print(f"[AI Backend] OpenVINO available devices: {devices}")

        force_cpu = os.environ.get("CAMAI_FORCE_CPU", "").lower() in ("1", "true", "yes")
        target_device = "CPU" if force_cpu else ("GPU" if "GPU" in devices else "CPU")
        model = self.ov_core.read_model(model_path)

        # Persist compiled kernels to disk. Without this, GPU in particular
        # re-runs shape-specific kernel JIT compilation (documented
        # elsewhere in this file as taking up to several minutes on first
        # run) on every single process start — including every watchdog-
        # triggered pipeline restart. A cached compile turns that into a
        # fast disk load, which matters for "automatic recovery" and
        # startup latency in production, not just local iteration speed.
        cache_dir = os.path.join(os.path.dirname(model_path) or ".", "ov_cache")
        os.makedirs(cache_dir, exist_ok=True)
        self.ov_core.set_property({"CACHE_DIR": cache_dir})

        config = {"PERFORMANCE_HINT": "LATENCY"}
        if target_device == "CPU":
            # Legacy string-keyed CPU tuning properties ("AFFINITY",
            # "CPU_THREADS_NUM") were removed from the CPU plugin in newer
            # OpenVINO releases (both raise NotFound on 2026.2.1) — every
            # CPU startup wasted a full model compile attempt on these
            # before falling back below. The CPU plugin auto-tunes thread
            # count reasonably under PERFORMANCE_HINT=LATENCY on its own.
            pass
        else:
            # FP16 inference on GPU: halves activation/weight bandwidth and is
            # the throughput win the goal's "FP16 inference" requirement is
            # after. Left off on CPU — most CPUs have no native fp16 compute
            # path, so this would cost accuracy for zero speedup there.
            config["INFERENCE_PRECISION_HINT"] = "f16"

        try:
            self.ov_compiled = self.ov_core.compile_model(model, target_device, config)
        except Exception as e:
            print(f"[AI Backend] Warning: OpenVINO compilation with config {config} failed: {e}. Retrying with default settings.")
            try:
                self.ov_compiled = self.ov_core.compile_model(model, target_device, {"PERFORMANCE_HINT": "LATENCY"})
            except Exception as e2:
                print(f"[AI Backend] Warning: OpenVINO compilation with PERFORMANCE_HINT failed: {e2}. Retrying with no config.")
                self.ov_compiled = self.ov_core.compile_model(model, target_device)
        self.ov_output0 = self.ov_compiled.outputs[0]
        # Detection-only YOLO11 exports (no "-seg" suffix) have a single
        # output (boxes+classes) and skip the segmentation proto/mask head
        # entirely — a real, measured ~2x cheaper inference pass on this
        # hardware (33ms vs 70ms at imgsz=640) since the proto branch is
        # part of the model graph itself, not just a postprocess cost.
        # Supporting both here lets postprocess() skip mask decoding when
        # there's nothing to decode, for whichever model file is configured.
        self.has_seg_output = len(self.ov_compiled.outputs) > 1
        self.ov_output1 = self.ov_compiled.outputs[1] if self.has_seg_output else None

        self.backend_type = "openvino"
        self.backend_device = target_device
        print(f"[AI Backend] Successfully initialized OpenVINO engine on {target_device}.")

    def _load_onnx(self, model_path):
        providers = ort.get_available_providers()
        print(f"[AI Backend] ONNX Runtime available providers: {providers}")

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = min(4, max(1, os.cpu_count() or 1))
        sess_opts.inter_op_num_threads = 1
        sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        # TensorRT EP first when present — it JIT-builds (and caches) a fused
        # FP16 engine for this exact input shape, which is faster than the
        # CUDA EP's generic fp32 kernels. Falls through to plain CUDA, then
        # CPU, exactly like before if TensorRT isn't installed.
        if "TensorrtExecutionProvider" in providers:
            trt_cache_dir = os.path.join(os.path.dirname(model_path) or ".", "trt_cache")
            os.makedirs(trt_cache_dir, exist_ok=True)
            provider_list = [
                ("TensorrtExecutionProvider", {
                    "trt_fp16_enable": True,
                    "trt_engine_cache_enable": True,
                    "trt_engine_cache_path": trt_cache_dir,
                }),
                "CUDAExecutionProvider",
                "CPUExecutionProvider",
            ]
            device = "TensorRT"
        elif "CUDAExecutionProvider" in providers:
            provider_list = ["CUDAExecutionProvider"]
            device = "CUDA"
            # The CUDA EP (unlike TensorRT above) has no runtime fp16-cast
            # option — it just runs whatever precision the graph's weights
            # already are. Goal requires FP16 inference on CUDA, so use a
            # `<model>_fp16.onnx` sibling if one has been exported
            # (e.g. `model.export(format="onnx", half=True)`); otherwise
            # fall back to the fp32 graph rather than fail to load.
            fp16_path = f"{os.path.splitext(model_path)[0]}_fp16.onnx"
            if os.path.exists(fp16_path):
                model_path = fp16_path
                device = "CUDA-FP16"
        elif "CPUExecutionProvider" in providers:
            provider_list = ["CPUExecutionProvider"]
            device = "CPU"
        else:
            raise RuntimeError("ONNX Runtime does not expose TensorRT, CUDA, or CPU provider.")

        try:
            self.ort_session = ort.InferenceSession(model_path, sess_options=sess_opts, providers=provider_list)
        except Exception as e:
            if device == "TensorRT":
                print(f"[AI Backend] Warning: TensorRT EP init failed: {e}. Falling back to CUDA/CPU.")
                fallback = [p for p in ["CUDAExecutionProvider", "CPUExecutionProvider"] if p in providers]
                self.ort_session = ort.InferenceSession(model_path, sess_options=sess_opts, providers=fallback)
                device = "CUDA" if "CUDAExecutionProvider" in fallback else "CPU"
            else:
                raise
        self.has_seg_output = len(self.ort_session.get_outputs()) > 1
        self.backend_type = "onnx"
        self.backend_device = device
        print(f"[AI Backend] Successfully initialized ONNX Runtime engine on {device}.")

    def _load_pytorch(self, model_path):
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[AI Backend] Loading PyTorch model: {model_path} on {device}...")
        self.yolo_model = YOLO(model_path)
        self.backend_type = "pytorch"
        self.backend_device = "CUDA" if device == "cuda" else "CPU"
        print(f"[AI Backend] Successfully initialized PyTorch fallback engine on {self.backend_device}.")

    def _get_ov_infer_request(self):
        """Return this thread's dedicated InferRequest, creating it on first use.

        Multiple InferRequest objects backed by one CompiledModel run concurrently
        without contention — OpenVINO's own scheduler (stream pool) handles the
        actual hardware queuing, which is both safer and far more fair than an
        external Python lock.
        """
        tid = threading.get_ident()
        req = self._ov_requests.get(tid)
        if req is None:
            with self._ov_requests_lock:
                req = self._ov_requests.get(tid)
                if req is None:
                    req = self.ov_compiled.create_infer_request()
                    self._ov_requests[tid] = req
        return req

    def release_thread_request(self):
        """Drop the calling thread's cached InferRequest, if any.

        Call this when a camera pipeline thread is shutting down so a
        restarted camera (new thread, new thread-id) doesn't leave the old
        InferRequest's device buffers cached forever on the shared backend.
        No-op for backends other than OpenVINO (ONNX/PyTorch keep no
        per-thread state here).
        """
        tid = threading.get_ident()
        with self._ov_requests_lock:
            self._ov_requests.pop(tid, None)

    def run_inference(self, img_tensor):
        t0 = time.time()

        if self.backend_type == "openvino":
            req = self._get_ov_infer_request()
            res = req.infer([img_tensor])
            output0 = res[self.ov_output0]
            output1 = res[self.ov_output1] if self.has_seg_output else None
        elif self.backend_type == "onnx":
            # ONNX Runtime sessions are documented thread-safe for concurrent
            # Run() calls from multiple threads — no external lock needed.
            input_name = self.ort_session.get_inputs()[0].name
            res = self.ort_session.run(None, {input_name: img_tensor})
            output0 = res[0]
            output1 = res[1] if self.has_seg_output else None
        elif self.backend_type == "pytorch":
            with self._pt_lock:
                with torch.no_grad():
                    tensor_torch = torch.from_numpy(img_tensor).to("cuda" if self.backend_device == "CUDA" else "cpu")
                    results = self.yolo_model(tensor_torch, verbose=False)
            t_infer = (time.time() - t0) * 1000
            return results, t_infer
        else:
            raise RuntimeError("Backend not initialized.")

        t_infer = (time.time() - t0) * 1000
        return (output0, output1), t_infer

    def benchmark(self, frame, target_size=320, runs=5):
        tensor, t_preprocess = self.preprocess(frame, target_size)
        self.run_inference(tensor)
        measurements = []
        for _ in range(runs):
            start = time.time()
            self.run_inference(tensor)
            measurements.append((time.time() - start) * 1000)
        return float(np.mean(measurements)), float(np.std(measurements)), float(t_preprocess)

    def preprocess(self, frame, target_size=320):
        t0 = time.time()

        resized = cv2.resize(frame, (target_size, target_size), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        img_data = rgb.astype(np.float32) / 255.0
        img_data = np.transpose(img_data, (2, 0, 1))
        img_tensor = np.expand_dims(img_data, axis=0)
        img_tensor = np.ascontiguousarray(img_tensor)

        t_preprocess = (time.time() - t0) * 1000
        return img_tensor, t_preprocess

    def postprocess(self, model_outputs, orig_shape, conf_threshold=0.25, iou_threshold=0.45, target_imgsz=320):
        t0 = time.time()

        if self.backend_type == "pytorch":
            results, _ = model_outputs
            result = results[0]
            detections = []
            masks_polygons = []

            orig_h, orig_w = orig_shape
            boxes = result.boxes
            masks = result.masks

            if boxes is not None:
                xyxys = boxes.xyxy.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                clss = boxes.cls.cpu().numpy()

                for idx, xyxy in enumerate(xyxys):
                    conf = confs[idx]
                    if conf < conf_threshold:
                        continue
                    class_id = int(clss[idx])
                    if class_id not in COCO_CLASS_MAP:
                        continue

                    class_name = COCO_CLASS_MAP.get(class_id, "unknown")
                    if not _passes_geometry_filter(class_name, xyxy[0], xyxy[1], xyxy[2], xyxy[3], orig_w, orig_h):
                        continue
                    detections.append({
                        "class": class_name,
                        "confidence": float(conf),
                        "bbox": {
                            "x1": float(xyxy[0]),
                            "y1": float(xyxy[1]),
                            "x2": float(xyxy[2]),
                            "y2": float(xyxy[3])
                        },
                        "track_id": int(boxes.id[idx].item()) if boxes.id is not None else None
                    })

            if masks is not None and len(masks.data) > 0:
                for mask_tensor in masks.data:
                    mask_np = mask_tensor.cpu().numpy()
                    binary = (mask_np > 0.5).astype("uint8") * 255
                    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    if contours:
                        largest = max(contours, key=cv2.contourArea)
                        epsilon = 0.015 * cv2.arcLength(largest, True)
                        approx = cv2.approxPolyDP(largest, epsilon, True)
                        pts = approx.reshape(-1, 2)
                        norm_pts = [[round(float(pt[0]) / orig_w, 3), round(float(pt[1]) / orig_h, 3)] for pt in pts]
                        masks_polygons.append(norm_pts)

            t_post = (time.time() - t0) * 1000
            return detections, masks_polygons, t_post

        output0, output1 = model_outputs
        out0 = np.squeeze(output0, axis=0)
        out0 = np.transpose(out0, (1, 0))

        x_center = out0[:, 0]
        y_center = out0[:, 1]
        w = out0[:, 2]
        h = out0[:, 3]

        x1 = x_center - w / 2
        y1 = y_center - h / 2
        x2 = x_center + w / 2
        y2 = y_center + h / 2

        boxes = np.stack([x1, y1, x2, y2], axis=1)
        class_ids_of_interest = CLASS_IDS_OF_INTEREST
        scores_interest = out0[:, 4:84][:, class_ids_of_interest]

        max_score_idx = np.argmax(scores_interest, axis=1)
        max_scores = np.max(scores_interest, axis=1)
        max_class_ids = np.array(class_ids_of_interest)[max_score_idx]

        keep_idx = max_scores > conf_threshold
        boxes = boxes[keep_idx]
        scores = max_scores[keep_idx]
        class_ids = max_class_ids[keep_idx]
        coeffs = out0[keep_idx, 84:116]

        if len(boxes) == 0:
            t_post = (time.time() - t0) * 1000
            return [], [], t_post

        nms_keep = nms(boxes, scores, iou_threshold)
        if len(nms_keep) == 0:
            t_post = (time.time() - t0) * 1000
            return [], [], t_post

        boxes = boxes[nms_keep]
        scores = scores[nms_keep]
        class_ids = class_ids[nms_keep]
        coeffs = coeffs[nms_keep]

        # Detection-only exports (no "-seg" suffix) have no second/proto
        # output at all — nothing to decode masks from, and skipping this
        # matmul+sigmoid+per-box contour extraction is most of why the
        # detection-only path is measurably cheaper than the seg path.
        has_masks = output1 is not None
        if has_masks:
            proto = np.squeeze(output1, axis=0)
            proto_h, proto_w = proto.shape[1], proto.shape[2]
            proto_flat = proto.reshape(32, -1)
            raw_masks = np.matmul(coeffs, proto_flat)
            raw_masks = 1.0 / (1.0 + np.exp(-raw_masks))
            raw_masks = raw_masks.reshape(-1, proto_h, proto_w)
            proto_scale = proto_w / target_imgsz

        detections = []
        masks_polygons = []
        orig_h, orig_w = orig_shape

        scale_x = orig_w / target_imgsz
        scale_y = orig_h / target_imgsz

        for idx in range(len(boxes)):
            box = boxes[idx]
            score = scores[idx]
            cls_id = class_ids[idx]

            ox1 = max(0, int(box[0] * scale_x))
            oy1 = max(0, int(box[1] * scale_y))
            ox2 = min(orig_w, int(box[2] * scale_x))
            oy2 = min(orig_h, int(box[3] * scale_y))
            if ox2 <= ox1 or oy2 <= oy1:
                continue

            class_name = COCO_CLASS_MAP.get(cls_id, "unknown")
            if not _passes_geometry_filter(class_name, ox1, oy1, ox2, oy2, orig_w, orig_h):
                continue
            detections.append({
                "class": class_name,
                "confidence": float(score),
                "bbox": {
                    "x1": ox1,
                    "y1": oy1,
                    "x2": ox2,
                    "y2": oy2
                },
                "track_id": None
            })

            if not has_masks:
                masks_polygons.append([])
                continue

            mask = raw_masks[idx]
            mx1 = max(0, int(box[0] * proto_scale))
            my1 = max(0, int(box[1] * proto_scale))
            mx2 = min(proto_w, int(box[2] * proto_scale))
            my2 = min(proto_h, int(box[3] * proto_scale))

            if mx2 <= mx1 or my2 <= my1:
                masks_polygons.append([])
                continue

            cropped_mask = mask[my1:my2, mx1:mx2]
            box_w = ox2 - ox1
            box_h = oy2 - oy1
            resized_mask = cv2.resize(cropped_mask, (box_w, box_h), interpolation=cv2.INTER_LINEAR)
            binary_mask = (resized_mask > 0.5).astype(np.uint8) * 255
            contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if contours:
                largest = max(contours, key=cv2.contourArea)
                epsilon = 0.015 * cv2.arcLength(largest, True)
                approx = cv2.approxPolyDP(largest, epsilon, True)
                pts = approx.reshape(-1, 2)
                norm_pts = []
                for pt in pts:
                    ax = ox1 + pt[0]
                    ay = oy1 + pt[1]
                    norm_pts.append([round(float(ax) / orig_w, 3), round(float(ay) / orig_h, 3)])
                masks_polygons.append(norm_pts)
            else:
                masks_polygons.append([])

        t_post = (time.time() - t0) * 1000
        return detections, masks_polygons, t_post
