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
    7: "truck"
}


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

        config = {"PERFORMANCE_HINT": "LATENCY"}
        if target_device == "CPU":
            config["CPU_THREADS_NUM"] = str(min(4, max(1, os.cpu_count() or 1)))
            config["AFFINITY"] = "CORE"

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
        self.ov_output1 = self.ov_compiled.outputs[1]

        self.backend_type = "openvino"
        self.backend_device = target_device
        print(f"[AI Backend] Successfully initialized OpenVINO engine on {target_device}.")

    def _load_onnx(self, model_path):
        providers = ort.get_available_providers()
        print(f"[AI Backend] ONNX Runtime available providers: {providers}")

        if "CUDAExecutionProvider" in providers:
            provider = "CUDAExecutionProvider"
            device = "CUDA"
        elif "CPUExecutionProvider" in providers:
            provider = "CPUExecutionProvider"
            device = "CPU"
        else:
            raise RuntimeError("ONNX Runtime does not expose CUDA or CPU provider.")

        sess_opts = ort.SessionOptions()
        sess_opts.intra_op_num_threads = min(4, max(1, os.cpu_count() or 1))
        sess_opts.inter_op_num_threads = 1
        sess_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.ort_session = ort.InferenceSession(model_path, sess_options=sess_opts, providers=[provider])
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
            output1 = res[self.ov_output1]
        elif self.backend_type == "onnx":
            # ONNX Runtime sessions are documented thread-safe for concurrent
            # Run() calls from multiple threads — no external lock needed.
            input_name = self.ort_session.get_inputs()[0].name
            res = self.ort_session.run(None, {input_name: img_tensor})
            output0, output1 = res[0], res[1]
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
                    if class_id not in [0, 1, 2, 3, 5, 7]:
                        continue

                    class_name = COCO_CLASS_MAP.get(class_id, "unknown")
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
        class_ids_of_interest = [0, 1, 2, 3, 5, 7]
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

        proto = np.squeeze(output1, axis=0)
        proto_h, proto_w = proto.shape[1], proto.shape[2]
        proto_flat = proto.reshape(32, -1)

        raw_masks = np.matmul(coeffs, proto_flat)
        raw_masks = 1.0 / (1.0 + np.exp(-raw_masks))
        raw_masks = raw_masks.reshape(-1, proto_h, proto_w)

        detections = []
        masks_polygons = []
        orig_h, orig_w = orig_shape

        scale_x = orig_w / target_imgsz
        scale_y = orig_h / target_imgsz
        proto_scale = proto_w / target_imgsz

        for idx in range(len(boxes)):
            box = boxes[idx]
            score = scores[idx]
            cls_id = class_ids[idx]
            mask = raw_masks[idx]

            ox1 = max(0, int(box[0] * scale_x))
            oy1 = max(0, int(box[1] * scale_y))
            ox2 = min(orig_w, int(box[2] * scale_x))
            oy2 = min(orig_h, int(box[3] * scale_y))
            if ox2 <= ox1 or oy2 <= oy1:
                continue

            class_name = COCO_CLASS_MAP.get(cls_id, "unknown")
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
