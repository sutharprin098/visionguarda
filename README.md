# CamAI

Edge-deployed video analytics platform for multi-camera CCTV monitoring. Runs object detection, tracking, and alerting on local hardware (OpenVINO, ONNX Runtime, CUDA) and streams results to an Electron desktop client over localhost. Cloud sync (Supabase) handles multi-tenant configuration, licensing, and push notifications.

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
