# Licensing & Third-Party Inventory

What is owned, what is third-party, and what a buyer's counsel needs to know before commercial redistribution.

**Summary: there is no AGPL exposure.** The detector was migrated from Ultralytics YOLO11-seg (AGPL-3.0) to YOLOX (Apache-2.0). Every runtime and development dependency is MIT / BSD / Apache-2.0 / public domain. The product can be redistributed commercially, closed-source, without any copyleft obligation and without a third-party model license.

## 1. What is owned outright

All first-party source code in this repository is original work:

- `server/app/` — FastAPI AI engine: the slot-based pipeline, a ByteTrack-style tracker with appearance ReID (original implementation, not the reference ByteTrack codebase), analytics (zones, lines, dwell, speed, crowd, abandoned-object, parking occupancy), recorder, storage.
- `desktop/` — Electron Windows app: live multi-camera viewer (MJPEG + WebSocket telemetry overlay), licensing vault, cloud sync.
- `portal/` — React SaaS admin portal.
- `supabase/` — Postgres schema, RLS policies, edge functions.

The parking-occupancy visual score (`server/app/analytics.py::_parking_visual_score`) is an original implementation using standard OpenCV/NumPy statistics (Sobel gradient fraction, interquartile spread, median deviation).

## 2. Detector model weights

**Status: resolved, no action required.** The detector is **YOLOX**, published by Megvii under **Apache-2.0** (github.com/Megvii-BaseDetection/YOLOX), which permits commercial closed-source redistribution with attribution and has no copyleft trigger.

Three tiers ship, backing the UI's Fast / Balanced / Accurate options:

| Base name | Upstream checkpoint | Params |
|---|---|---|
| `yolox_tiny` | `yolox_tiny.pth` (Apache-2.0) | 5.06 M |
| `yolox_s` | `yolox_s.pth` (Apache-2.0) | 8.97 M |
| `yolox_m` | `yolox_m.pth` (Apache-2.0) | 25.33 M |

Regenerate any tier with `python server/export_models.py [name]`, which fetches the upstream checkpoint and re-exports ONNX + OpenVINO IR. **No weights are tracked in git** (`.gitignore` excludes `*.pt`, `*.pth`, `*.onnx`, `*_openvino_model/`), so no revision of this repository has ever contained an AGPL-licensed model file.

What changed, for the record: `yolo11{n,s,m}-seg` (Ultralytics, AGPL-3.0) → `yolox_{tiny,s,m}` (Megvii, Apache-2.0); the `ultralytics` package is gone from `dev-requirements.txt` and nothing in the repository imports it; the packaging script (`server/build_engine.ps1`) now ships `yolox_tiny` only and no `.pt` files at all. Segmentation was dropped as part of the swap — YOLOX is detection-only, and analytics never consumed detector masks (only a cosmetic overlay outline did, behind a toggle), so this cost no analytics capability. On an Intel UHD 620 iGPU, `yolox_tiny` measured faster than the `yolo11n-seg` it replaced (81.0ms vs 87.9ms per cycle at imgsz=320) while returning more true detections on the same CCTV frame.

## 2a. Secondary detector weights — also permissive

Four further model files ship in the engine, each loaded lazily only when a camera's zone profile asks for that capability:

| Capability | Model | License | Upstream | Loaded by |
|---|---|---|---|---|
| Helmet / no-helmet on riders | RT-DETR (R18/R50) | Apache-2.0 | github.com/lyuwenyu/RT-DETR | `server/app/ai/helmet.py` |
| Face detection | YuNet | MIT | OpenCV Zoo | `server/app/ai/face.py` |
| Number-plate localization | LPD-YuNet | Apache-2.0 | OpenCV Zoo | `server/app/ai/plate.py` |
| Number-plate OCR | CRNN (EN) | Apache-2.0 | OpenCV Zoo | `server/app/ai/plate_ocr.py` |

None carries a copyleft obligation. Helmet detection was migrated off Ultralytics YOLOv8 (AGPL-3.0) for the same reason as the primary detector, onto RT-DETR, keeping the public API and emitted detection shape identical. **Face recognition is not implemented** — `face.py` performs detection only; there is no embedding or identity-matching path shipped.

## 3. Runtime dependencies (all permissive)

| Component | License |
|---|---|
| FastAPI, Pillow | MIT-style |
| Uvicorn, NumPy, SciPy | BSD-3 |
| OpenCV (opencv-python-headless) | Apache-2.0 |
| OpenVINO | Apache-2.0 |
| ONNX Runtime | MIT |
| python-multipart | Apache-2.0 |
| React, Vite, Tailwind, Electron, Supabase JS, TanStack Query | MIT |
| YOLOX detector weights | Apache-2.0 (Megvii) |
| RT-DETR helmet weights | Apache-2.0 (lyuwenyu/RT-DETR) |
| YuNet face-detection weights | MIT (OpenCV Zoo) |
| LPD-YuNet plate-detection weights | Apache-2.0 (OpenCV Zoo) |
| CRNN plate-OCR weights | Apache-2.0 (OpenCV Zoo) |
| imageio-ffmpeg | BSD-2 — bundles a static `ffmpeg` built with libx264 (GPL-2.0+); see below |
| yt-dlp | Unlicense (public domain) |

### 3a. Development-only dependencies (not shipped)

`server/dev-requirements.txt` is needed to run tests and regenerate model weights; none of it is imported by `server/app/` and none ships in the installer:

| Component | License | Used by |
|---|---|---|
| pytest | MIT | test suite |
| PyTorch | BSD-3 | `export_models.py` (checkpoint → ONNX) |
| loguru, tabulate | MIT | transitive requirements of the upstream YOLOX export code |

**yt-dlp** is public domain, so it imposes no attribution or source-availability obligation. It's imported only by `server/app/ai/stream_resolver.py`, and only for camera sources whose host is a watch page (YouTube, Twitch). Whether a given stream may be ingested/recorded is governed by that platform's terms of service and local law — a decision for the operator, not something this codebase can grant.

**imageio-ffmpeg** bundles a static `ffmpeg` binary built with libx264 (GPL-2.0+). CamAI invokes it strictly as a separate subprocess (`server/app/recorder.py`) — the standard "mere aggregation" pattern, which does not pull CamAI under the GPL. When redistributing, either keep ffmpeg as a separately-installed prerequisite, or pass through the GPL notice + source-availability statement for the ffmpeg binary only.

## 4. Supabase platform

The backend schema/functions run on the buyer's own Supabase project (or self-hosted Supabase, Apache-2.0). No Supabase-proprietary code is vendored into this repository.

## 5. Trademarks

"CamAI" naming and branding transfer with a sale of the business. No third-party trademarks are used in the product UI.

## 6. Regenerating this inventory

Re-verify before any redistribution event by checking: `.gitignore` still excludes model weight file types, `server/dev-requirements.txt` / `server-requirements.txt` for any newly-added copyleft dependency, and `desktop/package.json` / `portal/package.json` for the same in the JS trees.
