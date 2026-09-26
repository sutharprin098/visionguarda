import sys
import os
import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "server"))

from app.ai import plate

p_det = plate.get_detector(conf=0.01) # Lower threshold to 0.01 to see raw candidates
snapshot_path = os.path.join(os.path.dirname(__file__), "axis_snapshot.jpg")
img = cv2.imread(snapshot_path)
h, w = img.shape[:2]

# Run raw decode
work, up = p_det._upscale(img)
canvas, scale = plate._letterbox(work, p_det.input_size[0])
rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
blob = np.ascontiguousarray(rgb.transpose(2, 0, 1)[None])
res = p_det.session.run([p_det._out_single], {p_det._in_name: blob})
raw = p_det._decode_generic(res[0], scale, work.shape[1], work.shape[0])
print(f"Raw candidate detections at conf >= 0.01: {len(raw)}")
for r in raw[:10]:
    b = r["_box"]
    why = plate.gate_reason(b[0], b[1], b[2], b[3], work.shape[1], work.shape[0])
    print(f"  Box: ({b[0]:.1f}, {b[1]:.1f}, {b[2]:.1f}, {b[3]:.1f}), Score: {r['_score']:.3f}, Gating Reason: {why}")
