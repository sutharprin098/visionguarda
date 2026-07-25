import time
import numpy as np
import cv2
import torch
import onnxruntime as ort
import openvino as ov
from app.ai.backend import EngineBackend
from app.ai.pipeline import letterbox
from app.analytics import CameraAnalytics

print("=== PIPELINE BENCHMARK AUDIT ===")

# 1. Hardware Check
print("\n--- 1. HARDWARE & DRIVER DIAGNOSTICS ---")
print("CUDA Available (Torch):", torch.cuda.is_available())
if torch.cuda.is_available():
    print("GPU Name:", torch.cuda.get_device_name(0))
    print("CUDA Version:", torch.version.cuda)
    print("cuDNN Version:", torch.backends.cudnn.version())
    print("Allocated VRAM (MB):", torch.cuda.memory_allocated(0) / 1024 / 1024)

print("ONNX Runtime Providers:", ort.get_available_providers())
ov_core = ov.Core()
print("OpenVINO Devices:", ov_core.available_devices)

# 2. Benchmark Backend Engine Init & Inference
print("\n--- 2. INFERENCE BENCHMARK ---")
t0 = time.time()
engine = EngineBackend("yolox_s")
init_time = (time.time() - t0) * 1000
print(f"Engine Init Time: {init_time:.2f} ms")
print(f"Selected Backend: {engine.backend_type} on {engine.backend_device}")

# Dummy frame 1920x1080 BGR
raw_frame = np.random.randint(0, 255, (1080, 1920, 3), dtype=np.uint8)

# 3. Stage 1: Preprocessing & Letterbox
t0 = time.perf_counter()
for _ in range(20):
    img_padded, r, (dw, dh) = letterbox(raw_frame, (640, 640))
    blob = img_padded.transpose((2, 0, 1))[::-1]  # BGR to RGB, HWC to CHW
    blob = np.ascontiguousarray(blob, dtype=np.float32)
    blob /= 255.0
    blob = np.expand_dims(blob, axis=0)
t_pre = ((time.perf_counter() - t0) / 20) * 1000
print(f"Preprocessing Latency (640x640): {t_pre:.2f} ms")

# 4. Stage 2: Hardware Inference Pass
# Warmup
_ = engine.run_inference(blob)
t0 = time.perf_counter()
N_ITER = 30
for _ in range(N_ITER):
    out = engine.run_inference(blob)
t_inf = ((time.perf_counter() - t0) / N_ITER) * 1000
print(f"Hardware Inference Latency: {t_inf:.2f} ms")

# 5. Stage 3: Postprocessing & Grid Decode
t0 = time.perf_counter()
for _ in range(N_ITER):
    dets = engine.postprocess(out, (1080, 1920), (640, 640), conf_thresh=0.25, nms_thresh=0.45)
t_post = ((time.perf_counter() - t0) / N_ITER) * 1000
print(f"Postprocessing & Grid Decode Latency: {t_post:.2f} ms")

# 6. Stage 4: Rendering & MJPEG Encoding
annotated = raw_frame.copy()
t0 = time.perf_counter()
for _ in range(N_ITER):
    # Draw sample box & text
    cv2.rectangle(annotated, (100, 100), (300, 300), (0, 255, 0), 2)
    cv2.putText(annotated, "car 94% 45 km/h", (100, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
t_render = ((time.perf_counter() - t0) / N_ITER) * 1000
print(f"Rendering (OpenCV Overlays) Latency: {t_render:.2f} ms")

t0 = time.perf_counter()
for _ in range(N_ITER):
    _, jpeg = cv2.imencode('.jpg', annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
t_mjpeg = ((time.perf_counter() - t0) / N_ITER) * 1000
print(f"MJPEG Encoding Latency (1080p @ Q75): {t_mjpeg:.2f} ms")

print("\n--- SUMMARY OF STAGE TIMINGS ---")
print(f"Preprocessing: {t_pre:.2f} ms")
print(f"Inference:     {t_inf:.2f} ms")
print(f"Postprocessing:{t_post:.2f} ms")
print(f"Rendering:     {t_render:.2f} ms")
print(f"MJPEG Encode:  {t_mjpeg:.2f} ms")
print(f"Total per-frame CPU+GPU pipeline cost: {t_pre + t_inf + t_post + t_render + t_mjpeg:.2f} ms")
