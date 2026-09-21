# CamAI ACAP Component Migration Plan

## 1. Migration Overview & Strategy

This document outlines the step-by-step technical plan to port the CamAI CCTV AI engine into a high-performance **AXIS ACAP Native Application (C/C++)**.

The migration prioritizes:
1. **Zero-copy video pipeline** via AXIS VDO API.
2. **Hardware-accelerated AI inference** via AXIS Larod API / ONNX Runtime C API.
3. **Native AXIS OS integration** for Events (`axevent`), Overlays (`axoverlay`), and Parameters (`axparameter`).
4. **Strict resource governance** to ensure 24/7 thermal and memory stability on embedded cameras.

---

## 2. Phase-by-Phase Roadmap

### Phase 1: Environment & Project Foundation
- Establish `CamAI-ACAP` build structure with official `Dockerfile` using `axisecp/acap-native-sdk:11.11.0-aarch64` / `armv7hf`.
- Create `manifest.json` following AXIS Manifest Schema 2.0.
- Set up C++20 Makefile build system with strict warnings (`-Wall -Wextra -Werror`).

### Phase 2: Core Hardware Abstractions
- **Video Capture Abstraction (`app/video_pipeline.cpp`):** Wrap VDO API (`vdo_stream_create`, `vdo_stream_get_frame`, `vdo_frame_get_buffer`).
- **Parameter Management (`app/config.cpp`):** Initialize `axparameter` handling for UI settings (confidence thresholds, ROI parameters, overlay toggle).
- **Diagnostics & Resource Watchdog (`app/diagnostics.cpp`):** Implement memory usage tracker and CPU/NPU watchdog.

### Phase 3: Hardware AI Inference Runtime
- **Larod & ONNX Runtime Bridge (`app/inference.cpp`):** Implement model loading, tensor buffer allocation, pre-processing (NV12/YUV to RGB planar normalized), and post-processing (NMS, bounding box scaling).

### Phase 4: Reference Analytics Module Port (Security & Perimeter)
- **Object Detection & Classification:** Person and vehicle class filtering.
- **C++ Multi-Object Tracker (`app/tracking.cpp`):** Port ByteTrack algorithm with Kalman filter and Hungarian matching.
- **Region of Interest (ROI) & Tripwire Logic:** Port polygonal intrusion and directional line-crossing algorithms.

### Phase 5: AXIS Native Event & Overlay Pipeline
- **AXIS Event Producer (`app/events.cpp`):** Register custom ONVIF/Axis event topics (`CamAI/Security/Intrusion`, `CamAI/Security/LineCrossing`).
- **AXIS Stream Overlay Producer (`app/overlay.cpp`):** Render realtime bounding boxes and ROI lines using `axoverlay`.

### Phase 6: Package Creation & Hardware Validation
- Package binary, manifest, and ONNX model into `.eap` package using `acap-build`.
- Deploy onto target AXIS device (e.g. ARTPEC-8 camera).
- Run continuous 24-hour stability test and benchmark performance.

---

## 3. Component-by-Component Mapping

| Existing Python Component | New C++ ACAP Component | AXIS Native API | Notes |
|---|---|---|---|
| `server/app/main.py` | `app/main.cpp` | POSIX Signal Handling | Application lifecycle & signal handlers |
| `server/app/ai/pipeline.py` | `app/camai_engine.cpp` | `pthread` / C++17 Threads | Thread-safe frame processing pipeline |
| `server/app/ai/backend.py` | `app/inference.cpp` | AXIS Larod / ONNX C API | Hardware-accelerated model runner |
| OpenCV RTSP capture loop | `app/video_pipeline.cpp` | AXIS VDO API (`vdo-stream.h`) | Direct zero-copy frame access |
| `server/app/analytics.py` (ByteTrack) | `app/tracking.cpp` | Native C++ Kalman + Hungarian | Pure C++ tracking logic |
| `server/app/analytics.py` (Zones) | `modules/security/` | Custom C++ Geometry engine | ROI intrusion & Line crossing |
| Supabase WS / Webhooks | `app/events.cpp` | AXIS axevent API (`axevent.h`) | AXIS camera event bus |
| OpenCV Drawing overlay | `app/overlay.cpp` | AXIS axoverlay API (`axoverlay.h`) | Hardware stream rendering |
| `server/app/config.py` | `app/config.cpp` | AXIS axparameter API (`axparameter.h`) | AXIS OS Web settings & persist |

---

## 4. Hardware Deployment Strategy

Target initial device: **AXIS Camera with ARTPEC-8 DLPU (e.g., AXIS P3268-LV or AXIS Q3536-LVE)**.
- **Architecture:** `aarch64` (ARM 64-bit)
- **AXIS OS:** 11.x / 12.x
- **ACAP Version:** Native SDK 11+
- **Model:** YOLOX-Tiny ONNX model optimized for Larod/DLPU engine.
