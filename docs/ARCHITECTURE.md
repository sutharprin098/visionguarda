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

Each registered camera runs its own pipeline instance: six modules on dedicated threads, each handing off through a size-1 "latest wins" slot, plus a seventh module for recording. This is deliberate — a slow downstream stage drops stale frames rather than building a backlog, so latency never compounds.

```
Module 1  Capture           → grabs frames from cv2.VideoCapture (must stay single-threaded — OpenCV capture objects are not thread-safe)
Module 2  MJPEG Encode      → JPEG-encodes at camera FPS for the live stream; skipped entirely when no viewer is attached
Module 3  AI Inference      → detector backend (see AI_ENGINE.md) on a cadence independent of capture FPS
Module 4  Tracking + Rules  → ByteTrack-style tracker + CameraAnalytics (zones, speed, dwell, crowd, …)
Module 5  Telemetry Build   → assembles the WebSocket payload from the latest tracking result
Module 6  WebSocket Dispatch→ fans the payload out to connected clients
Module 7  Recording         → CCTVRecorder, its own thread + async queue, independent of the above chain
```

**Video and AI are decoupled on purpose.** The MJPEG stream (Module 2) runs at the camera's native FPS regardless of how fast AI inference is keeping up; the WebSocket (Modules 3–6) carries telemetry only — bounding boxes, track IDs, analytics events — never a frame. The desktop client renders the MJPEG image and draws the latest telemetry as a canvas overlay on top. A slow AI pass makes the overlay trail the video briefly; it never stalls or freezes the live picture.

## Multi-tenancy (`supabase/`)

Every table carries `org_id`, and Postgres RLS policies built on `app.current_org_id()` / `app.has_perm()` enforce that a compromised or malicious client can only ever see its own organization's rows — there is no application-layer tenant check to bypass. See [`DATABASE.md`](DATABASE.md) for the schema and [`SECURITY.md`](SECURITY.md) for the isolation model and its history.

## Licensing and device binding

License keys are generated server-side, stored only as SHA-256 hashes, and shown to the customer exactly once at signup/invite time. The desktop app fingerprints the machine (CPU + motherboard + disk serial + TPM presence + Windows `MachineGuid`), binds that fingerprint to a license via the `activate-license` Edge Function, and stores the resulting Supabase refresh token DPAPI-encrypted (`safeStorage`) so the license key is never asked for again. Deactivating a device server-side fails the next sync closed, wiping the local vault back to the activation screen. Full detail in [`DATABASE.md`](DATABASE.md) and [`SECURITY.md`](SECURITY.md).

## Realtime config sync

The desktop subscribes to org-scoped `postgres_changes` on cameras, camera assignments, roles, settings, and licenses. Any admin edit in the portal re-syncs the desktop's local bundle (assigned cameras, AI thresholds, zone config) within roughly one second, without a restart — `desktop/src/lib/localEngine.ts` diffs the new bundle against what the local engine is currently running and calls `POST /api/cameras` for anything that changed.
