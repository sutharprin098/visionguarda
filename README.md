# CamAI — Desktop v1.1.0 · Mobile v1.0.2

Edge-deployed video analytics platform for multi-camera CCTV monitoring. Runs 19 neural detection models on local GPU hardware (TensorRT, ONNX Runtime, CUDA) and streams results to an Electron desktop client and React Native mobile app over localhost + Supabase real-time sync.

> **Latest Release** — [Desktop v1.1.0 EXE](https://github.com/sutharprin098/visionguarda/releases/download/v1.1.0/CamAI-Desktop-Setup-1.1.0.exe) · [Mobile v1.0.2 APK](https://camai.princesite.in/downloads/CamAI-Mobile.apk) · [Website](https://camai.princesite.in)

## What's New — v1.1.0 / v1.0.2

| Feature | Component | Description |
|---|---|---|
| **Digital Twin 3D View** | Mobile | Three.js 3D floor-plan with live camera overlays, zone visualization, and real-time detection spatial mapping |
| **Auto Scene Detector** | Mobile | AI classifies scene type (traffic, retail, factory, security, smart-city) and auto-configures zone profiles |
| **Twin Zone Manager** | Mobile | Create, edit, lock, hide, and bind detection zones in the 3D digital twin with full undo/redo |
| **NotificationPreferences** | Mobile | Per-alert-type push/in-app/Telegram/email channel control with cooldown intervals |
| **ErrorBoundary** | Mobile | Production-grade crash isolation — single component failure never takes down the workspace |
| **RT-DETR Helmet Detector** | Server | Replaced AGPL YOLOv8 weights with Apache-2.0 RT-DETR for license-clean binary redistribution |
| **YuNet Face Detector** | Server | MIT-licensed face detection on person crops — 2× faster, +25% recall vs whole-frame inference |
| **ProfileDashboard** | Desktop | Per-profile stat tiles that show only metrics the engine genuinely emits — no phantom 0% readings |

## Architecture

```
                     ┌──────────────────────────────────┐
                     │           SUPABASE                │
                     │  Auth · Postgres+RLS · Realtime   │
                     │  Storage · Edge Functions          │
                     └───────┬──────────────┬────────────┘
          admin UI           │              │  license activation / config sync
                             │              │  realtime org-scoped channels
                  ┌──────────┴───┐      ┌───┴──────────────┐      ┌──────────────────┐
                  │  portal/      │      │  desktop/         │      │  mobile/          │
                  │  Web SaaS     │      │  Windows client   │      │  Android APK      │
                  └───────────────┘      └───┬──────────────┘      └──────────────────┘
                                             │ localhost (MJPEG + WebSocket)
                                         ┌───┴──────────────┐
                                         │  server/          │
                                         │  Local AI engine  │
                                         └──────────────────┘
```

Full architecture detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository Layout

```
camAI/
├── server/                     # Local AI engine (FastAPI + OpenCV + ONNX/TensorRT)
│   ├── app/
│   │   ├── ai/                 # YOLOX, RT-DETR helmet, YuNet face, ByteTrack, ALPR
│   │   ├── analytics.py        # Zone rules, speed estimation, dwell/loitering
│   │   ├── camera_manager.py   # Per-camera pipeline lifecycle and watchdog
│   │   └── main.py             # FastAPI routes, WebSocket telemetry, MJPEG streaming
│   └── run_engine.py           # Entry point
│
├── desktop/                    # Windows monitoring client (Electron + React + TypeScript)
│   ├── src/
│   │   ├── components/         # Detection overlays, TwinZoneEditorModal, ProfileDashboard
│   │   ├── screens/            # Workspace (live grid), AdminStudio (zone + scene config)
│   │   ├── lib/                # autoSceneDetector, twinZoneManager, telemetry, alertEngine
│   │   └── App.tsx             # Session bootstrap, license gate, screen routing
│   ├── electron/               # Main process, engine supervisor, IPC bridge
│   └── package.json
│
├── mobile/                     # Android app (React Native + Capacitor)
│   ├── src/
│   │   ├── components/         # DigitalTwin3DView, TwinZoneEditor, NotificationPreferences
│   │   ├── screens/            # AdminStudio, Workspace, FloorPlanView, RecordingsPlayback
│   │   └── lib/                # autoSceneDetector, twinZoneManager, telemetry, alertEngine
│   └── android/                # Native Android shell, Gradle build, FCM config
│
├── portal/                     # Cloud admin portal + marketing site (React + Vite)
│   └── src/
│       ├── components/landing/ # HeroSection, DigitalTwinSection, AIFeaturesGrid (19 models)
│       └── pages/              # Dashboard, cameras, alerts, downloads, billing
│
├── supabase/                   # Multi-tenant backend
│   ├── migrations/             # Postgres schema, RLS policies, triggers
│   └── functions/              # Edge Functions (push, license, download)
│
└── docs/                       # Technical documentation
```

## Quick Start

See [`docs/INSTALLATION.md`](docs/INSTALLATION.md) for full GPU setup and environment variables.

```bash
# 1. AI engine
cd server
python -m venv .venv && .venv\Scripts\activate
pip install -r server-requirements.txt
python run_engine.py              # http://127.0.0.1:8000

# 2. Desktop client
cd desktop
npm install && npm run dev

# 3. Mobile (Android)
cd mobile
npm install && npx cap run android

# 4. Portal (optional)
cd portal
npm install && npm run dev        # http://localhost:5174
```

## Hardware Backend Priority

The engine probes available hardware at startup and selects the fastest backend:

| Priority | Backend | Notes |
|---|---|---|
| 1 | TensorRT | NVIDIA, fused FP16 |
| 2 | CUDA | NVIDIA, ONNX RT execution provider |
| 3 | DirectML | Any DirectX 12 GPU |
| 4 | OpenVINO GPU | Intel iGPU/dGPU (static input shape) |
| 5 | CPU | Universal fallback |

See [`docs/AI_ENGINE.md`](docs/AI_ENGINE.md) for model details, tiling, and tracking internals.

## Detection Models (19 Total)

| Capability | Model | License |
|---|---|---|
| Object detection | YOLOX (tiny / s / m) | Apache-2.0 |
| Helmet classification | RT-DETR (R18/R50) | Apache-2.0 |
| Face detection | YuNet | MIT |
| Face embedding/Re-ID | SFace | Apache-2.0 |
| Plate localization | LPD-YuNet | Apache-2.0 |
| Plate OCR | CRNN | Apache-2.0 |
| Digital Twin spatial AI | Three.js + Zone Engine | MIT |
| Auto Scene Classification | AutoSceneDetector | Proprietary |

**19 concurrent neural detection models:** Human · Vehicle · Face · PPE · Fire · Smoke · Crowd · Weapon · Loitering · Fall · Intrusion · Line Crossing · People Counting · Parking · ALPR · Behavioral Anomaly · Digital Twin 3D · Auto Scene Detector · Twin Zone Manager

Full licensing history: [`docs/LICENSING.md`](docs/LICENSING.md).

## Performance Targets

| Metric | Target |
|---|---|
| MJPEG stream latency | < 120 ms |
| Stream frame rate | 30–40 FPS |
| Detection inference | 9–15 ms/frame (GPU) |
| Process RSS | < 450 MB |
| Max concurrent cameras | 16 |
| Scene classification | < 50ms/frame |

## Releases

| Version | Platform | Download | SHA-256 |
|---|---|---|---|
| v1.1.0 | Windows x64 | [CamAI-Desktop-Setup-1.1.0.exe](https://github.com/sutharprin098/visionguarda/releases/download/v1.1.0/CamAI-Desktop-Setup-1.1.0.exe) | `b1ecff1a...598b2` |
| v1.0.2 | Android APK | [CamAI-Mobile.apk](https://camai.princesite.in/downloads/CamAI-Mobile.apk) | — |

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for full release pipeline.

## Build & Release

```bash
# Desktop EXE
cd desktop
npm run build          # tsc → vite → electron-builder → checksum

# Android APK
cd mobile/android
gradlew bundleRelease  # produces app-release.aab

# Portal
cd portal
npm run build          # static site for Vercel deploy
```

## Security

- HMAC control token (`X-CamAI-Token`) on all mutation endpoints with brute-force lockout
- DNS-rebinding protection via Host header validation
- SSRF guard on camera source URLs (blocks loopback, link-local, non-media schemes)
- DPAPI-encrypted credential storage (Windows `safeStorage`)
- Row-Level Security on all Supabase tables scoped by `org_id`

Full audit results: [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentation Index

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System topology, pipeline stages, sync model |
| [`AI_ENGINE.md`](docs/AI_ENGINE.md) | Backend selection, 19 models, tiling, tracking |
| [`API.md`](docs/API.md) | REST and WebSocket endpoint reference |
| [`DATABASE.md`](docs/DATABASE.md) | Postgres schema, RLS policies, local SQLite |
| [`SECURITY.md`](docs/SECURITY.md) | Threat model, audit findings, isolation |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Build, release, code signing, Supabase deploy |
| [`INSTALLATION.md`](docs/INSTALLATION.md) | Dev setup, prerequisites, env vars |
| [`TESTING.md`](docs/TESTING.md) | Test suite and verification |
| [`PERFORMANCE.md`](docs/PERFORMANCE.md) | Benchmarks and optimization notes |
| [`USER_GUIDE.md`](docs/USER_GUIDE.md) | Operator manual |
| [`LICENSING.md`](docs/LICENSING.md) | Model and dependency licenses |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

## License

See [`LICENSE`](LICENSE).


## Architecture

```
                     ┌──────────────────────────────────┐
                     │           SUPABASE                │
                     │  Auth · Postgres+RLS · Realtime   │
                     │  Storage · Edge Functions          │
                     └───────┬──────────────┬────────────┘
          admin UI           │              │  license activation / config sync
                             │              │  realtime org-scoped channels
                  ┌──────────┴───┐      ┌───┴──────────────┐
                  │  portal/      │      │  desktop/         │
                  │  Web SaaS     │      │  Windows client   │
                  └───────────────┘      └───┬──────────────┘
                                             │ localhost (MJPEG + WebSocket)
                                         ┌───┴──────────────┐
                                         │  server/          │
                                         │  Local AI engine  │
                                         └──────────────────┘
```

Full architecture detail, including the per-camera pipeline stages and multi-tenancy model: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository Layout

```
camAI/
├── server/                     # Local AI engine (FastAPI + OpenCV + OpenVINO/ONNX)
│   ├── app/
│   │   ├── ai/                 # YOLOX, ByteTrack, tiling, plate/helmet/face models
│   │   ├── analytics.py        # Zone rules, speed estimation, dwell/loitering
│   │   ├── camera_manager.py   # Per-camera pipeline lifecycle and watchdog
│   │   ├── config.py           # Environment-driven configuration
│   │   ├── storage.py          # SQLite event and recording index
│   │   └── main.py             # FastAPI routes, WebSocket telemetry, MJPEG streaming
│   ├── models/                 # Quantized ONNX / OpenVINO IR weights (gitignored)
│   └── run_engine.py           # Entry point
│
├── desktop/                    # Windows monitoring client (Electron + React + TypeScript)
│   ├── src/
│   │   ├── components/         # Detection/performance overlays, ROI editor, zone manager
│   │   ├── screens/            # Workspace (live grid), AdminStudio (zone config)
│   │   ├── lib/                # Engine bridge, telemetry, alert engine, sync
│   │   └── App.tsx             # Session bootstrap, license gate, screen routing
│   ├── electron/               # Main process, engine supervisor, proxy
│   └── package.json
│
├── mobile/                     # Mobile client (React + Capacitor)
│   ├── src/                    # Mirrors desktop UI; inference runs on cloud GPU
│   └── android/                # Native Android shell and FCM config
│
├── portal/                     # Cloud admin portal (React + Vite)
│   └── src/                    # Org management, user roles, camera fleet, billing
│
├── supabase/                   # Multi-tenant backend
│   ├── migrations/             # Postgres schema, RLS policies, triggers
│   └── functions/              # Edge Functions (push-notification, license, download)
│
└── docs/                       # Technical documentation
```

## Quick Start

See [`docs/INSTALLATION.md`](docs/INSTALLATION.md) for full details including GPU setup and environment variables.

```bash
# 1. AI engine
cd server
python -m venv .venv && .venv\Scripts\activate
pip install -r server-requirements.txt
python run_engine.py              # http://127.0.0.1:8000

# 2. Desktop client
cd desktop
npm install && npm run dev

# 3. Portal (optional)
cd portal
npm install && npm run dev        # http://localhost:5174
```

## Hardware Backend Priority

The engine probes available hardware at startup and selects the fastest backend:

| Priority | Backend | Notes |
|---|---|---|
| 1 | TensorRT | NVIDIA, fused FP16 |
| 2 | CUDA | NVIDIA, ONNX RT execution provider |
| 3 | DirectML | Any DirectX 12 GPU |
| 4 | OpenVINO GPU | Intel iGPU/dGPU (static input shape) |
| 5 | CPU | Universal fallback |

See [`docs/AI_ENGINE.md`](docs/AI_ENGINE.md) for model details, tiling, and tracking internals.

## Detection Models

| Capability | Model | License |
|---|---|---|
| Object detection | YOLOX (tiny / s / m) | Apache-2.0 |
| Helmet classification | RT-DETR (R18/R50) | Apache-2.0 |
| Face detection | YuNet | MIT |
| Plate localization | LPD-YuNet | Apache-2.0 |
| Plate OCR | CRNN | Apache-2.0 |

Full licensing history: [`docs/LICENSING.md`](docs/LICENSING.md).

## Performance Targets

| Metric | Target |
|---|---|
| MJPEG stream latency | < 120 ms |
| Stream frame rate | 30–40 FPS |
| Detection inference | 15–30 ms/frame (GPU) |
| Process RSS | < 450 MB |
| Max concurrent cameras | 16 |

## Build & Release

Desktop installer and engine executable are built locally (model weights are gitignored). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full release pipeline, code signing, and GitHub Releases integration.

```bash
cd desktop
npm run build          # tsc → vite → electron-builder → checksum → verify-signature
npm run build:full     # includes engine rebuild via PyInstaller
```

## Security

- HMAC control token (`X-CamAI-Token`) on all mutation endpoints with brute-force lockout
- DNS-rebinding protection via Host header validation
- SSRF guard on camera source URLs (blocks loopback, link-local, non-media schemes)
- DPAPI-encrypted credential storage (Windows `safeStorage`)
- Row-Level Security on all Supabase tables scoped by `org_id`

Full audit results and threat model: [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentation Index

| Document | Contents |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System topology, pipeline stages, sync model |
| [`AI_ENGINE.md`](docs/AI_ENGINE.md) | Backend selection, models, tiling, tracking |
| [`API.md`](docs/API.md) | REST and WebSocket endpoint reference |
| [`DATABASE.md`](docs/DATABASE.md) | Postgres schema, RLS policies, local SQLite |
| [`SECURITY.md`](docs/SECURITY.md) | Threat model, audit findings, isolation |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Build, release, code signing, Supabase deploy |
| [`INSTALLATION.md`](docs/INSTALLATION.md) | Dev setup, prerequisites, env vars |
| [`TESTING.md`](docs/TESTING.md) | Test suite and verification |
| [`PERFORMANCE.md`](docs/PERFORMANCE.md) | Benchmarks and optimization notes |
| [`USER_GUIDE.md`](docs/USER_GUIDE.md) | Operator manual |
| [`LICENSING.md`](docs/LICENSING.md) | Model and dependency licenses |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

## License

See [`LICENSE`](LICENSE).
