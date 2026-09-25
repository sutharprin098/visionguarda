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

---

## 7. Video Pipeline & Daemon Stability Audit (Resolution Log)

### Issue Summary
Live MJPEG video streaming at `/axis-cgi/mjpg/video.cgi?fps=25` suffered from `ERR_CONNECTION_CLOSED` disconnections after ~3-5 seconds, resulting in black screens in the Web workspace and intermittent telemetry drops.

### Root Cause Analysis
1. **Axis Camera Daemon Credential Cycling (Apache Socket Teardown):**
   - **Root Cause:** In `ACAP/camai_acap_real.sh`, `get_best_opener()` tested 6 candidate credentials on every snapshot failure or transient timeout. The Axis Apache server interpreted these rapid 401s as a brute-force attempt and severed all active HTTP/CGI sockets, terminating the browser's live video MJPEG stream.
   - **Fix:** Implemented `_working_auth` caching and a 3-consecutive-failure threshold before re-authenticating. Paced local snapshot capture to ~2 FPS (500ms intervals) to eliminate encoder/socket contention.
2. **Cloud Outage Propagating to Local Video (Black Screen):**
   - **Root Cause:** When AWS cloud inference timed out or was offline, the daemon reported `"status": "error"`, causing `Workspace.tsx` to set `sourceFault = true` and hide the live video element.
   - **Fix:** Decoupled local camera video rendering from cloud telemetry status (`!isAcapMode() && (telemetry?.health_status === "offline" ...)`). Daemon now reports `"status": "ok"` with `"aws_status": "offline"` on cloud drops.
3. **CGI Polling Overhead on Embedded ARM:**
   - **Root Cause:** Polling `/local/camai_acap/telemetry.cgi` every 150ms spawned 7 `/bin/sh` forks per second on the camera's CPU, exhausting Apache worker slots.
   - **Fix:** Optimized polling interval to 250ms with a 2000ms timeout via `AbortController`.
4. **Backend Cloud Recovery Watchdog:**
   - **Root Cause:** If cloud inference threw a network exception, the backend remained trapped in an offline state without proactively re-probing.
   - **Fix:** Added a 4.0s periodic retry watchdog in `_ai_loop_iteration_cloud` to automatically resume live cloud detections upon network restoration.
5. **Frontend Stream Watchdog:**
   - **Fix:** Added active stream watchdog timer checking `naturalWidth` and `complete` states on `imgRef`, automatically refreshing the MJPEG stream URL with cache-busting timestamp on freeze or disconnect without tearing down UI state.

---

## 8. Verification & Test Audit

| Test Suite | Purpose | Result |
|---|---|---|
| `test_axis_stream_stability.py` | Verify continuous MJPEG stream under concurrent daemon snapshots | **PASSED** (1/1) |
| `test_real_axis_to_aws.py` | Real Axis snapshot acquisition to AWS cloud inference | **PASSED** (1/1) |
| `test_cloud_recovery.py` | Automatic recovery from network partition / cloud drop | **PASSED** (2/2) |
| `test_confidence.py` | Confidence calibration & zero-mock validation | **PASSED** (17/17) |
| `test_zone_profiles.py` | Zone profile & detection class contract validation | **PASSED** (16/16) |
| `test_final_e2e_acap_validation.py` | End-to-end ACAP daemon, telemetry, and stream contract validation | **PASSED** (5/5) |

