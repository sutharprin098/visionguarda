# CamAI — Licensing & Third-Party Inventory

Everything a buyer's counsel needs to know about what is owned, what is
third-party, and what needs action before commercial redistribution.
Last audited: 2026-07-16.

**Summary: there is no remaining AGPL exposure.** The detector was migrated
from Ultralytics YOLO11-seg (AGPL-3.0) to YOLOX (Apache-2.0) on 2026-07-16.
Every runtime and development dependency is now MIT / BSD / Apache-2.0. The
product can be redistributed commercially, closed-source, without any
copyleft obligation and without a third-party model licence. See §2.

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

## 2. Detector model weights — resolved (was the project's one AGPL issue)

**Status: no action required. Closed 2026-07-16.**

The detector is **YOLOX**, published by Megvii under **Apache-2.0**
(https://github.com/Megvii-BaseDetection/YOLOX). Apache-2.0 permits
commercial, closed-source redistribution with attribution; there is no
copyleft trigger and no model licence to purchase.

Three tiers ship, backing the UI's Fast / Balanced / Accurate options:

| Base name | Upstream checkpoint | Params |
|---|---|---|
| `yolox_tiny` | `yolox_tiny.pth` (Apache-2.0) | 5.06 M |
| `yolox_s` | `yolox_s.pth` (Apache-2.0) | 8.97 M |
| `yolox_m` | `yolox_m.pth` (Apache-2.0) | 25.33 M |

Regenerate any of them with `python server/export_models.py [name]`, which
fetches the upstream checkpoint and re-exports the ONNX + OpenVINO IR.

**No weights are tracked in git** (`.gitignore` excludes `*.pt`, `*.pth`,
`*.onnx`, `*_openvino_model/`), so no revision of this repository has ever
contained an AGPL-licensed model file.

What changed, for the record:

- **Weights**: `yolo11{n,s,m}-seg` (Ultralytics, AGPL-3.0) → `yolox_{tiny,s,m}`
  (Megvii, Apache-2.0). The retired files are quarantined outside the build
  in `_agpl_quarantine/` (gitignored, ships nowhere) pending deletion.
- **Dependency**: the `ultralytics` package (AGPL-3.0) is gone from
  `dev-requirements.txt`, and its two consumers were removed — the
  `export_models.py` conversion path (rewritten against upstream YOLOX) and
  the last-resort `.pt` inference fallback in `backend.py`. Nothing in the
  repository imports `ultralytics` any more.
- **Packaging**: `server/build_engine.ps1` previously copied
  `yolo11n-seg.pt/.onnx/_openvino_model` into the shipped engine — this was
  the only path by which AGPL weights reached a customer. It now ships
  `yolox_tiny` only, and no `.pt` at all (the engine never loads PyTorch
  checkpoints).
- **Capability retained**: `EngineBackend` still understands the YOLO11
  output layout. That code is first-party and carries no licence
  obligation; a buyer who holds an Ultralytics Enterprise Licence can drop
  their own `yolo11*` export into the models directory and it will load.
  Nothing in the shipped product depends on this.

**Segmentation was dropped as part of the swap**, deliberately: YOLOX is a
detection-only model. Analytics never consumed detector masks
(`CameraAnalytics.update()` takes boxes, never masks) — masks were used only
to draw outlines in the client overlay, behind a toggle. So the change costs
one cosmetic overlay feature and no analytics capability. Detection quality
did not regress: on an Intel UHD 620 iGPU, `yolox_tiny` measured *faster*
than the `yolo11n-seg` it replaces (81.0 ms vs 87.9 ms per cycle at
imgsz=320) while returning more true detections on the same CCTV frame.

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
| YOLOX detector weights | Apache-2.0 | Megvii; see §2 |
| imageio-ffmpeg | BSD-2 | **but see below** |

### 3a. Development-only dependencies (not shipped)

`server/dev-requirements.txt` is needed to run tests and to regenerate model
weights. None of it is imported by `server/app/`, and none ships in the
installer:

| Component | License | Used by |
|---|---|---|
| pytest | MIT | test suite |
| PyTorch | BSD-3 | `export_models.py` (checkpoint → ONNX) |
| loguru, tabulate | MIT | transitive requirements of the upstream YOLOX export code |

`export_models.py` clones the upstream YOLOX repository (Apache-2.0) into
`server/.yolox_upstream/` on first run. It is a build-time tool; the clone is
gitignored and is not vendored into this repository or the installer.

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
