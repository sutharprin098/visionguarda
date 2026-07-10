import os
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_DIR = BASE_DIR / "history"
RECORDINGS_DIR = HISTORY_DIR / "recordings"
DB_PATH = HISTORY_DIR / "db.sqlite"

# Ensure directories exist
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

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

# Web Server Settings
HOST = "0.0.0.0"
PORT = 8000
