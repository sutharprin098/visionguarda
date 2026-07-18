import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load server/.env into the process environment (no python-dotenv dependency;
# real environment variables win over file values).
_env_file = BASE_DIR / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _key, _, _value = _line.partition("=")
        os.environ.setdefault(_key.strip(), _value.strip().strip('"').strip("'"))
# Support custom writable directory on the user's PC (e.g. AppData on Windows)
history_env = os.getenv("CAMAI_HISTORY_DIR")
if history_env:
    HISTORY_DIR = Path(history_env)
else:
    appdata = os.getenv("APPDATA")
    if appdata:
        HISTORY_DIR = Path(appdata) / "CamAI" / "history"
    else:
        # Fallback to home directory or base dir
        home = os.getenv("USERPROFILE") or os.getenv("HOME")
        if home:
            HISTORY_DIR = Path(home) / ".camai" / "history"
        else:
            HISTORY_DIR = BASE_DIR / "history"

RECORDINGS_DIR = HISTORY_DIR / "recordings"
DB_PATH = HISTORY_DIR / "db.sqlite"
UPLOADS_DIR = HISTORY_DIR / "uploads"
MODELS_DIR = HISTORY_DIR.parent / "models"

# Ensure directories exist
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# YOLO Settings
YOLO_MODEL = "yolox_tiny"
CONFIDENCE_THRESHOLD = 0.3
IOU_THRESHOLD = 0.5
INFERENCE_SIZE = 320  # Fast inference size

# Recording settings
RECORDING_FPS = 10
RECORDING_WIDTH = 640
RECORDING_HEIGHT = 480
SEGMENT_DURATION_SECS = 600  # 10 minute segments for continuous recording
PRE_EVENT_BUFFER_SECS = 5    # seconds to keep in pre-event circular buffer
POST_EVENT_RECORD_SECS = 5   # seconds to keep recording after event ends

# --- Helmet detection (RT-DETR, Apache-2.0) --------------------------------
# All knobs are env-overridable with safe defaults; no absolute path is baked
# in. The model + its classes.txt live under MODELS_DIR/helmet by default
# (e.g. %APPDATA%/CamAI/models/helmet/rtdetr_helmet.onnx), which is writable and
# per-user. HELMET_ENABLED is a global kill-switch independent of the per-camera
# zone-profile toggle — both must be on (and the model present) for helmet
# inference to run.
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

HELMET_ENABLED = _env_bool("CAMAI_HELMET_ENABLED", True)
HELMET_MODEL_DIR = Path(os.getenv("CAMAI_HELMET_MODEL_DIR", str(MODELS_DIR / "helmet")))
# Filename resolved under HELMET_MODEL_DIR, or an absolute path if given.
HELMET_MODEL = os.getenv("CAMAI_HELMET_MODEL", "rtdetr_helmet.onnx")
HELMET_CLASSES_FILE = os.getenv("CAMAI_HELMET_CLASSES", "classes.txt")
HELMET_THRESHOLD = _env_float("CAMAI_HELMET_THRESHOLD", 0.35)
HELMET_NMS = _env_float("CAMAI_HELMET_NMS", 0.45)
HELMET_INPUT_SIZE = _env_int("CAMAI_HELMET_INPUT_SIZE", 640)
HELMET_COOLDOWN = _env_float("CAMAI_HELMET_COOLDOWN", 15.0)

# --- ANPR / number-plate detection (Apache-2.0) ----------------------------
# Vehicle-crop + gating first: the plate detector runs ONLY on car/truck/bus/
# motorcycle crops (never the full frame), and candidates are gated by aspect
# ratio and size before they count as plates. This is the fix for the failure
# that kept ANPR "coming soon" — on the full frame the detector read painted
# vehicle text (e.g. "emisiones" on a bus) as a plate. Model path is pluggable
# (LPD-YuNet is Chinese-trained; an India-tuned detector can drop in here).
ANPR_ENABLED = _env_bool("CAMAI_ANPR_ENABLED", True)
ANPR_MODEL_DIR = Path(os.getenv("CAMAI_ANPR_MODEL_DIR", str(MODELS_DIR / "plate")))
ANPR_MODEL = os.getenv("CAMAI_ANPR_MODEL", "plate_detector.onnx")
ANPR_CLASSES_FILE = os.getenv("CAMAI_ANPR_CLASSES", "classes.txt")
ANPR_THRESHOLD = _env_float("CAMAI_ANPR_THRESHOLD", 0.5)
ANPR_NMS = _env_float("CAMAI_ANPR_NMS", 0.3)
# Aspect band accepts BOTH single-row (~3-6:1) and two-row plates (~1.3-2.5:1) —
# Indian two-wheeler plates are commonly two-row, so a wide-only band would miss
# exactly the DM pilot's target vehicles.
ANPR_ASPECT_MIN = _env_float("CAMAI_ANPR_ASPECT_MIN", 1.2)
ANPR_ASPECT_MAX = _env_float("CAMAI_ANPR_ASPECT_MAX", 6.5)
# A plate narrower than this (px) carries too few characters to OCR reliably.
ANPR_MIN_PLATE_W = _env_int("CAMAI_ANPR_MIN_PLATE_W", 40)
# A real plate is a small fraction of the vehicle it's on; a "plate" covering
# most of the vehicle crop is painted text or a mis-detection.
ANPR_MAX_AREA_FRAC = _env_float("CAMAI_ANPR_MAX_AREA_FRAC", 0.35)

# OCR stage — reads characters off a gated plate crop (CRNN, OpenCV Zoo,
# Apache-2.0). Optional and independent: if the OCR model is absent, plates are
# still localised (plate_text stays None) and CamAI keeps running. Charset is
# loaded from a file, never hardcoded. Model + charset live in ANPR_MODEL_DIR.
ANPR_OCR_ENABLED = _env_bool("CAMAI_ANPR_OCR_ENABLED", True)
ANPR_OCR_MODEL = os.getenv("CAMAI_ANPR_OCR_MODEL", "plate_ocr.onnx")
ANPR_OCR_CHARSET = os.getenv("CAMAI_ANPR_OCR_CHARSET", "charset.txt")
# Reject OCR output shorter than this — a plate has several characters, and a
# 1-2 char read is noise, not a plate number.
ANPR_OCR_MIN_LEN = _env_int("CAMAI_ANPR_OCR_MIN_LEN", 4)
# Log a read plate at most once per this many seconds per vehicle track — the
# same dedup idea as helmet violations, keyed to the vehicle it sits on.
ANPR_EVENT_COOLDOWN = _env_float("CAMAI_ANPR_EVENT_COOLDOWN", 30.0)

# Web Server Settings.
# The engine exposes unauthenticated camera streams and control endpoints —
# it is designed to sit on loopback behind the desktop app / local viewer.
# Only bind a routable interface (CAMAI_HOST=0.0.0.0) on a trusted network
# or behind an authenticating reverse proxy.
HOST = os.getenv("CAMAI_HOST", "127.0.0.1")
PORT = int(os.getenv("CAMAI_PORT", "8000"))
