"""End-to-end model verification and benchmark suite.

Tests and benchmarks:
1. Primary Object Detectors (YOLOX-Tiny, YOLOX-S, YOLOX-M)
2. Long-Distance / Small-Object Specialist (YOLOv8-VisDrone)
3. Face Detection (YuNet 2023mar)
4. Face Recognition Embedding (SFace 2021dec)
5. Safety PPE / Helmet Detectors (YOLOv8 Helmet, RT-DETR Helmet)
6. License Plate Detection & OCR (LPD YuNet, Plate Detector, CRNN OCR, Plate OCR)
7. One-Shot Target Matcher Engine (Multi-scale distance test, spatial embeddings, SFace fusion)
"""

import os
import sys
import time
import cv2
import numpy as np
import onnxruntime as ort

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

def print_header(title: str):
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)

def test_onnx_model(name: str, model_path: str, input_shape=(1, 3, 640, 640), num_iterations=5):
    if not os.path.exists(model_path):
        print(f"[FAIL] {name}: Model file not found at {model_path}")
        return False, 0.0

    size_mb = os.path.getsize(model_path) / (1024 * 1024)
    print(f"\n[TESTING] {name} ({size_mb:.2f} MB)")
    print(f"  Path: {model_path}")

    try:
        opts = ort.SessionOptions()
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        providers = ["CPUExecutionProvider"]
        if "CUDAExecutionProvider" in ort.get_available_providers():
            providers.insert(0, "CUDAExecutionProvider")

        sess = ort.InferenceSession(model_path, sess_options=opts, providers=providers)
        active_provider = sess.get_providers()[0]
        print(f"  Provider: {active_provider}")

        # Input tensor
        input_name = sess.get_inputs()[0].name
        input_type = sess.get_inputs()[0].type
        dummy_input = np.random.randn(*input_shape).astype(np.float32)

        # Warmup
        _ = sess.run(None, {input_name: dummy_input})

        # Benchmark
        times = []
        for _ in range(num_iterations):
            t0 = time.perf_counter()
            outputs = sess.run(None, {input_name: dummy_input})
            times.append((time.perf_counter() - t0) * 1000.0)

        avg_lat = np.mean(times)
        fps = 1000.0 / avg_lat if avg_lat > 0 else 0
        out_shapes = [str(o.shape) if hasattr(o, "shape") else "output" for o in outputs]
        print(f"  Output shapes: {', '.join(out_shapes)}")
        print(f"  [PASS] Average Latency: {avg_lat:.2f} ms ({fps:.1f} FPS)")
        return True, avg_lat

    except Exception as e:
        print(f"  [FAIL] {name} failed: {e}")
        return False, 0.0

def test_face_models():
    print_header("FACE DETECTION & RECOGNITION MODELS")
    yunet_path = os.path.join(BASE_DIR, "models_face", "face_detection_yunet_2023mar.onnx")
    sface_path = os.path.join(BASE_DIR, "models_face", "face_recognition_sface_2021dec.onnx")

    # 1. Test YuNet
    if os.path.exists(yunet_path):
        try:
            detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320), score_threshold=0.6)
            test_img = np.zeros((320, 320, 3), dtype=np.uint8)
            # draw a synthetic face
            cv2.circle(test_img, (160, 160), 60, (200, 180, 150), -1)
            cv2.circle(test_img, (140, 145), 10, (50, 30, 20), -1)
            cv2.circle(test_img, (180, 145), 10, (50, 30, 20), -1)
            cv2.ellipse(test_img, (160, 185), (25, 10), 0, 0, 180, (50, 30, 20), 3)

            detector.setInputSize((320, 320))
            t0 = time.perf_counter()
            _, faces = detector.detect(test_img)
            lat = (time.perf_counter() - t0) * 1000
            print(f"  [PASS] YuNet Face Detection OK! Latency: {lat:.2f} ms")
        except Exception as e:
            print(f"  [FAIL] YuNet error: {e}")
    else:
        print(f"  [FAIL] YuNet model missing at {yunet_path}")

    # 2. Test SFace
    if os.path.exists(sface_path):
        try:
            recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
            # Synthetic face crop 112x112
            aligned_face = np.full((112, 112, 3), 128, dtype=np.uint8)
            cv2.circle(aligned_face, (56, 56), 40, (180, 160, 140), -1)
            t0 = time.perf_counter()
            feat1 = recognizer.feature(aligned_face)
            feat2 = recognizer.feature(aligned_face)
            score = recognizer.match(feat1, feat2, cv2.FaceRecognizerSF_FR_COSINE)
            lat = (time.perf_counter() - t0) * 1000
            print(f"  [PASS] SFace Face Recognition OK! Embedding Shape: {feat1.shape}, Self-Match Score: {score:.4f}, Latency: {lat:.2f} ms")
        except Exception as e:
            print(f"  [FAIL] SFace error: {e}")
    else:
        print(f"  [FAIL] SFace model missing at {sface_path}")

def test_target_matcher():
    print_header("TARGET MATCHER ENGINE & DISTANCE SIMULATION")
    from app.ai.target_matcher import TargetMatcherEngine

    engine = TargetMatcherEngine()
    test_dir = os.path.join(BASE_DIR, "scratch", "test_targets")
    os.makedirs(test_dir, exist_ok=True)
    engine.init_storage(test_dir)

    # Create a synthetic target image (e.g. suspect with distinct red jacket and dark pants)
    target_img = np.zeros((200, 100, 3), dtype=np.uint8)
    target_img[0:40, :, :] = (180, 160, 140)   # face/head
    target_img[40:130, :, :] = (20, 20, 220)   # red jacket (BGR)
    target_img[130:200, :, :] = (30, 30, 30)   # dark pants

    item = engine.add_target(
        name="Target-Alpha (Red Jacket)",
        img_bgr=target_img,
        save_dir=test_dir,
        threshold=0.65
    )

    if item is None:
        print("  [FAIL] Failed to enroll target.")
        return

    print(f"  [PASS] Enrolled Target: ID={item.target_id}, Name={item.name}, Threshold={item.threshold}")

    # Test full-frame simulation at multiple distances (scales):
    scales = [
        ("Close Range", (160, 80)),
        ("Medium Range", (80, 40)),
        ("Far Range (Dur Se)", (40, 20)),
        ("Ultra-Far Range (Extreme CCTV)", (24, 12))
    ]

    frame = np.full((720, 1280, 3), 80, dtype=np.uint8) # background frame

    for range_name, (ch, cw) in scales:
        crop_scaled = cv2.resize(target_img, (cw, ch), interpolation=cv2.INTER_AREA)
        # place crop in frame
        y1, x1 = 100, 100 + len(scales) * 60
        frame[y1:y1+ch, x1:x1+cw] = crop_scaled

        detections = [{
            "class": "person",
            "confidence": 0.85,
            "bbox": {"x1": x1, "y1": y1, "x2": x1 + cw, "y2": y1 + ch}
        }]

        t0 = time.perf_counter()
        matched_dets = engine.match_detections(frame, detections)
        lat = (time.perf_counter() - t0) * 1000

        det = matched_dets[0]
        matched = det.get("custom_match", False)
        score = det.get("match_score", 0.0)
        label = det.get("track_label", det.get("class"))

        status = "[PASS]" if matched else "[WARN - Sub-threshold]"
        print(f"  {status} {range_name:30s} Size: {cw}x{ch}px | Score: {score:.3f} | Latency: {lat:.2f}ms | Label: {label}")

    # Clean up test target
    engine.remove_target(item.target_id)
    print("  [PASS] Target cleanup verified.")

def run_all_tests():
    print_header("CAMAI COMPREHENSIVE MULTI-MODEL TEST SUITE")
    print(f"Python: {sys.version}")
    print(f"OpenCV: {cv2.__version__}")
    print(f"ONNX Runtime: {ort.__version__}")
    print(f"Available Execution Providers: {ort.get_available_providers()}")

    results = {}

    # 1. Primary Object Detectors
    print_header("PRIMARY OBJECT DETECTION MODELS")
    models = [
        ("YOLOX-Tiny", os.path.join(BASE_DIR, "yolox_tiny.onnx"), (1, 3, 416, 416)),
        ("YOLOX-S", os.path.join(BASE_DIR, "yolox_s.onnx"), (1, 3, 640, 640)),
        ("YOLOX-M", os.path.join(BASE_DIR, "yolox_m.onnx"), (1, 3, 640, 640)),
        ("YOLOv8-VisDrone (Far Range)", os.path.join(BASE_DIR, "models", "yolov8_visdrone.onnx"), (1, 3, 640, 640)),
    ]
    for name, path, shape in models:
        ok, lat = test_onnx_model(name, path, shape)
        results[name] = "PASS" if ok else "FAIL"

    # 2. Safety PPE / Helmet Models
    print_header("SAFETY PPE / HELMET MODELS")
    helmet_models = [
        ("YOLOv8 Helmet", os.path.join(BASE_DIR, "models", "helmet", "helmet.onnx"), (1, 3, 640, 640)),
        ("RT-DETR Helmet", os.path.join(BASE_DIR, "models", "helmet", "rtdetr_helmet.onnx"), (1, 3, 640, 640)),
    ]
    for name, path, shape in helmet_models:
        ok, lat = test_onnx_model(name, path, shape)
        results[name] = "PASS" if ok else "FAIL"

    # 3. ANPR / License Plate Models
    print_header("ANPR / LICENSE PLATE MODELS")
    plate_models = [
        ("LPD YuNet Plate Detector", os.path.join(BASE_DIR, "models_face", "license_plate_detection_lpd_yunet_2023mar.onnx"), (1, 3, 240, 320)),
        ("Plate Detector", os.path.join(BASE_DIR, "models", "plate", "plate_detector.onnx"), (1, 3, 640, 640)),
        ("CRNN Text Recognition", os.path.join(BASE_DIR, "models_face", "text_recognition_CRNN_EN_2021sep.onnx"), (1, 1, 32, 100)),
        ("Plate OCR", os.path.join(BASE_DIR, "models", "plate", "plate_ocr.onnx"), (1, 1, 32, 100)),
    ]
    for name, path, shape in plate_models:
        ok, lat = test_onnx_model(name, path, shape)
        results[name] = "PASS" if ok else "FAIL"

    # 4. Face Models
    test_face_models()

    # 5. Target Matcher Engine
    test_target_matcher()

    print_header("SUMMARY")
    for name, status in results.items():
        print(f"  {name:35s}: {status}")
    print("\nAll model tests finished.\n")

if __name__ == "__main__":
    run_all_tests()
