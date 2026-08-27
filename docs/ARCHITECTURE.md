# Architecture

## Workspaces

CamAI is four independently-run workspaces in one repository. There is no `client/` workspace — the live CCTV viewer is part of `desktop/`; `portal/` is a management/admin SaaS surface, not a video viewer.

| Workspace | Role | Stack | Talks to |
|---|---|---|---|
| `server/` | Local AI engine. One process per machine, runs entirely offline. | FastAPI, OpenCV, ONNX Runtime, OpenVINO | Cameras (RTSP/USB/NVR/stream URL); `desktop/` over `localhost` |
| `desktop/` | Windows monitoring client. Owns licensing, device binding, and supervises the local engine process. | Electron + React + TypeScript | `server/` over `localhost` (MJPEG + WebSocket); `supabase/` over HTTPS/WSS |
| `portal/` | Cloud SaaS admin surface — orgs, users, licenses, cameras, alerts, billing, reports. | React + Vite + Tailwind, Supabase JS | `supabase/` only — it never talks to a local engine directly |
| `supabase/` | Multi-tenant backend: Postgres schema + RLS, Auth, Realtime, Edge Functions. | Supabase (self-hostable) | Both `desktop/` and `portal/`; outbound to Telegram/SMTP for notifications |

```
                       ┌──────────────────────────────┐
                       │           SUPABASE            │
                       │  Auth · Postgres+RLS · Realtime │
                       │  Storage · Edge Functions      │
                       └───────┬──────────────┬────────┘
        admin UI               │              │  activate-license / desktop-sync
                                │              │  realtime org-sync
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

## Local engine pipeline (`server/app/ai/pipeline.py`)

Each registered camera runs a dedicated `PipelineCoordinator` instance managing asynchronous worker loops connected via thread-safe lock structures (`_overlay_lock`, `jpeg_lock`) and lock-free deques:

```
Stage 1  _capture_loop    → Grabs raw frames (RTSP / USB / NVR / YouTube / Screen Share) & applies Auto Zero-DCE Night Vision
Stage 2  _decode_loop     → Independent high-frequency MJPEG encoding at 30–40 FPS, overlaying cached bounding boxes
Stage 3  _tracking_loop   → Asynchronous AI inference (YOLO / ByteTrack / Micro-Motion), updating _latest_overlay_dets
Stage 4  Recorder         → Asynchronous non-blocking MP4 video recording queue
Stage 5  Telemetry & WS   → Pushes live FPS, detection alerts, and system health metrics to Desktop HUD & Supabase
```

**Video streaming and AI inference are fully decoupled.** The MJPEG stream (`_decode_loop`) renders video at 30–40 FPS using cached detection results from `_latest_overlay_dets`. Even if heavy AI workloads (such as Zero-DCE or high-resolution YOLOX inference) slow down the detection cadence, video playback remains fluid and responsive without dropped frames or stuttering.

## Multi-tenancy (`supabase/`)

Every table carries `org_id`, and Postgres RLS policies built on `app.current_org_id()` / `app.has_perm()` enforce that a compromised or malicious client can only ever see its own organization's rows — there is no application-layer tenant check to bypass. See [`DATABASE.md`](DATABASE.md) for the schema and [`SECURITY.md`](SECURITY.md) for the isolation model and its history.

## Licensing and device binding

License keys are generated server-side, stored only as SHA-256 hashes, and shown to the customer exactly once at signup/invite time. The desktop app fingerprints the machine (CPU + motherboard + disk serial + TPM presence + Windows `MachineGuid`), binds that fingerprint to a license via the `activate-license` Edge Function, and stores the resulting Supabase refresh token DPAPI-encrypted (`safeStorage`) so the license key is never asked for again. Deactivating a device server-side fails the next sync closed, wiping the local vault back to the activation screen. Full detail in [`DATABASE.md`](DATABASE.md) and [`SECURITY.md`](SECURITY.md).

## Realtime config sync

The desktop subscribes to org-scoped `postgres_changes` on cameras, camera assignments, roles, settings, and licenses. Any admin edit in the portal re-syncs the desktop's local bundle (assigned cameras, AI thresholds, zone config) within roughly one second, without a restart — `desktop/src/lib/localEngine.ts` diffs the new bundle against what the local engine is currently running and calls `POST /api/cameras` for anything that changed.
