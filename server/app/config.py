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

# Web Server Settings.
# The engine exposes unauthenticated camera streams and control endpoints —
# it is designed to sit on loopback behind the desktop app / local viewer.
# Only bind a routable interface (CAMAI_HOST=0.0.0.0) on a trusted network
# or behind an authenticating reverse proxy.
HOST = os.getenv("CAMAI_HOST", "127.0.0.1")
PORT = int(os.getenv("CAMAI_PORT", "8000"))
