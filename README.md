# CamAI — AI Video Analytics Platform

Real-time CCTV analytics: multi-camera YOLOX detection, persistent
multi-object tracking, zone/line/dwell/speed/crowd/parking analytics,
recording, and an enterprise licensing platform (SaaS portal + Windows
desktop app on Supabase).

Fully permissive licensing: every runtime and development dependency,
including the detector weights, is MIT / BSD / Apache-2.0. See `LICENSING.md`.

| Workspace | What it is | Stack |
|---|---|---|
| `server/` | Local AI engine — cameras in, telemetry out | FastAPI, OpenVINO/ONNX Runtime, YOLOX (Apache-2.0), ByteTrack-style tracker |
| `portal/` | SaaS admin portal (orgs, users, roles, licenses, devices, cameras) | React, Supabase JS |
| `desktop/` | Windows app with license activation + DPAPI vault | Electron, electron-builder |
| `supabase/` | Multi-tenant backend: Postgres + RLS, Auth, Realtime, Edge Functions | Supabase |

`PLATFORM.md` explains how the pieces fit; `LICENSING.md` is the third-party
license inventory; `HANDOVER.md` is the buyer/due-diligence guide.

## Quick start (local engine + viewer)

Prerequisites: Python 3.11+, Node.js ≥ 18.

```bash
# 1. AI engine
cd server
python -m pip install -r server-requirements.txt
copy .env.example .env
python -m app.main            # http://127.0.0.1:8000

# 2. Portal (second terminal)
cd portal
npm install
npm run dev                   # http://localhost:5173
```

Add a camera in the viewer (RTSP URL, HTTP/MJPEG, or a local webcam index
like `0`) and draw zones/lines/parking slots on the live view.

Model files: the engine looks for `yolox_{tiny,s,m}` OpenVINO/ONNX exports
in `server/`. To (re)generate them from the upstream Apache-2.0 checkpoints
(downloads the checkpoints and clones the YOLOX repo on first run):

```bash
python -m pip install -r server/dev-requirements.txt   # dev-only; not shipped
python server/export_models.py            # all three tiers
python server/export_models.py yolox_s    # or just one
```

The engine auto-selects the fastest available backend at startup:
TensorRT/CUDA (via onnxruntime-gpu) → OpenVINO GPU/CPU → ONNX Runtime CPU.

## Architecture — AI engine

Video and AI are decoupled: MJPEG delivers frames at camera FPS while a
WebSocket carries AI-only telemetry (detections, tracks, analytics); the
client draws overlays on a canvas above the video. The per-camera
pipeline (`server/app/ai/pipeline.py`) is a 5-module slot design — capture,
detect, track, analyze, publish — measured at 30 fps with ~10 ms average
AI-cycle latency on Intel iGPU (OpenVINO).

Analytics per camera: intrusion/loitering zones, line crossing with
interpolated crossing instants, dwell, Kalman-smoothed speed, crowd
density, abandoned-object detection, parking-slot occupancy (vehicle
overlap + visual fallback), heatmaps.

## Enterprise platform

Portal + desktop + Supabase backend: hash-only license keys, device
fingerprint binding, org-scoped RLS multi-tenancy, realtime config sync,
append-only audit log. Setup and account flows: see `PLATFORM.md`.

```bash
cd portal && npm install && npm run dev      # http://localhost:5174
cd desktop && npm install && npm run start   # dev; npm run build → NSIS installer
```

## Tests

```bash
cd server && python -m pip install -r dev-requirements.txt && python -m pytest tests
```

`server/production_readiness_report.py` runs the deterministic validation
suite and writes a machine-readable report.

## Security posture

- The engine binds `127.0.0.1` by default and has no auth of its own — it
  is fronted by the desktop app/viewer. Set `CAMAI_HOST` only on trusted
  networks or behind an authenticating proxy.
- Platform security (RLS, key hashing, DPAPI vault, audit): `PLATFORM.md`.
- Secrets live in untracked `.env` files; only `.env.example` is committed.
