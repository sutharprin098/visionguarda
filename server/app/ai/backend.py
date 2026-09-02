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


# ── Shared OpenVINO Core ────────────────────────────────────────────────────
# ov.Core() itself is free; reading `.available_devices` off a FRESH Core is
# not — it enumerates every installed plugin, and on this machine's Intel iGPU
# that measured 2.9-3.9 s. The result is cached inside the Core, so the second
# read on the SAME Core is 0.00 s — but a new Core pays it again in full.
#
# Startup used to build three throwaway Cores per EngineBackend: one for the
# sort key in _initialize_backend, a second for the log line that recomputed
# the very same score purely to print it, and a third in _load_openvino. That
# was 9.9 s of the 10.6 s model load spent re-answering "is there a GPU?" —
# against an actual model compile of 0.3 s and a warm-up of 0.06 s.
#
# One process-wide Core removes all of it. Sharing is the supported pattern
# (one Core can hold many compiled models, and every camera thread already
# shares the one on EngineBackend), and it makes CACHE_DIR a process-wide
# setting rather than something each backend re-applies.
_OV_CORE = None
_OV_CORE_LOCK = threading.Lock()


def get_ov_core():
    """The process-wide ov.Core, created on first use. None without OpenVINO."""
    global _OV_CORE
    if not HAS_OPENVINO:
        return None
    if _OV_CORE is None:
        with _OV_CORE_LOCK:
            if _OV_CORE is None:
                _OV_CORE = ov.Core()
    return _OV_CORE


def ov_available_devices():
    """Cached device list, e.g. ['CPU', 'GPU']. Empty when OpenVINO is absent."""
    core = get_ov_core()
    if core is None:
        return []
    try:
        return list(core.available_devices)
    except Exception:
        return []


def prewarm_ov_devices():
    """Start the (slow) plugin enumeration NOW, on a background thread.

    Enumeration is ~2.5 s of C++ device probing that releases the GIL, and the
    engine spends several seconds after this module is imported doing unrelated
    work — importing fastapi and scipy, opening the database, building routes.
    Running the probe alongside that work costs nothing and means the first
    caller usually finds the answer already cached.

    Nobody has to wait on this thread: get_ov_core() takes the same lock, so a
    caller that arrives early simply blocks until the probe finishes — exactly
    the behaviour it had when the probe was inline. Failures are swallowed
    because this is pure prefetch; the real call path reports its own errors.
    """
    if not HAS_OPENVINO:
        return

    def _probe():
        try:
            ov_available_devices()
        except Exception:
            pass

    threading.Thread(target=_probe, name="ov-device-prewarm", daemon=True).start()


# Fired at import so it overlaps the imports that follow this module —
# app.camera_manager imports backend BEFORE pipeline, and pipeline alone pulls
# in scipy.optimize (~1.5 s), with fastapi (~1.4 s) still to come after it.
# That is enough unrelated work to hide most of the probe.
prewarm_ov_devices()


# Grid strides of the YOLOX detection head. The ONNX/OpenVINO exports are
# produced with decode_in_inference=False, so the graph emits raw per-anchor
# offsets and postprocess() below applies the grid decode itself. That keeps
# the input dimension dynamic (the graph bakes in no grid constants), which is
# what lets the pipeline's adaptive imgsz move between 320 and 1280 against a
# single exported model.
_YOLOX_STRIDES = (8, 16, 32)
_YOLOX_PAD_VALUE = 114


COCO_CLASS_MAP = {
    0: "person",
    1: "bicycle",
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
    9: "traffic_light",
    11: "stop_sign",
    # Animal classes - enabled for livestock, pets, and stray animal detection
    15: "cat",
    16: "dog",
    17: "horse",
    18: "sheep",
    19: "cow",
    # Unattended-item classes — enabled specifically so abandoned-object
    # detection (CameraAnalytics.ITEM_CLASSES) has real detections to work
    # with instead of being permanently a no-op.
    24: "backpack",
    25: "umbrella",
    26: "handbag",
    28: "suitcase",
}
CLASS_IDS_OF_INTEREST = list(COCO_CLASS_MAP.keys())

VISDRONE_CLASS_MAP = {
    0: "person",       # pedestrian
    1: "person",       # people
    2: "bicycle",      # bicycle
    3: "car",          # car
    4: "truck",        # van
    5: "truck",        # truck
    6: "motorcycle",   # tricycle
    7: "motorcycle",   # awning-tricycle
    8: "bus",          # bus
    9: "motorcycle",   # motorcycle
}


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
    "dog":        {"min_area_frac": 0.00005, "max_area_frac": 0.85, "max_aspect": 6.0},
    "cat":        {"min_area_frac": 0.00005, "max_area_frac": 0.85, "max_aspect": 6.0},
    "cow":        {"min_area_frac": 0.00010, "max_area_frac": 0.90, "max_aspect": 6.0},
    "horse":      {"min_area_frac": 0.00010, "max_area_frac": 0.90, "max_aspect": 6.0},
    "sheep":      {"min_area_frac": 0.00005, "max_area_frac": 0.85, "max_aspect": 6.0},
    "animal":     {"min_area_frac": 0.00005, "max_area_frac": 0.90, "max_aspect": 6.0},
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


# Minimum plausible on-disk size (bytes) for a real YOLO model file of each
# kind. A file that exists but is far smaller than this is almost always a
# truncated/corrupted download or a Git-LFS pointer stub — loading it throws a
# cryptic backend-internal error, so we detect it up front and say so plainly.
_MODEL_MIN_BYTES = {".pt": 1_000_000, ".onnx": 1_000_000, ".xml": 2_000, ".bin": 500_000}


def _model_file_problem(path):
    """Return a human-readable reason string if `path` is missing or looks
    corrupted/truncated, else None. Used to turn silent load failures into
    clear, actionable diagnostics in the (frozen) engine log."""
    if not path or not os.path.exists(path):
        return f"file not found: {path}"
    try:
        size = os.path.getsize(path)
    except OSError as e:
        return f"cannot stat file ({e}): {path}"
    ext = os.path.splitext(path)[1].lower()
    floor = _MODEL_MIN_BYTES.get(ext, 0)
    if size < floor:
        return (f"file is only {size} bytes (expected >= {floor} for {ext}); "
                f"likely truncated/corrupted or a Git-LFS pointer: {path}")
    return None


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
    def __init__(self, model_name: str = "yolox_s", preferred_backends=None):
        self.model_name = model_name
        # YOLOX and YOLO11 exports differ in preprocessing (letterbox+raw BGR vs
        # stretch+normalized RGB) and in output layout, so both paths are keyed
        # off the model name. YOLOX is what ships; the YOLO11 path is retained
        # because the pre/postprocess for it is first-party and a buyer holding
        # an Ultralytics licence can drop their own yolo11 export straight in.
        self.is_yolox = "yolox" in os.path.basename(model_name).lower()
        self.is_visdrone = "visdrone" in os.path.basename(model_name).lower()
        self.backend_type = None  # 'openvino', 'onnx'
        self.backend_device = None  # 'GPU', 'CPU', 'CUDA', etc.
        # When non-None, this backend is compiled for ONE fixed input side S and
        # every inference MUST run at [1,3,S,S]. Set only for OpenVINO GPU
        # devices (Intel iGPU/Arc), where per-shape kernel recompiles are the
        # crash-loop cause (see config.IGPU_STATIC_IMGSZ). preprocess/postprocess
        # force this size regardless of the caller's requested imgsz, so the
        # pipeline's adaptive resolution and the tile engine can never feed the
        # static model a shape it was not compiled for. None = dynamic shape
        # (CPU / CUDA / TensorRT), where adaptive resolution stays enabled.
        self.static_imgsz = None
        self.is_igpu = False
        # Logged-once diagnostics so the (frozen) engine log confirms the model
        # is actually producing output tensors of the expected shape, without
        # spamming a line per frame.
        self._logged_output_shape = False
        self._infer_error_count = 0

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
        self._ort_input_name: str | None = None   # cached once after load

        self.preferred_backends = preferred_backends or ["openvino", "onnx"]

        # Per-imgsz YOLOX grid cache: computing np.meshgrid + concatenate every
        # frame costs 2–4 ms at 320×320 and more at 640+. Cache by (imgsz,) so
        # each unique inference size pays the cost exactly once.
        self._yolox_grid_cache: dict = {}

        # Per-thread YOLOX letterbox pad buffer to prevent multi-thread mutation races.
        self._local = threading.local()

        # Lock for YOLOX grid cache population
        self._grid_cache_lock = threading.Lock()

        # Lock for inference execution to guarantee GPU driver thread safety during dynamic compilation
        self._infer_lock = threading.Lock()

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
            if "DmlExecutionProvider" in providers:
                return 75   # DirectML GPU acceleration (Windows DirectX 12)
            return 10        # CPU-only ONNX Runtime build
        if backend_type == "openvino" and HAS_OPENVINO:
            try:
                if "GPU" in ov_available_devices():
                    return 80  # Intel iGPU/dGPU — real GPU accel, but not CUDA/TensorRT
            except Exception:
                pass
            return 15
        return 0

    def _initialize_backend(self):
        from app.config import MODELS_DIR, BASE_DIR
        import sys

        # Determine candidate search paths
        search_dirs = [
            os.getcwd(),
            str(MODELS_DIR),
            str(BASE_DIR),
        ]
        
        # If frozen PyInstaller, search near executable
        if getattr(sys, "frozen", False):
            search_dirs.append(os.path.dirname(sys.executable))
            if hasattr(sys, "_MEIPASS"):
                search_dirs.append(sys._MEIPASS)
                
        # Also try parent directory of BASE_DIR (e.g. server base folder relative to build)
        search_dirs.append(os.path.dirname(str(BASE_DIR)))

        resolved_onnx = None
        resolved_ov_xml = None

        base_name = os.path.splitext(os.path.basename(self.model_name))[0]

        # 1. If self.model_name is an absolute path that exists, use it
        if os.path.isabs(self.model_name) and os.path.exists(self.model_name):
            dir_name = os.path.dirname(self.model_name)
            xml = os.path.join(dir_name, f"{base_name}_openvino_model", f"{base_name}.xml")
            onnx = os.path.join(dir_name, f"{base_name}.onnx")
            if os.path.exists(xml):
                resolved_ov_xml = xml
            if os.path.exists(onnx):
                resolved_onnx = onnx
        else:
            # 2. Search for the files in candidate directories
            for d in search_dirs:
                if not d:
                    continue
                xml = os.path.join(d, f"{base_name}_openvino_model", f"{base_name}.xml")
                onnx = os.path.join(d, f"{base_name}.onnx")

                if os.path.exists(xml) and not resolved_ov_xml:
                    resolved_ov_xml = xml
                if os.path.exists(onnx) and not resolved_onnx:
                    resolved_onnx = onnx

            # Fallback to defaults/as-is if not found
            if not resolved_ov_xml:
                resolved_ov_xml = os.path.join(".", f"{base_name}_openvino_model", f"{base_name}.xml")
            if not resolved_onnx:
                resolved_onnx = os.path.join(".", f"{base_name}.onnx")

        # Explicit, greppable resolution report — the single most useful line
        # when diagnosing "model won't load" inside the frozen EXE, where
        # there's no debugger and cwd/_MEIPASS/exe-dir paths differ from dev.
        print(f"[AI Backend] Resolving model '{self.model_name}'. Searched dirs: {search_dirs}", flush=True)
        print(f"[AI Backend] Candidate files -> "
              f"OpenVINO XML: {resolved_ov_xml} (exists={os.path.exists(resolved_ov_xml)}), "
              f"ONNX: {resolved_onnx} (exists={os.path.exists(resolved_onnx)})", flush=True)

        candidates = []
        if "openvino" in self.preferred_backends and HAS_OPENVINO:
            if os.path.exists(resolved_ov_xml):
                candidates.append(("openvino", resolved_ov_xml))
            elif os.path.exists(resolved_onnx):
                candidates.append(("openvino", resolved_onnx))

        if "onnx" in self.preferred_backends and HAS_ONNXRUNTIME and os.path.exists(resolved_onnx):
            candidates.append(("onnx", resolved_onnx))

        if not candidates:
            # Distinguish "no file at all" (missing model) from "file present
            # but the backend that reads it isn't installed" — different fixes.
            any_file = any(os.path.exists(p) for p in (resolved_ov_xml, resolved_onnx))
            backends_present = (
                f"openvino={HAS_OPENVINO}, onnxruntime={HAS_ONNXRUNTIME}"
            )
            if not any_file:
                msg = (f"MODEL LOAD FAILED — model file for '{self.model_name}' not found. "
                       f"Searched: {search_dirs}. Expected one of: {resolved_ov_xml}, "
                       f"{resolved_onnx}.")
            else:
                msg = (f"MODEL LOAD FAILED — a model file for '{self.model_name}' exists but no "
                       f"backend able to read it is installed ({backends_present}).")
            print(f"[AI Backend] [FAIL] {msg}", flush=True)
            raise RuntimeError(msg)

        # Corruption pre-check: warn (don't hard-fail) so a corrupt OpenVINO
        # export can still fall through to a healthy ONNX/PT sibling instead of
        # killing the whole engine.
        for _bt, _path in candidates:
            _problem = _model_file_problem(_path)
            if _problem:
                print(f"[AI Backend] [WARN] Possibly corrupted model for {_bt}: {_problem}", flush=True)

        # Stable sort: ties (e.g. two CPU-only options) keep preferred_backends order.
        # Score each backend type ONCE and reuse it for both the sort and the log
        # line below — the log used to re-call _backend_score per candidate, which
        # on OpenVINO meant a second full device enumeration purely to print a
        # number the sort had already computed.
        _scores = {bt: self._backend_score(bt) for bt, _ in candidates}
        candidates.sort(key=lambda c: _scores[c[0]], reverse=True)
        print(f"[AI Backend] Candidate order (best acceleration first): "
              f"{[(bt, _scores[bt]) for bt, _ in candidates]}", flush=True)

        last_errors = []
        for backend_type, path in candidates:
            try:
                print(f"[AI Backend] Attempting to load model via {backend_type}: {path}", flush=True)
                if backend_type == "openvino":
                    self._load_openvino(path)
                elif backend_type == "onnx":
                    self._load_onnx(path)
                print(f"[AI Backend] [OK] MODEL LOADED: '{self.model_name}' via "
                      f"{self.backend_type.upper()} on {self.backend_device} "
                      f"(runtime={'GPU' if self.backend_device not in ('CPU', 'cpu') else 'CPU'})", flush=True)
                # Fail loud (and, under CAMAI_REQUIRE_GPU, abort) if the primary
                # detector silently landed on CPU while an accelerator exists.
                try:
                    from app.ai.accelerator import guard_cpu_fallback
                    guard_cpu_fallback(f"primary detector ({self.model_name})",
                                       f"{self.backend_type}:{self.backend_device}")
                except RuntimeError:
                    raise
                except Exception:
                    pass
                return
            except Exception as e:
                last_errors.append(f"{backend_type}: {e}")
                print(f"[AI Backend] [FAIL] MODEL LOAD FAILED ({backend_type}) for {path}: {e}. "
                      f"Trying next backend.", flush=True)

        raise RuntimeError(
            f"MODEL LOAD FAILED — could not initialize ANY backend for '{self.model_name}'. "
            f"Errors: {'; '.join(last_errors)}"
        )

    def _load_openvino(self, model_path):
        self.ov_core = get_ov_core()
        devices = ov_available_devices()
        print(f"[AI Backend] OpenVINO available devices: {devices}")

        force_cpu = os.environ.get("CAMAI_FORCE_CPU", "").lower() in ("1", "true", "yes")
        target_device = "CPU" if force_cpu else ("GPU" if "GPU" in devices else "CPU")
        model = self.ov_core.read_model(model_path)

        # ── Intel GPU: pin ONE static input shape ────────────────────────────
        # An Intel GPU (iGPU or Arc) recompiles kernels for every distinct input
        # shape it sees, each compile costing many seconds and emitting IGC
        # "CISA" errors on some shapes. Left dynamic, the engine's adaptive imgsz
        # plus the multi-resolution tile ladder trigger a runtime compile storm
        # that stalls the watchdog into a restart/recompile crash loop. Reshaping
        # the graph to a single fixed [1,3,S,S] here makes the GPU plugin compile
        # exactly one kernel (disk-cached via CACHE_DIR below), which also runs
        # faster than the dynamic-shape kernel. S is clamped to a multiple of 32
        # for the YOLOX detection head. CPU keeps dynamic shapes (it compiles per
        # shape cheaply and benefits from adaptive resolution).
        # Check model native input shape
        try:
            in_pshape = model.input(0).partial_shape
            if in_pshape.is_static and len(in_pshape.to_shape()) == 4:
                self.static_imgsz = int(in_pshape.to_shape()[2])
        except Exception:
            pass

        if target_device == "GPU":
            try:
                from app.config import IGPU_STATIC_IMGSZ
                s = max(320, (int(IGPU_STATIC_IMGSZ) // 32) * 32)
                model.reshape([1, 3, s, s])
                self.static_imgsz = s
                self.is_igpu = True
                print(f"[AI Backend] Intel GPU detected — pinning static input "
                      f"shape [1,3,{s},{s}] (one cached kernel, no runtime "
                      f"recompiles).", flush=True)
            except Exception as e:
                self.is_igpu = False
                print(f"[AI Backend] Warning: static reshape failed ({e}); "
                      f"using model shape (static={self.static_imgsz}).", flush=True)


        # Persist compiled kernels to disk. Without this, GPU in particular
        # re-runs shape-specific kernel JIT compilation (documented
        # elsewhere in this file as taking up to several minutes on first
        # run) on every single process start — including every watchdog-
        # triggered pipeline restart. A cached compile turns that into a
        # fast disk load, which matters for "automatic recovery" and
        # startup latency in production, not just local iteration speed.
        # Write the compile cache to a GUARANTEED-writable per-user data dir,
        # NOT next to the model. In the shipped EXE the model lives inside the
        # app's install/resources folder, which a standard user often can't
        # write to (and which must stay clean — a stray cache dir there also
        # breaks --clean rebuilds). HISTORY_DIR resolves to %APPDATA%/CamAI
        # (see app.config), always writable. Falls back to a temp dir if even
        # that can't be created, and finally to disabling the cache rather than
        # failing model load over a cache-dir problem.
        cache_dir = None
        try:
            from app.config import HISTORY_DIR
            cache_dir = os.path.join(str(HISTORY_DIR), "ov_cache")
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            try:
                import tempfile
                cache_dir = os.path.join(tempfile.gettempdir(), "camai_ov_cache")
                os.makedirs(cache_dir, exist_ok=True)
            except Exception:
                cache_dir = None
        if cache_dir:
            try:
                self.ov_core.set_property({"CACHE_DIR": cache_dir})
                print(f"[AI Backend] OpenVINO compile cache dir: {cache_dir}", flush=True)
            except Exception as e:
                print(f"[AI Backend] OpenVINO cache disabled (set_property failed: {e})", flush=True)

        config = {
            "PERFORMANCE_HINT": "LATENCY",
        }
        try:
            import openvino.properties as props
            config[props.enable_profiling()] = True
        except Exception:
            config["PERF_COUNT"] = "YES"
        if target_device == "CPU":
            pass
        else:
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
                "DmlExecutionProvider",
                "CPUExecutionProvider",
            ]
            device = "TensorRT"
        elif "CUDAExecutionProvider" in providers:
            provider_list = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
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
        elif "DmlExecutionProvider" in providers:
            provider_list = ["DmlExecutionProvider", "CPUExecutionProvider"]
            device = "DirectML"
        elif "CPUExecutionProvider" in providers:
            provider_list = ["CPUExecutionProvider"]
            device = "CPU"
        else:
            raise RuntimeError("ONNX Runtime does not expose TensorRT, CUDA, DirectML, or CPU provider.")

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
        self._ort_input_name = self.ort_session.get_inputs()[0].name  # cache once
        print(f"[AI Backend] Successfully initialized ONNX Runtime engine on {device}.")

    def _get_ov_infer_request(self):
        """Returns a thread-local InferRequest object for lock-free parallel GPU inference."""
        req = getattr(self._local, "ov_infer_req", None)
        if req is None:
            with self._ov_requests_lock:
                req = self.ov_compiled.create_infer_request()
                self._local.ov_infer_req = req
        return req

    def release_thread_request(self):
        if hasattr(self._local, "ov_infer_req"):
            delattr(self._local, "ov_infer_req")

    def run_inference(self, img_tensor):
        t0 = time.time()

        try:
            if self.backend_type == "openvino":
                req = self._get_ov_infer_request()
                ov_tensor = ov.Tensor(img_tensor)
                res = req.infer({self.ov_compiled.inputs[0]: ov_tensor})
                output0 = res[self.ov_output0]
                output1 = res[self.ov_output1] if self.has_seg_output else None
            elif self.backend_type == "onnx":
                res = self.ort_session.run(None, {self._ort_input_name: img_tensor})
                output0 = res[0]
                output1 = res[1] if self.has_seg_output else None
            else:
                raise RuntimeError("Backend not initialized.")
        except Exception as e:
            self._infer_error_count += 1
            if self._infer_error_count <= 5:
                print(f"[AI Backend] [FAIL] INFERENCE ERROR #{self._infer_error_count} "
                      f"({self.backend_type}/{self.backend_device}): {e}", flush=True)
            raise

        if not self._logged_output_shape:
            self._logged_output_shape = True
            _shape0 = getattr(output0, "shape", "?")
            _shape1 = getattr(output1, "shape", None) if output1 is not None else None
            print(f"[AI Backend] First inference OK ({self.backend_type}/{self.backend_device}). "
                  f"Input tensor {getattr(img_tensor, 'shape', '?')} ->"
                  f" output0 shape {_shape0}"
                  + (f", output1(proto) shape {_shape1}" if _shape1 is not None else "")
                  + ".", flush=True)

        t_infer = (time.time() - t0) * 1000
        return (output0, output1), t_infer

    def run_inference_ns(self, img_tensor, enable_layer_profiling=False):
        """High-precision nanosecond inference runner supporting OpenVINO async completion callback & layer profiling."""
        t_submit_ns = time.perf_counter_ns()
        t_complete_ns = t_submit_ns
        layer_profiling = []

        try:
            if self.backend_type == "openvino":
                req = self._get_ov_infer_request()
                ov_tensor = ov.Tensor(img_tensor)
                req.set_input_tensor(ov_tensor)

                completed_event = threading.Event()
                def _on_complete(*args, **kwargs):
                    nonlocal t_complete_ns
                    t_complete_ns = time.perf_counter_ns()
                    completed_event.set()

                try:
                    req.set_callback(_on_complete, None)
                except Exception:
                    try:
                        req.set_callback(_on_complete)
                    except Exception:
                        pass
                t_submit_ns = time.perf_counter_ns()
                req.start_async()
                req.wait()
                if t_complete_ns == t_submit_ns:
                    t_complete_ns = time.perf_counter_ns()

                output0 = req.get_tensor(self.ov_output0).data
                output1 = req.get_tensor(self.ov_output1).data if self.has_seg_output and self.ov_output1 is not None else None

                if enable_layer_profiling:
                    try:
                        p_info = req.get_profiling_info()
                        for p in p_info:
                            if hasattr(p.real_time, 'total_seconds'):
                                real_us = int(p.real_time.total_seconds() * 1e6)
                            elif hasattr(p.real_time, 'count'):
                                real_us = p.real_time.count()
                            else:
                                real_us = int(p.real_time)

                            if hasattr(p.cpu_time, 'total_seconds'):
                                cpu_us = int(p.cpu_time.total_seconds() * 1e6)
                            elif hasattr(p.cpu_time, 'count'):
                                cpu_us = p.cpu_time.count()
                            else:
                                cpu_us = int(p.cpu_time)
                            layer_profiling.append({
                                "node_name": str(getattr(p, 'node_name', getattr(p, 'layer_name', 'unknown'))),
                                "exec_type": str(getattr(p, 'exec_type', '')),
                                "real_time_us": real_us,
                                "cpu_time_us": cpu_us,
                                "status": str(getattr(p, 'status', 'EXECUTED')),
                            })
                    except Exception as pe:
                        print(f"[AI Backend] Warning: Profiling info extraction failed: {pe}", flush=True)

            elif self.backend_type == "onnx":
                t_submit_ns = time.perf_counter_ns()
                res = self.ort_session.run(None, {self._ort_input_name: img_tensor})
                t_complete_ns = time.perf_counter_ns()
                output0 = res[0]
                output1 = res[1] if self.has_seg_output else None
            else:
                raise RuntimeError("Backend not initialized.")
        except Exception as e:
            self._infer_error_count += 1
            if self._infer_error_count <= 5:
                print(f"[AI Backend] [FAIL] INFERENCE ERROR #{self._infer_error_count} "
                      f"({self.backend_type}/{self.backend_device}): {e}", flush=True)
            raise

        dur_ns = t_complete_ns - t_submit_ns
        return (output0, output1), dur_ns, t_submit_ns, t_complete_ns, layer_profiling

    def benchmark(self, frame, target_size=320, runs=5):
        tensor, t_preprocess = self.preprocess(frame, target_size)
        self.run_inference(tensor)
        measurements = []
        for _ in range(runs):
            start = time.time()
            self.run_inference(tensor)
            measurements.append((time.time() - start) * 1000)
        return float(np.mean(measurements)), float(np.std(measurements)), float(t_preprocess)

    @staticmethod
    def _yolox_scale(orig_h, orig_w, target_size):
        """Letterbox scale factor for a frame of this shape at this imgsz.

        Deliberately recomputed from shape rather than carried over from
        preprocess(): every camera pipeline calls preprocess/postprocess
        concurrently on one shared backend, so stashing per-call state on self
        would race. Both sides derive it from the same two numbers instead.
        """
        return min(target_size / orig_h, target_size / orig_w)

    def preprocess(self, frame, target_size=320):
        t0 = time.time()

        # A statically-compiled GPU model accepts ONLY its pinned size; ignore
        # whatever imgsz the caller asked for so no adaptive/tile pass can ever
        # feed it a shape it was not compiled for.
        if self.static_imgsz is not None:
            target_size = self.static_imgsz

        if self.is_yolox:
            # YOLOX letterboxes to preserve aspect ratio, pads the unused right
            # and bottom edges with 114, and consumes raw BGR in 0-255 — it has
            # no normalization layer, so dividing by 255 here would silently
            # scale every activation down and produce near-empty detections.
            orig_h, orig_w = frame.shape[:2]
            r = self._yolox_scale(orig_h, orig_w, target_size)
            new_h, new_w = int(round(orig_h * r)), int(round(orig_w * r))
            # Thread-local letterbox pad buffer eliminates multi-thread race conditions
            # when adaptive tiling/concurrent camera pipelines infer at different resolutions.
            pad_buf = getattr(self._local, "pad_buf", None)
            pad_buf_size = getattr(self._local, "pad_buf_size", 0)
            if pad_buf_size != target_size or pad_buf is None:
                pad_buf = np.full((target_size, target_size, 3), _YOLOX_PAD_VALUE, dtype=np.uint8)
                self._local.pad_buf = pad_buf
                self._local.pad_buf_size = target_size
            else:
                if new_h < target_size:
                    pad_buf[new_h:, :] = _YOLOX_PAD_VALUE
                if new_w < target_size:
                    pad_buf[:new_h, new_w:] = _YOLOX_PAD_VALUE
            cv2.resize(frame, (new_w, new_h), dst=pad_buf[:new_h, :new_w],
                       interpolation=cv2.INTER_LINEAR)
            img_data = pad_buf.transpose(2, 0, 1).astype(np.float32)
        else:
            resized = cv2.resize(frame, (target_size, target_size), interpolation=cv2.INTER_LINEAR)
            rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            img_data = rgb.astype(np.float32) / 255.0
            img_data = np.transpose(img_data, (2, 0, 1))

        img_tensor = np.ascontiguousarray(np.expand_dims(img_data, axis=0))

        t_preprocess = (time.time() - t0) * 1000
        return img_tensor, t_preprocess

    def _yolox_grid(self, target_imgsz):
        """Per-anchor (grid_x, grid_y) and stride columns for this imgsz.

        Cached by target_imgsz: the result is identical for every frame at the
        same resolution, and recomputing meshgrid + concatenate on every
        postprocess call costs 2–4 ms for no reason.
        """
        cached = self._yolox_grid_cache.get(target_imgsz)
        if cached is not None:
            return cached
        with self._grid_cache_lock:
            cached = self._yolox_grid_cache.get(target_imgsz)
            if cached is not None:
                return cached
            grids, strides = [], []
            for s in _YOLOX_STRIDES:
                gh = gw = target_imgsz // s
                xv, yv = np.meshgrid(np.arange(gw), np.arange(gh))
                grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
                strides.append(np.full((gh * gw, 1), s, dtype=np.float32))
            result = np.concatenate(grids, 0).astype(np.float32), np.concatenate(strides, 0)
            self._yolox_grid_cache[target_imgsz] = result
            return result

    def _postprocess_yolox(self, model_outputs, orig_shape, conf_threshold, iou_threshold,
                           target_imgsz, t0, geometry_shape=None):
        output0, _ = model_outputs
        out = np.squeeze(output0, axis=0)

        grid, stride = self._yolox_grid(target_imgsz)
        if grid.shape[0] != out.shape[0]:
            # Only happens if the imgsz used for preprocess and postprocess drift
            # apart; decoding against a mismatched grid silently yields garbage
            # boxes rather than raising, so fail loudly instead.
            raise RuntimeError(
                f"YOLOX grid mismatch: model returned {out.shape[0]} anchors but imgsz "
                f"{target_imgsz} implies {grid.shape[0]}."
            )

        # Ultra-fast candidate pruning: filter low-objectness background anchors
        # BEFORE computing spatial grid decode, exponentiation, and array concatenations.
        obj_scores = out[:, 4]
        cand_mask = obj_scores > (conf_threshold * 0.4)
        if not np.any(cand_mask):
            return [], [], (time.time() - t0) * 1000

        out_c = out[cand_mask]
        grid_c = grid[cand_mask]
        stride_c = stride[cand_mask]

        class_ids_of_interest = CLASS_IDS_OF_INTEREST
        scores_interest = out_c[:, 5:][:, class_ids_of_interest] * out_c[:, 4:5]
        max_score_idx = np.argmax(scores_interest, axis=1)
        max_scores = np.max(scores_interest, axis=1)
        max_class_ids = np.array(class_ids_of_interest)[max_score_idx]

        keep_idx = max_scores > conf_threshold
        if not np.any(keep_idx):
            return [], [], (time.time() - t0) * 1000

        out_k = out_c[keep_idx]
        grid_k = grid_c[keep_idx]
        stride_k = stride_c[keep_idx]

        xy = (out_k[:, :2] + grid_k) * stride_k
        wh = np.exp(np.minimum(out_k[:, 2:4], 10.0)) * stride_k
        boxes = np.concatenate([xy - wh / 2, xy + wh / 2], axis=1)
        scores = max_scores[keep_idx]
        class_ids = max_class_ids[keep_idx]

        nms_keep = nms(boxes, scores, iou_threshold)
        if len(nms_keep) == 0:
            return [], [], (time.time() - t0) * 1000

        boxes = boxes[nms_keep]
        scores = scores[nms_keep]
        class_ids = class_ids[nms_keep]

        orig_h, orig_w = orig_shape
        geom_h, geom_w = geometry_shape if geometry_shape else (orig_h, orig_w)
        # Undo the letterbox. Padding only ever sits on the right/bottom edges,
        # so the scale divides out and there is no offset to subtract.
        r = self._yolox_scale(orig_h, orig_w, target_imgsz)

        detections = []
        for idx in range(len(boxes)):
            box = boxes[idx] / r
            ox1 = max(0, int(box[0]))
            oy1 = max(0, int(box[1]))
            ox2 = min(orig_w, int(box[2]))
            oy2 = min(orig_h, int(box[3]))
            if ox2 <= ox1 or oy2 <= oy1:
                continue

            class_name = COCO_CLASS_MAP.get(class_ids[idx], "unknown")
            if not _passes_geometry_filter(class_name, ox1, oy1, ox2, oy2, geom_w, geom_h):
                continue
            detections.append({
                "class": class_name,
                "confidence": float(scores[idx]),
                "bbox": {"x1": ox1, "y1": oy1, "x2": ox2, "y2": oy2},
                "track_id": None,
            })

        # Detection-only model: callers index masks_polygons in lockstep with
        # detections, so return an empty polygon per detection rather than [].
        return detections, [[] for _ in detections], (time.time() - t0) * 1000

    def postprocess(self, model_outputs, orig_shape, conf_threshold=0.25, iou_threshold=0.45,
                    target_imgsz=320, geometry_shape=None):
        """Decode model output into detections in `orig_shape` pixel coordinates.

        `geometry_shape` overrides the reference frame used by the
        degenerate-shape filter ONLY (see _passes_geometry_filter); boxes are
        still returned in `orig_shape` coordinates. Callers that infer on a CROP
        of a larger frame — the ROI pre-crop in the pipeline's AI loop, and every
        tile pass in app.ai.tiling — pass the full frame's shape here. Both are
        pure translations of full-frame pixel coordinates, so a box's absolute
        size is identical in either system and the filter's "is this a plausible
        size for a person" test only means what it says when measured against the
        whole frame. Judged against a 1/9 crop instead, a pedestrian standing
        near the camera reads as a >90%-of-image blowup and is thrown away.

        Defaults to None (= use orig_shape), which is the original behaviour for
        every caller inferring on a whole frame.
        """
        t0 = time.time()

        # The tensor was run at the pinned static size regardless of the caller's
        # target_imgsz (see preprocess); the grid decode must use that same size
        # or every box lands in the wrong place.
        if self.static_imgsz is not None:
            target_imgsz = self.static_imgsz

        if self.is_yolox:
            return self._postprocess_yolox(
                model_outputs, orig_shape, conf_threshold, iou_threshold, target_imgsz, t0,
                geometry_shape=geometry_shape,
            )

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
        if self.is_visdrone:
            scores_interest = out0[:, 4:14]
            max_score_idx = np.argmax(scores_interest, axis=1)
            max_scores = np.max(scores_interest, axis=1)
            max_class_ids = max_score_idx
        else:
            class_ids_of_interest = CLASS_IDS_OF_INTEREST
            scores_interest = out0[:, 4:84][:, class_ids_of_interest]
            max_score_idx = np.argmax(scores_interest, axis=1)
            max_scores = np.max(scores_interest, axis=1)
            max_class_ids = np.array(class_ids_of_interest)[max_score_idx]

        keep_idx = max_scores > conf_threshold
        boxes = boxes[keep_idx]
        scores = max_scores[keep_idx]
        class_ids = max_class_ids[keep_idx]
        coeffs = out0[keep_idx, 84:116] if out0.shape[1] > 84 else np.zeros((len(boxes), 0))

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
        has_masks = output1 is not None and coeffs.shape[1] > 0
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
        geom_h, geom_w = geometry_shape if geometry_shape else (orig_h, orig_w)

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

            class_name = (
                VISDRONE_CLASS_MAP.get(cls_id, "unknown")
                if self.is_visdrone
                else COCO_CLASS_MAP.get(cls_id, "unknown")
            )

            if not _passes_geometry_filter(class_name, ox1, oy1, ox2, oy2, geom_w, geom_h):
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
