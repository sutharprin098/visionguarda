import os
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from .env
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _key, _, _value = _line.partition("=")
        os.environ.setdefault(_key.strip(), _value.strip().strip('"').strip("'"))

# Custom history directory resolution
history_env = os.getenv("CAMAI_HISTORY_DIR")
if history_env:
    HISTORY_DIR = Path(history_env)
else:
    appdata = os.getenv("APPDATA")
    if appdata:
        HISTORY_DIR = Path(appdata) / "CamAI" / "history"
    else:
        home = os.getenv("USERPROFILE") or os.getenv("HOME")
        if home:
            HISTORY_DIR = Path(home) / ".camai" / "history"
        else:
            HISTORY_DIR = BASE_DIR / "history"

RECORDINGS_DIR = HISTORY_DIR / "recordings"
DB_PATH = HISTORY_DIR / "db.sqlite"
UPLOADS_DIR = HISTORY_DIR / "uploads"
MODELS_DIR = HISTORY_DIR.parent / "models"

# Ensure target directories exist
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# YOLO Core Settings
YOLO_MODEL = os.getenv("CAMAI_YOLO_MODEL", "yolox_tiny").strip()
try:
    CONFIDENCE_THRESHOLD = float(os.getenv("CAMAI_CONFIDENCE_THRESHOLD", "0.25"))
except ValueError:
    CONFIDENCE_THRESHOLD = 0.25
IOU_THRESHOLD = 0.5
INFERENCE_SIZE = 320

# Zero-DCE Night-Vision Settings
ZERO_DCE_ENABLED = os.getenv("CAMAI_ZERO_DCE", "true").strip().lower() in ("1", "true", "yes", "on")
try:
    ZERO_DCE_THRESHOLD = float(os.getenv("CAMAI_ZERO_DCE_THRESHOLD", "80.0"))
except ValueError:
    ZERO_DCE_THRESHOLD = 80.0

# Hybrid Cloud / Local Engine Mode
_raw_mode = os.getenv("CAMAI_INFERENCE_MODE", "local").strip().lower()
INFERENCE_MODE = "cloud" if _raw_mode == "cloud" else "local"
CLOUD_ENDPOINT_URL = os.getenv("CAMAI_CLOUD_ENDPOINT_URL", "http://13.203.71.14:8000").strip()
CLOUD_API_KEY = os.getenv("CAMAI_CLOUD_API_KEY", "").strip()

ENGINE_SETTINGS_FILE = HISTORY_DIR / "engine_settings.json"

def load_persisted_engine_settings():
    global INFERENCE_MODE, CLOUD_ENDPOINT_URL, CLOUD_API_KEY
    if ENGINE_SETTINGS_FILE.exists():
        try:
            import json
            data = json.loads(ENGINE_SETTINGS_FILE.read_text())
            if "inference_mode" in data and not os.getenv("CAMAI_INFERENCE_MODE"):
                m = str(data["inference_mode"]).strip().lower()
                INFERENCE_MODE = "cloud" if m == "cloud" else "local"
            if "cloud_url" in data and not os.getenv("CAMAI_CLOUD_ENDPOINT_URL"):
                CLOUD_ENDPOINT_URL = str(data["cloud_url"]).strip()
            if "cloud_key" in data and not os.getenv("CAMAI_CLOUD_API_KEY"):
                CLOUD_API_KEY = str(data["cloud_key"]).strip()
        except Exception as e:
            print(f"[config] Notice loading engine_settings.json: {e}", flush=True)

load_persisted_engine_settings()

def save_engine_settings():
    try:
        import json
        data = {
            "inference_mode": INFERENCE_MODE,
            "cloud_url": CLOUD_ENDPOINT_URL,
            "cloud_key": CLOUD_API_KEY
        }
        ENGINE_SETTINGS_FILE.write_text(json.dumps(data, indent=2))
    except Exception as e:
        print(f"[config] Failed to save engine_settings.json: {e}", flush=True)

# Hardware Profile Pin
try:
    IGPU_STATIC_IMGSZ = int(os.getenv("CAMAI_IGPU_STATIC_IMGSZ", "416"))
except ValueError:
    IGPU_STATIC_IMGSZ = 416

MODEL_BENCHMARK_MODE = os.getenv("CAMAI_MODEL_BENCHMARK", "auto").strip().lower()
if MODEL_BENCHMARK_MODE not in ("auto", "on", "off"):
    MODEL_BENCHMARK_MODE = "auto"

REQUIRE_GPU = os.getenv("CAMAI_REQUIRE_GPU", "").strip().lower() in ("1", "true", "yes", "on")

# MJPEG Stream & Recording Settings
MJPEG_MAX_FPS = float(os.getenv("CAMAI_MJPEG_MAX_FPS", "60"))
RECORDING_FPS = 10
RECORDING_WIDTH = 640
RECORDING_HEIGHT = 480
SEGMENT_DURATION_SECS = 600
PRE_EVENT_BUFFER_SECS = 5
POST_EVENT_RECORD_SECS = 5

# Helper Functions
def _env_bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")

def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "")) if os.getenv(name) else default
    except ValueError:
        return default

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "")) if os.getenv(name) else default
    except ValueError:
        return default

# Helmet Detection
HELMET_ENABLED = _env_bool("CAMAI_HELMET_ENABLED", True)
HELMET_MODEL_DIR = Path(os.getenv("CAMAI_HELMET_MODEL_DIR", str(MODELS_DIR / "helmet")))
HELMET_MODEL = os.getenv("CAMAI_HELMET_MODEL", "rtdetr_helmet.onnx")
HELMET_CLASSES_FILE = os.getenv("CAMAI_HELMET_CLASSES", "classes.txt")
HELMET_THRESHOLD = _env_float("CAMAI_HELMET_THRESHOLD", 0.35)
HELMET_NMS = _env_float("CAMAI_HELMET_NMS", 0.45)
HELMET_INPUT_SIZE = _env_int("CAMAI_HELMET_INPUT_SIZE", 640)
HELMET_COOLDOWN = _env_float("CAMAI_HELMET_COOLDOWN", 15.0)
HELMET_INTERVAL_S = _env_float("CAMAI_HELMET_INTERVAL_S", 0.3)

VEHICLE_ACTION_MIN_CONFIDENCE = _env_float("CAMAI_VEHICLE_ACTION_MIN_CONFIDENCE", 0.5)
HELMET_RIDER_MIN_PERSON_CONFIDENCE = _env_float("CAMAI_HELMET_RIDER_MIN_PERSON_CONFIDENCE", 0.5)
HELMET_RESULT_TTL_S = _env_float("CAMAI_HELMET_RESULT_TTL_S", 1.5)

# ANPR Number Plate Detection
ANPR_ENABLED = _env_bool("CAMAI_ANPR_ENABLED", True)
ANPR_MODEL_DIR = Path(os.getenv("CAMAI_ANPR_MODEL_DIR", str(MODELS_DIR / "plate")))
ANPR_MODEL = os.getenv("CAMAI_ANPR_MODEL", "plate_detector.onnx")
ANPR_CLASSES_FILE = os.getenv("CAMAI_ANPR_CLASSES", "classes.txt")
ANPR_THRESHOLD = _env_float("CAMAI_ANPR_THRESHOLD", 0.15)
ANPR_NMS = _env_float("CAMAI_ANPR_NMS", 0.3)
ANPR_ASPECT_MIN = _env_float("CAMAI_ANPR_ASPECT_MIN", 1.2)
ANPR_ASPECT_MAX = _env_float("CAMAI_ANPR_ASPECT_MAX", 6.5)
ANPR_MIN_PLATE_W = _env_int("CAMAI_ANPR_MIN_PLATE_W", 24)
ANPR_UPSCALE_TO_W = _env_int("CAMAI_ANPR_UPSCALE_TO_W", 320)
ANPR_PLATE_PAD_FRAC = _env_float("CAMAI_ANPR_PLATE_PAD_FRAC", 0.08)
ANPR_MAX_AREA_FRAC = _env_float("CAMAI_ANPR_MAX_AREA_FRAC", 0.35)

# ANPR OCR Settings
ANPR_OCR_ENABLED = _env_bool("CAMAI_ANPR_OCR_ENABLED", True)
ANPR_OCR_MODEL = os.getenv("CAMAI_ANPR_OCR_MODEL", "plate_ocr.onnx")
ANPR_OCR_CHARSET = os.getenv("CAMAI_ANPR_OCR_CHARSET", "charset.txt")
ANPR_OCR_MIN_LEN = _env_int("CAMAI_ANPR_OCR_MIN_LEN", 4)
ANPR_COUNTRY = os.getenv("CAMAI_ANPR_COUNTRY", "IN")
ANPR_OCR_MIN_CONF = _env_float("CAMAI_ANPR_OCR_MIN_CONF", 0.35)
ANPR_REQUIRE_VALID_FORMAT = _env_bool("CAMAI_ANPR_REQUIRE_VALID_FORMAT", True)
ANPR_OCR_BEAM_WIDTH = _env_int("CAMAI_ANPR_OCR_BEAM_WIDTH", 12)
ANPR_OCR_MAX_VARIANTS = _env_int("CAMAI_ANPR_OCR_MAX_VARIANTS", 4)
ANPR_OCR_EARLY_EXIT_CONF = _env_float("CAMAI_ANPR_OCR_EARLY_EXIT_CONF", 0.80)
ANPR_OCR_DESKEW = _env_bool("CAMAI_ANPR_OCR_DESKEW", True)
ANPR_OCR_RECTIFY = _env_bool("CAMAI_ANPR_OCR_RECTIFY", True)
ANPR_OCR_TWO_ROW = _env_bool("CAMAI_ANPR_OCR_TWO_ROW", True)
ANPR_TWO_ROW_ASPECT = _env_float("CAMAI_ANPR_TWO_ROW_ASPECT", 2.6)
ANPR_OCR_MIN_CROP_W = _env_int("CAMAI_ANPR_OCR_MIN_CROP_W", 24)
ANPR_OCR_MIN_CROP_H = _env_int("CAMAI_ANPR_OCR_MIN_CROP_H", 8)
ANPR_BLUR_MIN = _env_float("CAMAI_ANPR_BLUR_MIN", 12.0)

# ANPR Track Aggregation
ANPR_TRACK_MIN_READS = _env_int("CAMAI_ANPR_TRACK_MIN_READS", 2)
ANPR_TRACK_SETTLE_VOTES = _env_int("CAMAI_ANPR_TRACK_SETTLE_VOTES", 3)
ANPR_TRACK_SETTLE_CONF = _env_float("CAMAI_ANPR_TRACK_SETTLE_CONF", 0.65)
ANPR_TRACK_TTL_S = _env_float("CAMAI_ANPR_TRACK_TTL_S", 60.0)

# ANPR Async & Debug
ANPR_ASYNC = _env_bool("CAMAI_ANPR_ASYNC", True)
ANPR_QUEUE_MAX = _env_int("CAMAI_ANPR_QUEUE_MAX", 2)
ANPR_RESULT_TTL_S = _env_float("CAMAI_ANPR_RESULT_TTL_S", 2.0)
ANPR_DEBUG = _env_bool("CAMAI_ANPR_DEBUG", False)
ANPR_DEBUG_DIR = Path(os.getenv("CAMAI_ANPR_DEBUG_DIR", str(RECORDINGS_DIR / "anpr_debug")))
ANPR_DEBUG_MAX_ATTEMPTS = _env_int("CAMAI_ANPR_DEBUG_MAX_ATTEMPTS", 500)
ANPR_DEBUG_SAVE_SUCCESS = _env_bool("CAMAI_ANPR_DEBUG_SAVE_SUCCESS", False)
ANPR_EVENT_COOLDOWN = _env_float("CAMAI_ANPR_EVENT_COOLDOWN", 30.0)
ANPR_INTERVAL_S = _env_float("CAMAI_ANPR_INTERVAL_S", 1.0)

# Adaptive Tile Engine Settings
TILING_ENABLED = _env_bool("CAMAI_TILING_ENABLED", True)
TILING_MAX_GRID = _env_int("CAMAI_TILING_MAX_GRID", 3)
TILING_OVERLAP = _env_float("CAMAI_TILING_OVERLAP", 0.20)
TILING_MAX_TILES = _env_int("CAMAI_TILING_MAX_TILES", 3)
TILING_LATENCY_BUDGET_MS = _env_float("CAMAI_TILING_LATENCY_BUDGET_MS", 16.0)

# Performance & Target FPS
TARGET_FPS = _env_float("CAMAI_TARGET_FPS", 60.0)
# Per-frame console formatting and writes can become the slowest stage on a
# desktop engine. Keep detailed object dumps opt-in and rate-limit them when an
# operator is investigating a particular camera.
PIPELINE_DIAGNOSTICS = _env_bool("CAMAI_PIPELINE_DIAGNOSTICS", False)
PIPELINE_DIAGNOSTIC_INTERVAL_S = _env_float("CAMAI_PIPELINE_DIAGNOSTIC_INTERVAL_S", 5.0)
TILING_WORKERS = _env_int("CAMAI_TILING_WORKERS", 2)
TILING_MOTION_THRESHOLD = _env_float("CAMAI_TILING_MOTION_THRESHOLD", 0.0015)
TILING_CACHE_TTL_S = _env_float("CAMAI_TILING_CACHE_TTL_S", 1.5)
TILING_SMALL_OBJECT_FRAC = _env_float("CAMAI_TILING_SMALL_OBJECT_FRAC", 0.010)
TILING_FUSION_IOU = _env_float("CAMAI_TILING_FUSION_IOU", 0.55)
TILING_FUSION_CONTAINMENT = _env_float("CAMAI_TILING_FUSION_CONTAINMENT", 0.75)
TILING_ROI_BOOST = _env_bool("CAMAI_TILING_ROI_BOOST", True)
TILING_ROI_BOOST_MAX = _env_int("CAMAI_TILING_ROI_BOOST_MAX", 2)
TILING_SECOND_PASS_CONF = _env_float("CAMAI_TILING_SECOND_PASS_CONF", 0.45)
TILING_DISCOVERY_INTERVAL_S = _env_float("CAMAI_TILING_DISCOVERY_INTERVAL_S", 5.0)

# Governor Mode
TILING_GOVERNOR_MODE = os.getenv("CAMAI_TILING_GOVERNOR_MODE", "auto").strip().lower()
TILING_MULTI_RESOLUTION = _env_bool("CAMAI_TILING_MULTI_RESOLUTION", True)

# Web Server & Token Settings
HOST = os.getenv("CAMAI_HOST", "127.0.0.1")
PORT = int(os.getenv("CAMAI_PORT", "8000"))
API_TOKEN = os.getenv("CAMAI_API_TOKEN", "").strip()

# CORS Allowed Origins
_cors = os.getenv("CAMAI_CORS_ORIGINS", "").strip()
CORS_ORIGINS = (
    [o.strip() for o in _cors.split(",") if o.strip()]
    if _cors
    else [
        "null",
        "file://",
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3005",
        "http://127.0.0.1:3005",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost",
        "https://localhost",
        "capacitor://localhost",
    ]
)
