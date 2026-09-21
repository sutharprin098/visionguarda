# CamAI ACAP Architecture & Repository Audit

## Executive Summary

This document presents a comprehensive audit of the existing **CamAI Enterprise CCTV AI Platform** and defines the technical analysis required to migrate core edge-AI analytics onto AXIS network camera devices using the **AXIS Camera Application Platform (ACAP) Native SDK**.

---

## 1. Existing CamAI Architecture Overview

The existing CamAI codebase is structured as a multi-tier hybrid architecture across four primary workspaces:

1. **`server/` (Local Python AI Engine)**
   - **Framework:** FastAPI, OpenCV, ONNX Runtime, OpenVINO.
   - **Concurrency:** Multi-threaded pipeline coordinator with dedicated loops (`_capture_loop`, `_decode_loop`, `_tracking_loop`).
   - **Hardware Target:** x86_64 / Windows / Linux servers equipped with NVIDIA GPUs (TensorRT, CUDA), Intel iGPUs (OpenVINO), or high-core CPUs.
   - **Footprint:** Requires Python 3.10+, PyTorch/ONNX Runtime binaries, and 4GB+ System RAM + 2GB+ VRAM.

2. **`desktop/` (Windows Monitoring & Licensing Client)**
   - **Framework:** Electron, React, TypeScript.
   - **Role:** Supervised local engine process execution, DPAPI machine fingerprinting, live MJPEG streaming viewer.

3. **`portal/` (Cloud SaaS Portal)**
   - **Framework:** React, Vite, Tailwind CSS, Supabase JS.
   - **Role:** Multi-tenant organization management, camera registry, alert webhooks, billing.

4. **`supabase/` (Cloud Data & Event Backend)**
   - **Framework:** PostgreSQL, Row Level Security (RLS), Edge Functions, Realtime.

---

## 2. Existing AI Models & Runtime Audit

| Model / Subsystem | Current Format | Framework | Input Resolution | Output Format | Target Execution | ACAP Compatibility Status |
|---|---|---|---|---|---|---|
| **YOLOX-Tiny** | ONNX (`yolox_tiny.onnx`) | PyTorch export / Megvii YOLOX | 416x416 RGB | Bounding boxes (80 COCO classes) | CPU / OpenVINO / TensorRT | **High** (Ideal for ARTPEC-8 DLPU / Larod ONNX) |
| **YOLOX-S** | ONNX (`yolox_s.onnx`) | PyTorch export | 640x640 RGB | Bounding boxes (80 COCO classes) | CUDA / DirectML | **Medium** (Requires ARTPEC-8 DLPU / 2GB RAM camera) |
| **YOLOX-M** | ONNX (`yolox_m.onnx`) | PyTorch export | 640x640 RGB | Bounding boxes (80 COCO classes) | TensorRT / High-end GPU | **Low** (Exceeds typical camera memory/compute envelope) |
| **RT-DETR Helmet** | ONNX (`helmet.onnx`) | PaddlePaddle / PyTorch | 640x640 RGB | Bounding boxes (Helmet / No-helmet) | CUDA / OpenVINO | **Medium** (Convertible to ONNX/TFLite for Larod) |
| **LPD-YuNet** | ONNX (`plate_detector.onnx`) | OpenCV YuNet deriv | 320x240 RGB | License Plate BBoxes | CPU / DirectML | **High** (Lightweight, well-suited for edge) |
| **CRNN OCR** | ONNX (`plate_ocr.onnx`) | PyTorch / CRNN | 100x32 Grayscale | Text Sequence | CPU | **Medium** (Runs fine on edge CPU, requires C++ postprocessing) |
| **Zero-DCE Night Vision** | PyTorch / Custom ONNX | Zero-DCE | Variable RGB | Enhanced RGB Image | GPU | **Incompatible for Edge AI** (Too heavy for realtime camera ISP pipeline; AXIS Lightfinder hardware ISP replaces this) |

---

## 3. Detailed Component Decomposition & ACAP Feasibility

### A. Reusable Engine Components (Ported to C/C++)
- **ByteTrack Tracker (`server/app/analytics.py`):** The track initialization, Kalman filtering, bounding box prediction, and Hungarian matching logic are pure mathematical operations. These will be re-implemented in C++ (`camai/core/tracking`) using OpenCV C++ / Eigen for zero-dependency edge execution.
- **Analytics Rules (ROI / Line Crossing / Speed / Intrusion):** Polygon intersection, direction vector crossing, and dwell-time calculations in `server/app/analytics.py` can be directly ported to C++ (`camai/core/analytics`).
- **Detection & Class Filtering:** Detection confidence thresholding, NMS (Non-Maximum Suppression), and box scaling logic can be ported to C++ detection headers.

### B. Axis Native Replacement Components
- **Video Capture (`_capture_loop` via OpenCV/RTSP):** Replaced entirely with **AXIS VDO (Video Capture) API** (`vdo-stream.h`), acquiring raw YUV/NV12/RGB frames directly from camera memory without RTSP networking overhead.
- **AI Model Execution (`EngineBackend`):** Replaced with **AXIS Larod API** (`larod.h`) and **ONNX Runtime C API** to leverage hardware acceleration (ARTPEC-7/8 DLPU, TPU, or Arm NEON).
- **Event Generation (FastAPI Webhooks & Supabase):** Replaced with **AXIS axevent API** (`axevent.h`), generating native ONVIF/Axis XML/JSON events into the camera event bus.
- **Video Overlay Rendering (`_decode_loop` OpenCV canvas):** Replaced with **AXIS axoverlay API** (`axoverlay.h`) to render bounding boxes directly onto stream overlays on hardware without re-encoding video.
- **Configuration Persistence (`config.py`):** Replaced with **AXIS axparameter API** (`axparameter.h`), exposing parameters in AXIS OS Web UI and persisting settings.

### C. Components Remaining Server-Side / Cloud
- **Multi-tenant SaaS Admin Portal (`portal/`):** Remains cloud-hosted. ACAP app will communicate via standard HTTP/MQTT webhooks or AXIS Guard Suite integration.
- **High-capacity MP4 Video Archiving (`recorder.py`):** Handled by AXIS Camera Station (ACS), VMS, or local SD card storage via Edge Storage APIs rather than custom server file IO.
- **Heavy Model Training & Quantization (`export_models.py`):** Performed on development host / build server before package deployment.

---

## 4. Hardware & Resource Constraints on AXIS Devices

| Axis Device Generation | Architecture | RAM | Compute / Acceleration | Target FPS (CamAI Edge) | Max Concurrent Models |
|---|---|---|---|---|---|
| **ARTPEC-8 (e.g. Q3536-LVE, P3268-LV)** | `aarch64` | 2 GB - 4 GB | ARTPEC-8 DLPU (Deep Learning Processing Unit) | 25 - 30 FPS | 2 (YOLOX-Tiny + ANPR/Helmet) |
| **ARTPEC-7 (e.g. P3245-LV, Q1645-LE)** | `armv7hf` | 1 GB - 2 GB | ARTPEC-7 DLPU / Arm NEON CPU | 10 - 15 FPS | 1 (YOLOX-Tiny quantized) |
| **Legacy / Standard ARTPEC-6** | `armv7hf` | 512 MB - 1 GB | CPU Only | 3 - 5 FPS | 1 (Lightweight Motion/BBox only) |

---

## 5. Licensing & Commercial Redistribution Audit

- **YOLOX:** Apache 2.0 License (Commercial redistributable).
- **AXIS ACAP SDK:** AXIS License Agreement (Royalty-free for deployment on Axis hardware).
- **OpenCV C++ (Minimal Core):** Apache 2.0 License.
- **Eigen3 (Kalman Filter):** MPL2 License (Header-only, statically linkable).
- **nlohmann/json:** MIT License.

---

## 6. ACAP Migration Risk Matrix

1. **Memory Allocation Overruns:** AXIS OS cgroups enforce strict RAM caps on ACAP applications. Exceeding limit triggers `SIGKILL`.
   - *Mitigation:* Pre-allocated buffer pools, fixed-size track galleries, zero dynamic vector resizing in frame loop.
2. **Inference Queue Backpressure:** Slow inference cycles causing camera stream buffer exhaustion.
   - *Mitigation:* Non-blocking frame acquisition; drop oldest frame immediately if inference queue is occupied (`DROP_OLDEST` strategy).
3. **Overheating & Thermal Throttling:** Sustained 100% NPU/CPU usage on outdoor dome cameras.
   - *Mitigation:* Adaptive FPS throttling (e.g., skip N frames when no motion detected or high temperature reported).
