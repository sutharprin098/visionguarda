# CamAI Enterprise - Performance Benchmarks & Scaling Report

---

> **Classification**: Enterprise Performance & Benchmarking Data  
> **Document Reference**: `DOC-PERF-12`

---

## 1. Hardware Performance Benchmarks

All benchmark metrics recorded running 1080p RTSP camera streams at 30.0 target FPS.

### 1.1 GPU Benchmarks (Single-Camera & Multi-Camera Scaling)

| Hardware Configuration | Active Cameras | Execution Backend | Pipeline FPS | Inference Latency | GPU Util % | VRAM |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **NVIDIA RTX 4090 (24GB)** | 1 Stream | TensorRT FP16 | 60.0 FPS | 8.2 ms | 18% | 2.1 GB |
| **NVIDIA RTX 4090 (24GB)** | 16 Streams | TensorRT FP16 | 30.0 FPS | 14.5 ms | 76% | 7.8 GB |
| **NVIDIA RTX 4090 (24GB)** | 32 Streams | TensorRT FP16 | 30.0 FPS | 24.1 ms | 88% | 14.2 GB |
| **NVIDIA RTX 3060 (12GB)** | 4 Streams | CUDA FP16 | 30.0 FPS | 18.4 ms | 64% | 3.8 GB |
| **Intel i7-13700K iGPU** | 2 Streams | OpenVINO GPU | 25.0 FPS | 31.0 ms | 82% | Shared |
| **AMD Radeon RX 6700 (DirectX 12)**| 4 Streams | DirectML | 30.0 FPS | 22.8 ms | 78% | 4.1 GB |

---

## 2. Multi-Stream Scalability Matrix

```
Streams | System Configuration Requirements
--------+-----------------------------------------------------------
1 - 4   | Intel i5/i7 or Ryzen 5 + GTX 1650 / DirectML / OpenVINO
4 - 16  | Single NVIDIA RTX 3060 / 4070 (12GB VRAM) + 16GB System RAM
16 - 32 | NVIDIA RTX 4090 / A100 (24GB VRAM) + 32GB System RAM
32 - 64+| Multi-GPU Node Server (2x RTX 4090 or NVIDIA L4 Cluster)
```
