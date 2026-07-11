# CamAI — Licensing & Third-Party Inventory

Everything a buyer's counsel needs to know about what is owned, what is
third-party, and what needs action before commercial redistribution.
Last audited: 2026-07-11.

## 1. What is owned outright

All first-party source code in this repository is original work and
transfers with the sale:

- `server/app/` — FastAPI AI engine: 5-module slot pipeline, ByteTrack-style
  tracker with appearance ReID (original implementation, not the reference
  ByteTrack codebase), analytics (zones, lines, dwell, speed, crowd,
  abandoned-object, parking occupancy), recorder, storage.
- `client/` — React CCTV viewer (MJPEG + WebSocket telemetry overlay).
- `portal/` — React SaaS admin portal.
- `desktop/` — Electron Windows app (licensing vault, sync).
- `supabase/` — Postgres schema, RLS policies, edge functions.

The parking-occupancy visual score (`server/app/analytics.py::
_parking_visual_score`) is an original implementation using standard
OpenCV/NumPy statistics (Sobel gradient fraction, interquartile spread,
median deviation).

## 2. The one item that needs a decision: YOLO11 model weights

**Status: action required before redistribution. This is the single
material licensing issue in the project.**

- The detector ships as YOLO11-seg weights (`yolo11{n,s,m}-seg.pt`) trained
  and published by **Ultralytics under AGPL-3.0**. The ONNX/OpenVINO files
  used at runtime are exported from those weights and inherit the same
  license position (Ultralytics treats exports as derivatives).
- The `ultralytics` Python package (AGPL-3.0) is **not** a runtime
  dependency. It lives in `server/dev-requirements.txt` and is used only by
  `server/export_models.py` (model conversion) and as a last-resort `.pt`
  fallback in `backend.py` when no exported model is present. Production
  inference runs on OpenVINO / ONNX Runtime with first-party pre/post
  processing (letterboxing, NMS, mask decoding in `server/app/ai/backend.py`).

A purchaser distributing the product with these weights must do one of:

1. **Buy an Ultralytics Enterprise License** (removes AGPL obligations;
   this is the fast path and priced for exactly this situation), or
2. **Swap the model** for an Apache-2.0/MIT detector (e.g. YOLOX, RT-DETR,
   D-FINE) — `EngineBackend` consumes standard ONNX, so the integration
   cost is the export + post-processing adaptation + revalidation, or
3. Comply with AGPL-3.0 (source disclosure to all network users — normally
   incompatible with a proprietary sale).

Until then, keep deployments internal/evaluation-only.

## 3. Runtime dependencies (all permissive)

| Component | License | Notes |
|---|---|---|
| FastAPI, Pillow | MIT-style | |
| Uvicorn, NumPy, SciPy | BSD-3 | |
| OpenCV (opencv-python-headless) | Apache-2.0 | |
| OpenVINO | Apache-2.0 | |
| ONNX Runtime | MIT | |
| python-multipart | Apache-2.0 | |
| React, Vite, Tailwind, Electron, Supabase JS, TanStack Query | MIT | |
| imageio-ffmpeg | BSD-2 | **but see below** |

**imageio-ffmpeg** bundles a static `ffmpeg` binary built with libx264,
which is **GPL-2.0+**. CamAI invokes it strictly as a separate subprocess
(`server/app/recorder.py`), which is the standard "mere aggregation"
pattern — it does not pull CamAI under the GPL. When redistributing,
either keep ffmpeg as a separately-installed prerequisite, or pass through
the GPL notice + source-availability statement for the ffmpeg binary only.

## 4. Supabase platform

The backend schema/functions run on the buyer's own Supabase project (or
self-hosted Supabase, Apache-2.0). No Supabase-proprietary code is vendored
into this repository.

## 5. Trademarks

"CamAI" naming and branding transfer with the sale. No third-party
trademarks are used in the product UI.
