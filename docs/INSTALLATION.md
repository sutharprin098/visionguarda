# Installation (Development)

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (20+ recommended)
- **FFmpeg** on `PATH` (used for recording/clip export)
- **GPU (optional)** — NVIDIA GPU for CUDA/TensorRT, or an Intel iGPU for OpenVINO GPU. The engine runs on CPU with no GPU present; see [`AI_ENGINE.md`](AI_ENGINE.md) for the backend priority order.

There is no Docker/Docker Compose setup in this repository — the local engine, desktop app, and portal are each run natively.

## 1. Local AI engine (`server/`)

```bash
cd server
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/macOS

pip install -r server-requirements.txt
python run_engine.py
```

The engine listens on `http://127.0.0.1:8000`; interactive API docs are at `http://127.0.0.1:8000/docs`. It binds loopback only and has no user auth — see [`SECURITY.md`](SECURITY.md).

Optional GPU acceleration: install `onnxruntime-gpu` manually on an NVIDIA host to enable the CUDA/TensorRT execution providers; `openvino` (already in `server-requirements.txt`) covers Intel CPU/iGPU.

To run tests instead, see [`TESTING.md`](TESTING.md).

## 2. Desktop client (`desktop/`)

```bash
cd desktop
npm install
npm run dev
```

`npm run dev` kills any running `electron.exe`/`CamAI Desktop.exe` first, then starts Vite + Electron. The desktop connects to Supabase using a baked-in default project URL/anon key (`desktop/electron/main.ts`); override with `CAMAI_SUPABASE_URL` / `CAMAI_SUPABASE_ANON_KEY` environment variables to point at a different Supabase project (e.g. your own dev project instead of the shipped one). Other useful env vars:

- `CAMAI_REMOTE_DEBUG=<port>` — enables Chromium remote debugging
- `CAMAI_OPEN_DEVTOOLS=1` — opens DevTools on launch
- `CAMAI_APP_TYPE=admin` — builds/runs as the Admin Studio variant

The desktop expects the local engine (`server/`) to already be running for live camera preview — it does not spawn or manage that process; it shows an honest "engine isn't running" state if `server/` isn't up.

## 3. Cloud portal (`portal/`)

```bash
cd portal
cp .env.example .env      # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev                # http://localhost:5174
```

## 4. Supabase backend (`supabase/`)

Only needed if you're standing up your own backend rather than pointing at an existing one. See [`DATABASE.md`](DATABASE.md#deploying-a-fresh-supabase-project) for the full migration + Edge Function deploy sequence.

## Root-level convenience scripts

`package.json` at the repo root wraps `server/` + `portal/` (not `desktop/`, which is run separately):

```bash
npm run install:all   # npm install at root, server/, and portal/
npm run dev            # runs server + portal concurrently
npm run build           # builds server + portal
```

## Running all three together

Open three shells:

```bash
# shell 1
cd server && python run_engine.py

# shell 2
cd desktop && npm run dev

# shell 3
cd portal && npm run dev
```
