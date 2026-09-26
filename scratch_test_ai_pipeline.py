import os
import sys
import time
import json
import numpy as np
import cv2

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".."))
# camAI root
CAMAI_ROOT = r"D:\camAI"
SERVER_DIR = os.path.join(CAMAI_ROOT, "server")
sys.path.insert(0, SERVER_DIR)
sys.path.insert(0, CAMAI_ROOT)

print("=== CAMAI DETECTION PIPELINE DIAGNOSTIC ===")
print("Python:", sys.version)

# 1. Test image
snapshot_path = os.path.join(CAMAI_ROOT, "ACAP", "axis_snapshot.jpg")
if not os.path.exists(snapshot_path):
    print("Snapshot not found:", snapshot_path)
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
else:
    img = cv2.imread(snapshot_path)
    print(f"Loaded snapshot: {img.shape}")

# 2. Test YOLOX Backend
print("\n--- 1. Testing Primary YOLOX Backend ---")
from app.ai.backend import EngineBackend
backend = EngineBackend("yolox_tiny")
print(f"Backend loaded: model_name={getattr(backend, 'model_name', 'yolox_tiny')}, device={getattr(backend, 'backend_device', 'unknown')}, is_visdrone={getattr(backend, 'is_visdrone', False)}")
t0 = time.perf_counter()
yolo_dets = backend.infer(img)
t_yolo = (time.perf_counter() - t0) * 1000
print(f"YOLOX inference took: {t_yolo:.2f}ms | Raw detections count: {len(yolo_dets) if yolo_dets else 0}")
if yolo_dets:
    for idx, d in enumerate(yolo_dets[:10]):
        print(f"  Det #{idx}: class={d.get('class')}, conf={d.get('confidence')}, bbox={d.get('bbox')}")

# 3. Test Zero-DCE Enhancer
print("\n--- 2. Testing Zero-DCE Night Vision Enhancer ---")
from app.ai.enhancer import zero_dce
mean_lum = zero_dce.calculate_luminance(img)
print(f"Mean luminance of snapshot: {mean_lum:.2f} (threshold={zero_dce.threshold})")
enhanced_auto, stats_auto = zero_dce.enhance(img, force_enable=False)
print(f"Auto enhance stats: {stats_auto}")
enhanced_forced, stats_forced = zero_dce.enhance(img, force_enable=True)
print(f"Forced enhance stats: {stats_forced}, new luminance={zero_dce.calculate_luminance(enhanced_forced):.2f}")
# Run YOLOX on enhanced frame
yolo_enhanced = backend.infer(enhanced_forced)
print(f"YOLOX on Zero-DCE enhanced frame: {len(yolo_enhanced) if yolo_enhanced else 0} detections")

# 4. Test Micro-Motion Detector
print("\n--- 3. Testing Screen Micro-Motion Detector ---")
from app.ai.screen_motion_detector import ScreenMicroMotionDetector
mm = ScreenMicroMotionDetector()
# Process static frame twice
_, mot1 = mm.process_frame(img, return_annotated=False)
_, mot2 = mm.process_frame(img, return_annotated=False)
print(f"Micro-motion on static frame (pass 1, 2): len={len(mot1)}, len={len(mot2)}")
# Simulate frame with slight movement in a crop
img_moved = img.copy()
cv2.rectangle(img_moved, (300, 300), (350, 350), (255, 255, 255), -1)
_, mot3 = mm.process_frame(img_moved, return_annotated=False)
print(f"Micro-motion on moved frame (pass 3): len={len(mot3)}")
if mot3:
    for idx, m in enumerate(mot3):
        print(f"  Motion #{idx}: tag={m.get('tag')}, conf={m.get('confidence')}, box={m.get('box')}")

# 5. Test Helmet Detector
print("\n--- 4. Testing RT-DETR Helmet Detector ---")
try:
    from app.ai import helmet
    h_det = helmet.get_detector()
    print(f"Helmet detector loaded: {h_det}")
    if h_det:
        h_res = h_det.detect(img)
        print(f"Helmet detect raw results: {len(h_res) if h_res else 0}")
except Exception as e:
    print(f"Helmet detector error: {e}")

# 6. Test Face Detector
print("\n--- 5. Testing Face Detector (YuNet/SFace) ---")
try:
    from app.ai import face
    f_det = face.get_detector()
    print(f"Face detector loaded: {f_det}")
    if f_det:
        f_res = f_det.detect(img)
        print(f"Face detect raw results: {len(f_res) if f_res else 0}")
except Exception as e:
    print(f"Face detector error: {e}")

# 7. Test ANPR Plate Detector
print("\n--- 6. Testing ANPR Plate Detector ---")
try:
    from app.ai import plate
    p_det = plate.get_detector()
    print(f"Plate detector loaded: {p_det}")
    if p_det:
        p_res = p_det.detect(img)
        print(f"Plate detect raw results: {len(p_res) if p_res else 0}")
except Exception as e:
    print(f"Plate detector error: {e}")

# 8. Test Custom Detector
print("\n--- 7. Testing Custom Detector ---")
try:
    from app.ai import custom_detector as cd
    print(f"Custom detector active models: {cd.has_active_custom_models()}")
except Exception as e:
    print(f"Custom detector error: {e}")

# 9. Test ByteTracker coordinate handling
print("\n--- 8. Testing ByteTracker & resolve_emitted_detections ---")
from app.ai.pipeline import ByteTracker, resolve_emitted_detections
tracker = ByteTracker(max_lost_seconds=0.8, reid_ttl=30.0, n_init=1)
h, w = img.shape[:2]
test_candidate_dets = []
for d in (yolo_dets or []):
    test_candidate_dets.append(dict(d))

print(f"Feeding {len(test_candidate_dets)} candidate detections to ByteTracker...")
tracks_raw = tracker.update(test_candidate_dets, frame=img, frame_shape=(h, w), conf_thresh=0.20)
print(f"ByteTracker updated: len(tracks_raw)={len(tracks_raw)}")
emitted_dets, _ = resolve_emitted_detections(tracker, tracks_raw, test_candidate_dets, [])
print(f"resolve_emitted_detections: len(emitted_dets)={len(emitted_dets)}")
if emitted_dets:
    for idx, ed in enumerate(emitted_dets[:5]):
        print(f"  Emitted #{idx}: class={ed.get('class')}, bbox={ed.get('bbox')}, track_id={ed.get('track_id')}")

# 10. Test Analytics Filters
print("\n--- 9. Testing Analytics Profile & Feature Filters ---")
from app.analytics import filter_by_features, filter_by_profile, PROFILE_CLASSES, FEATURE_CLASSES
print(f"PROFILE_CLASSES keys: {list(PROFILE_CLASSES.keys())}")
for prof in ["traffic", "security", "factory", "retail", "smart_city", "micro_motion", "custom"]:
    filtered = filter_by_profile(emitted_dets, prof)
    print(f"  Profile '{prof}': {len(filtered)} / {len(emitted_dets)} passed")

print("\n=== DIAGNOSTIC COMPLETE ===")
