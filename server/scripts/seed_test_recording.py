"""
Seeds one guaranteed-valid, real-frame H.264 recording into the DB + disk
for the Playwright e2e suite (tests/e2e/recordings.spec.ts) to click and
verify actual browser playback against.

Not used by the application itself — this exists because the e2e suite's
own test camera (a "screenshare" source) never receives real frames (that
requires an active WebSocket push from a browser tab, which the e2e test
doesn't simulate), so it produces a zero-frame/near-empty recording that
isn't a meaningful playback test. This seeds a small but real multi-frame
H.264 clip directly, using the same _H264Writer the app itself uses, so
the test verifies the real encode+serve+play path deterministically.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

from datetime import datetime
from uuid import uuid4
import numpy as np

from app.recorder import _H264Writer
from app.config import RECORDINGS_DIR
from app.storage import init_db, start_recording_entry, end_recording_entry, get_camera, save_camera

CAMERA_ID = "e2e_seed_cam"
CAMERA_NAME = "E2E Seed Camera"

init_db()

if not get_camera(CAMERA_ID):
    save_camera(CAMERA_ID, CAMERA_NAME, "screenshare", "seed", is_active=0)

rec_id = f"cont_{uuid4().hex[:8]}"
timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
filename = f"cam_{CAMERA_ID}_{timestamp}_continuous.mp4"
file_path = str(RECORDINGS_DIR / filename)

writer = _H264Writer(file_path, 10, (640, 480))
assert writer.isOpened(), "seed writer failed to open"
for i in range(30):
    frame = np.full((480, 640, 3), (i * 5) % 255, dtype=np.uint8)
    writer.write(frame)
writer.release()

start_iso = datetime.utcnow().isoformat() + "Z"
start_recording_entry(rec_id, CAMERA_ID, start_iso, "continuous", f"/history/recordings/{filename}")
end_recording_entry(rec_id, datetime.utcnow().isoformat() + "Z")

print(f"Seeded {file_path} ({os.path.getsize(file_path)} bytes) as recording {rec_id}")
