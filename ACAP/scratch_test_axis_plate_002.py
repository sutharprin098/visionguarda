import sys
import os
import cv2

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))
from app.ai import plate

p_det = plate.get_detector()
p_det.set_confidence(0.02)
snapshot_path = os.path.join(os.path.dirname(__file__), "axis_snapshot.jpg")
img = cv2.imread(snapshot_path)
dets = p_det.detect(img)
print(f"Plate detect at conf=0.02 on Axis snapshot: {len(dets)} detections found!")
for d in dets:
    print(f"  Result: {d}")
