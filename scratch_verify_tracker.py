import sys
import os
import numpy as np

CAMAI_ROOT = r"D:\camAI"
SERVER_DIR = os.path.join(CAMAI_ROOT, "server")
sys.path.insert(0, SERVER_DIR)
sys.path.insert(0, CAMAI_ROOT)

from app.ai.pipeline import ByteTracker, resolve_emitted_detections

tracker = ByteTracker(n_init=1)
raw_dets = [
    {"class": "car", "confidence": 0.85, "bbox": {"x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4}},
    {"class": "person", "confidence": 0.90, "bbox": {"x1": 0.5, "y1": 0.5, "x2": 0.6, "y2": 0.8}},
    {"class": "micro_motion", "confidence": 0.80, "bbox": {"x1": 0.7, "y1": 0.7, "x2": 0.75, "y2": 0.75}},
]

print("--- Testing ByteTracker with Normalized Boxes ---")
# Check IoU calculation on normalized boxes
box1 = [0.1, 0.2, 0.3, 0.4]
box2 = [0.1, 0.2, 0.3, 0.4]
iou = tracker._compute_iou(box1, box2)
print(f"IoU between identical normalized box1 and box2: {iou} (SHOULD BE 1.0!)")

# Run tracker.update
dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
tracks_raw = tracker.update(raw_dets, frame=dummy_frame, frame_shape=(480, 640))
print(f"tracks_raw count: {len(tracks_raw)}")
for t in tracks_raw:
    print(" ", t)

emitted, _ = resolve_emitted_detections(tracker, tracks_raw, raw_dets, [])
print(f"emitted count: {len(emitted)}")
for e in emitted:
    print(" ", e)
