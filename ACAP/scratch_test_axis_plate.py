import sys
import os
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from app.ai import plate
from app.ai import plate_ocr

print("=" * 60)
print("Testing ANPR directly on Real Axis Camera Snapshot")
print("=" * 60)

snapshot_path = os.path.join(os.path.dirname(__file__), "axis_snapshot.jpg")
if not os.path.exists(snapshot_path):
    print(f"Snapshot not found at {snapshot_path}")
    sys.exit(1)

img = cv2.imread(snapshot_path)
h, w = img.shape[:2]
print(f"Loaded snapshot: {w}x{h}")

# Test PlateDetector
p_det = plate.get_detector(conf=0.05)
print(f"Plate detector active: {p_det is not None}")

# 1. Direct full frame detect
dets = p_det.detect(img)
print(f"Full-frame detect result count: {len(dets)}")
for d in dets:
    print(f"  - Plate detection: {d}")

# 2. Also test on region around the plate (left wall)
# The plate "AX96 AEC" is roughly at x: 200..450, y: 550..750 in a 1920x1080 frame
crop_x1, crop_y1, crop_x2, crop_y2 = int(w * 0.15), int(h * 0.50), int(w * 0.35), int(h * 0.75)
crop = img[crop_y1:crop_y2, crop_x1:crop_x2]
cv2.imwrite("test_plate_crop.jpg", crop)

# Test OCR on recognizer
ocr_rec = plate_ocr.get_recognizer()
if ocr_rec:
    res = ocr_rec.read_detailed(crop)
    print(f"Direct OCR read on plate region: text='{res.text}', raw='{res.raw_text}', conf={res.confidence}, valid={res.valid}")
