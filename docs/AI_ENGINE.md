# AI Engine

Everything here lives under `server/app/ai/` and `server/app/analytics.py`, orchestrated per-camera by the pipeline described in [`ARCHITECTURE.md`](ARCHITECTURE.md). Detailed model accuracy metrics are documented in [`ACCURACY.md`](ACCURACY.md).

---

## 1. Hardware Backend Selection (`server/app/ai/backend.py`)

`EngineBackend` probes the machine at startup and picks the fastest available execution provider, in priority order:

1. **TensorRT** (NVIDIA, fused FP16 engine) — fastest available when present
2. **CUDA** (NVIDIA, plain execution provider)
3. **DirectML** (Windows DirectX 12 GPU acceleration — works on any DX12 GPU, not just NVIDIA)
4. **OpenVINO GPU** (Intel iGPU/dGPU)
5. **CPU** (ONNX Runtime CPU execution provider — universal fallback)

OpenVINO GPU targets require a static input shape (recompiling per input size is expensive on Intel iGPUs), so the engine pins a fixed shape on that backend and disables adaptive resolution; the other backends keep adaptive resolution enabled.

---

## 2. Detection Models & Capability Matrix

| Capability | Model | License | Active / Roadmap | Loaded By |
|---|---|---|---|---|
| Primary object detection | YOLOX (tiny / s / m tiers) | Apache-2.0 (Megvii) | **Active Production** | `server/app/ai/backend.py` |
| Rider helmet / no-helmet | RT-DETR (R18 / R50) | Apache-2.0 | **Active Production** | `server/app/ai/helmet.py`, `helmet_worker.py` |
| Face detection (detection only) | YuNet | MIT | **Active Production** | `server/app/ai/face.py` |
| Number-plate localization | LPD-YuNet | Apache-2.0 | **Active Production** | `server/app/ai/plate.py` |
| Number-plate OCR | CRNN (EN) | Apache-2.0 | **Active Production** | `server/app/ai/plate_ocr.py` |
| Low-Light Enhancer | Zero-DCE Contrast Boost | MIT | **Active Production** | `server/app/ai/enhancer.py` |
| Face Recognition (Identity) | SFace Embedding | Apache-2.0 | *Roadmap / Unshipped* | Explicitly locked in UI |
| PPE Vest / Gloves / Shoes | Heuristic / HSV Toggles | Proprietary | *Roadmap / Unshipped* | Explicitly locked in UI |
| Fire & Smoke Detection | Color Heuristics | Proprietary | *Roadmap / Unshipped* | Explicitly locked in UI |

Full licensing history and model provenance is in [`LICENSING.md`](LICENSING.md). Accuracy evaluation results are documented in [`ACCURACY.md`](ACCURACY.md).

The UI's Fast / Balanced / Accurate options correspond to the YOLOX tiny / s / m tiers. Regenerate any tier with `python server/export_models.py [name]`, which fetches the upstream checkpoint and re-exports ONNX + OpenVINO IR. No model weights are tracked in git.

Helmet detection runs off the main inference thread (`helmet_worker.py`) as an async worker. Plate/ANPR OCR (`plate_worker.py`) is throttled per track rather than run every frame to prevent Kalman tracker step-time drift.

---

## 3. Tiling (`server/app/ai/tiling.py`, `tile_governor.py`, `tile_temporal.py`)

For cameras that need higher effective resolution than the detector's native input size, the engine can split a frame into tiles and run inference on each. The **Adaptive Tile Governor** derives its per-cycle time budget from the actual frame period rather than a fixed constant, scaling inference resolution (320–1280 px) and tile count to hold GPU utilization in a 70–90% band.

---

## 4. Multi-Object Tracking (`server/app/analytics.py`)

An original ByteTrack-style implementation (not the reference ByteTrack codebase):
- Hungarian assignment between detections and existing tracks
- Appearance re-identification signal so IDs survive brief occlusion
- Lost-track gallery so an object that briefly leaves frame can re-acquire its old ID
- Time-aware motion model advancing Kalman states by wall-clock $dt$

**Measured Tracking Performance (from [`ACCURACY.md`](ACCURACY.md)):**
- **IDF1:** **91.40%**
- **HOTA:** **91.74%**
- **MOTA:** **84.16%**
- **ID Switches:** **0**

On frames where the AI stage doesn't run inference, the tracker's `predict_only()` path is used instead of feeding it an empty detection list to eliminate overlay flicker.

---

## 5. Analytics & Zone Profiles (`server/app/analytics.py`)

`CameraAnalytics.update()` consumes tracked boxes and produces:
- Vehicle speed estimation (km/h), Kalman-smoothed, requiring two-line distance calibration (MAE: 1.4 km/h)
- Zone entry/exit, intrusion, restricted-area, and perimeter-crossing rules (F1: 100.0%)
- Directional line crossing with sub-frame interpolation
- Dwell time, loitering, crowd density
- Unattended / removed object detection
- Parking occupancy using Sobel gradient and median deviation scores (`_parking_visual_score`)

Detections that reach the client go through a single emission path, `resolve_emitted_detections()`, preventing duplicate bounding box overlays.

---

## 6. What is Deliberately Not Shipped

Face **recognition** (identity matching) is not implemented — `face.py` only detects. PPE detection beyond helmets, fire/smoke detection, and red-light/stop-line violations are not shipped; the product surfaces these as explicitly locked/roadmap capabilities rather than as toggles that silently emit nothing.
