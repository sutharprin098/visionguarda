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
HISTORY_DIR = BASE_DIR / "history"
RECORDINGS_DIR = HISTORY_DIR / "recordings"
DB_PATH = HISTORY_DIR / "db.sqlite"
UPLOADS_DIR = BASE_DIR / "uploads"

# Ensure directories exist
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# YOLO Settings
YOLO_MODEL = "yolo11n-seg.pt"
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

# Web Server Settings.
# The engine exposes unauthenticated camera streams and control endpoints —
# it is designed to sit on loopback behind the desktop app / local viewer.
# Only bind a routable interface (CAMAI_HOST=0.0.0.0) on a trusted network
# or behind an authenticating reverse proxy.
HOST = os.getenv("CAMAI_HOST", "127.0.0.1")
PORT = int(os.getenv("CAMAI_PORT", "8000"))
