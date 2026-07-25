# CamAI Enterprise - AI Vision & Video Analytics Platform

[![Download v1.0.0](https://img.shields.io/badge/⬇%20Download-Windows%20v1.0.0-0b7285?style=for-the-badge)](https://github.com/sutharprin098/visionguarda/releases/tag/v1.0.0)
[![Release notes](https://img.shields.io/badge/Release%20README-v1.0.0-informational?style=for-the-badge)](RELEASE_v1.0.0.md)

[![License: Enterprise](https://img.shields.io/badge/License-Enterprise-blue.svg)](LICENSE)
[![Python: 3.11](https://img.shields.io/badge/Python-3.11-green.svg)](server/)
[![React: 18](https://img.shields.io/badge/React-18-blue.svg)](client/)
[![Electron: Desktop](https://img.shields.io/badge/Electron-Desktop-purple.svg)](desktop/)
[![Models: Apache/MIT](https://img.shields.io/badge/Models-Apache%202.0%20%2F%20MIT-brightgreen.svg)](LICENSING.md)

**CamAI Enterprise** is an edge-first AI Vision and Video Analytics system for multi-camera deployment. It processes live RTSP/USB/NVR streams, runs multi-model AI inference on-device (detection, tracking, ANPR, rider-helmet detection, face detection, calibrated speed estimation), and delivers real-time telemetry over WebSockets. **No frame ever leaves the machine.**

---

## ⬇️ Download the Windows app — v1.0.0

| Asset | Size | For |
| :--- | ---: | :--- |
| **[`CamAI-Desktop-Setup-1.0.0.exe`](https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/CamAI-Desktop-Setup-1.0.0.exe)** | 414 MB | Everyone — desktop app **+ AI engine + models**, all bundled |
| [`camai-engine-v1.0.0-win64.zip`](https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/camai-engine-v1.0.0-win64.zip) | 319 MB | Headless server/edge box — API only, no GUI |

> **📖 Read [`RELEASE_v1.0.0.md`](RELEASE_v1.0.0.md) first** — install steps, checksums, system
> requirements, what works vs what is deliberately still locked, honest performance
> numbers, and troubleshooting.
>
> The installer is **unsigned**, so SmartScreen will warn on first run. Verify the
> SHA-256 (`df4a97c5…de798dc5`) and choose *More info → Run anyway*.

---

## Key Features

- **GPU First AI Engine**: Native acceleration via **NVIDIA TensorRT (FP16)**, **CUDA FP16**, **Intel OpenVINO GPU**, **Windows DirectML (DirectX 12)**, and CPU fallback.
- **High-FPS Interleaved Tracking**: Blends YOLOX object detection with ByteTrack (Hungarian matching + appearance ReID) so track IDs survive occlusion. Throughput is hardware-bound — 57 FPS on a mid GPU, ~10 FPS on an Intel iGPU running the full traffic stack. See [`RELEASE_v1.0.0.md`](RELEASE_v1.0.0.md#-performance-honest-numbers).
- **Adaptive GPU Tile Governor**: Dynamically scales inference resolution (320px–1280px) and tile allocations to maintain GPU utilization between 70% and 90%.
- **Analytics Suite** (each with a verified producer in the engine):
  - Vehicle speed estimation (km/h) — real, and requires two-line distance calibration.
  - Automatic Number Plate Recognition (ANPR) & OCR, throttled per track.
  - Rider-helmet detection (traffic), proven on real footage.
  - Face **detection** (YuNet, MIT). *Face recognition — identifying who — is not in v1.0.0.*
  - Intrusion, restricted area, perimeter crossing, loitering, dwell time, crowd.
  - Unattended object / object-removed detection.
  - Directional line crossing, zone entry/exit counters, traffic density.
- **Honest capability gating**: PPE, fire/smoke, red-light and stop-line violation, queue length and face recognition ship **locked, with the reason shown in the UI**, rather than as switches that emit nothing. See the [Coming soon](RELEASE_v1.0.0.md#-coming-soon--deliberately-not-enabled) table.
- **Enterprise Application Suite**:
  - **Desktop Application** (Electron + React): Multi-grid monitor, fullscreen viewer, low-latency overlay, system resource gauges.
  - **SaaS Web Portal** (React + Tailwind + Supabase/PostgreSQL): Multi-tenant management, zone editor, incident logs, historical reporting.
  - **FastAPI Core Engine**: Async REST API, WebSocket telemetry server, automated incident clip recorder.

---

## Documentation Package Index

Complete enterprise technical documentation is located in the [`docs/`](docs/) directory:

| Document | Description |
| :--- | :--- |
| [`01_EXECUTIVE_SUMMARY.md`](docs/01_EXECUTIVE_SUMMARY.md) | Business problem, ROI, capabilities, and target industry value |
| [`02_PRODUCT_DOCUMENTATION.md`](docs/02_PRODUCT_DOCUMENTATION.md) | System workflows, dashboard, camera management, and rule engines |
| [`03_SOFTWARE_ARCHITECTURE.md`](docs/03_SOFTWARE_ARCHITECTURE.md) | System topology, sequence diagrams, component data flows, and thread design |
| [`04_SOURCE_CODE_DOCUMENTATION.md`](docs/04_SOURCE_CODE_DOCUMENTATION.md) | In-depth module, service, class, and method breakdown |
| [`05_AI_ENGINE_DOCUMENTATION.md`](docs/05_AI_ENGINE_DOCUMENTATION.md) | Model pipelines, hardware backends, tiling, and performance tuning |
| [`06_REST_WEBSOCKET_API.md`](docs/06_REST_WEBSOCKET_API.md) | Full OpenAPI endpoints, WebSocket protocol spec, schemas, and codes |
| [`07_DATABASE_DOCUMENTATION.md`](docs/07_DATABASE_DOCUMENTATION.md) | ER diagrams, Supabase PostgreSQL tables, indexes, RLS policies |
| [`08_INSTALLATION_GUIDE.md`](docs/08_INSTALLATION_GUIDE.md) | Step-by-step setup for Windows, Linux, Docker, CUDA, and dependencies |
| [`09_ADMINISTRATOR_GUIDE.md`](docs/09_ADMINISTRATOR_GUIDE.md) | User management, license activation, backup/restore, and health monitoring |
| [`10_DEVOPS_DEPLOYMENT.md`](docs/10_DEVOPS_DEPLOYMENT.md) | Docker Compose, NGINX reverse proxy, SSL, CI/CD, and scaling |
| [`11_SECURITY_COMPLIANCE.md`](docs/11_SECURITY_COMPLIANCE.md) | JWT auth, RBAC, encryption, OWASP hardening, and audit logging |
| [`12_PERFORMANCE_BENCHMARKS.md`](docs/12_PERFORMANCE_BENCHMARKS.md) | Stress test results, FPS/latency matrices across hardware configurations |
| [`13_TESTING_TROUBLESHOOTING.md`](docs/13_TESTING_TROUBLESHOOTING.md) | Unit test suite execution, failure diagnosis, and troubleshooting matrix |
| [`14_BUYER_HANDOVER_LICENSING.md`](docs/14_BUYER_HANDOVER_LICENSING.md) | Asset handover checklist, source code transfer, and license agreement |

---

## Quick Start (Development)

### Prerequisites
- **Python**: 3.11+
- **Node.js**: 18+ / 20+
- **FFmpeg**: Installed and on `PATH`
- **GPU (Optional)**: NVIDIA GPU with CUDA 11.8/12.x or Intel iGPU with OpenVINO drivers

### 1. Server Setup
```bash
cd server
python -m venv venv
venv\Scripts\activate      # On Windows
# source venv/bin/activate # On Linux
pip install -r requirements.txt
python -m app.main
```
The server will start at `http://127.0.0.1:8000` (API Docs at `http://127.0.0.1:8000/docs`).

### 2. Desktop Monitor Suite Setup
```bash
cd desktop
npm install
npm run dev
```

### 3. Web SaaS Portal Setup
```bash
cd client
npm install
npm run dev
```

---

## Test Verification
Run the backend automated test suite (206 tests across 13 files in `server/tests/`):
```bash
cd server
pytest
```

---

## System Architecture Overview

```mermaid
graph LR
    SubGraph1[Capture & Decode] --> SubGraph2[AI Inference Engine]
    SubGraph2 --> SubGraph3[Tracking & Analytics]
    SubGraph3 --> SubGraph4[Streaming & Telemetry]

    subgraph SubGraph1
        A[IP Camera RTSP] --> B[Decoded Slot / Queue]
    end

    subgraph SubGraph2
        B --> C[YOLOX / YOLO11 Backend]
        C --> D[Face / Helmet / ANPR Passes]
    end

    subgraph SubGraph3
        D --> E[ByteTrack Tracker]
        E --> F[CameraAnalytics Rules & Speed]
    end

    subgraph SubGraph4
        F --> G[MJPEG HTTP Stream]
        F --> H[WebSocket Telemetry Server]
    end
```

---

## Support & Handover Contact
For technical due diligence inquiries or enterprise licensing support, refer to [`docs/14_BUYER_HANDOVER_LICENSING.md`](docs/14_BUYER_HANDOVER_LICENSING.md).
