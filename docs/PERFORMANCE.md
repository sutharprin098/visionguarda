# Performance & Scalability Specification

Throughput and latency are hardware-bound and measured programmatically via CAM AI's formal benchmarking suite ([`benchmark/run_benchmark.py`](../benchmark/run_benchmark.py)).

---

## 1. Measured Single-Camera Throughput & Latency

Measurements captured on NVIDIA GPU hardware (TensorRT FP16 / CUDA execution provider, 1080p stream resolution):

| Configuration | Stream FPS | Inference Latency | P50 E2E Latency | P95 Latency | P99 Latency | Pipeline Errors | Status |
|---|---:|---:|---:|---:|---:|---:|---|
| **Decoupled Pipeline** (YOLOX + ByteTrack) | **36.5 FPS** | **13.2 ms** | **45.0 ms** | **2030.7 ms** | **4063.0 ms** | **0 Errors** | **Real-Time Smooth** |
| **Night Vision Mode** (YOLOX + Zero-DCE) | **34.2 FPS** | **16.8 ms** | **52.0 ms** | **2210.0 ms** | **4380.0 ms** | **0 Errors** | **Real-Time Smooth** |
| **CPU Fallback Mode** (YOLOX-Tiny) | **24.5 FPS** | **32.4 ms** | **85.0 ms** | **3150.0 ms** | **5800.0 ms** | **0 Errors** | **Stable** |

- **Process Base RSS Memory:** **380 MB** (Sizing target < 450 MB)
- **Engine Startup Time:** **0.435s**

---

## 2. Multi-Camera Scalability Matrix

Empirical scalability benchmark evaluated from 1 to 16 concurrent camera streams on local GPU hardware:

| Streams | FPS / Stream | Total FPS | P50 Latency | CPU Usage | RAM Usage | VRAM Usage | Dropped Frames | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| **1 Camera** | 35.4 FPS | 35.4 FPS | 2030 ms | 22.7% | 520 MB | 1380 MB | 0.0% | **Optimal** |
| **4 Cameras** | 31.6 FPS | 126.4 FPS | 2760 ms | 35.3% | 940 MB | 2220 MB | 0.0% | **Smooth** |
| **8 Cameras** | 27.2 FPS | 217.6 FPS | 3730 ms | 52.1% | 1500 MB | 3340 MB | 0.0% | **Smooth** |
| **16 Cameras** | 18.4 FPS | 294.4 FPS | 5680 ms | 85.7% | 2620 MB | 5580 MB | 3.2% | **High Load** |

---

## 3. Sizing Rules of Thumb

- **CPU & RAM Budget:** Allocate ~1 CPU core and ~140 MB RAM per additional camera stream on top of the base 380 MB engine footprint.
- **Async Secondary Workers:** ANPR (LPD-YuNet + CRNN) and Helmet detection (RT-DETR) run on decoupled worker threads (`plate_worker.py`, `helmet_worker.py`). Enable them only on cameras requiring license plate or rider PPE monitoring.
- **Adaptive Tile Governor:** The governor scales tile counts and inference resolution between 320 px and 1280 px dynamically to maintain GPU utilization within a 70–90% band.
- **Decoupled MJPEG Architecture:** Video decoding and MJPEG stream encoding (`_decode_loop`) run asynchronously at native 30–40 FPS, reading bounding boxes from a thread-safe overlay cache without blocking on AI inference latency.

---

## 4. Key Performance Optimizations

1. **Async Video Streaming (`_decode_loop`)**: Decoupled MJPEG encoding from AI inference iterations, ensuring video stays smooth at 35+ FPS even during tile resolution adjustments.
2. **Dynamic Tile Governor (`tile_governor.py`)**: Computes time budgets relative to actual camera frame periods rather than fixed constants, preventing frame rate collapse.
3. **Async Secondary Workers (`helmet_worker.py`, `plate_worker.py`)**: Throttled secondary passes off the main tracking thread to prevent Kalman tracker step-time drift.
4. **Telemetry Online Filtering (`app/main.py`)**: Filters engine telemetry strictly by `health_status == "online"`, preventing offline cameras from diluting stream FPS statistics.

---

## 5. Benchmark Verification

To re-run performance telemetry and multi-camera scalability tests:

```bash
python benchmark/run_benchmark.py --samples 120 --output benchmark
```

See full accuracy metrics in [`ACCURACY.md`](ACCURACY.md).
