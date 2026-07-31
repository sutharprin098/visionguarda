# AI Engine

Everything here lives under `server/app/ai/` and `server/app/analytics.py`, orchestrated per-camera by the pipeline described in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Hardware backend selection (`server/app/ai/backend.py`)

`EngineBackend` probes the machine at startup and picks the fastest available execution provider, in priority order:

1. **TensorRT** (NVIDIA, fused FP16 engine) — fastest available when present
2. **CUDA** (NVIDIA, plain execution provider)
3. **DirectML** (Windows DirectX 12 GPU acceleration — works on any DX12 GPU, not just NVIDIA)
4. **OpenVINO GPU** (Intel iGPU/dGPU)
5. **CPU** (ONNX Runtime CPU execution provider — universal fallback)

OpenVINO GPU targets require a static input shape (recompiling per input size is expensive on Intel iGPUs), so the engine pins a fixed shape on that backend and disables adaptive resolution; the other backends keep adaptive resolution enabled. This device-gating exists because early builds crash-looped on Intel UHD 620 iGPUs from per-shape recompiles — see the tiling section below.

## Detection models

| Capability | Model | License | Loaded by |
|---|---|---|---|
| Primary object detection | YOLOX (tiny / s / m tiers) | Apache-2.0 (Megvii) | `server/app/ai/backend.py` |
| Rider helmet / no-helmet | RT-DETR (R18/R50) | Apache-2.0 | `server/app/ai/helmet.py`, `helmet_worker.py` |
| Face detection (detection only — no recognition) | YuNet | MIT | `server/app/ai/face.py` |
| Number-plate localization | LPD-YuNet | Apache-2.0 | `server/app/ai/plate.py` |
| Number-plate OCR | CRNN (EN) | Apache-2.0 | `server/app/ai/plate_ocr.py` |

Full licensing detail and history (including the migration off AGPL-licensed weights) is in [`LICENSING.md`](LICENSING.md).

The UI's Fast / Balanced / Accurate options correspond to the YOLOX tiny / s / m tiers. Regenerate any tier with `python server/export_models.py [name]`, which fetches the upstream checkpoint and re-exports ONNX + OpenVINO IR. No model weights are tracked in git.

Helmet detection runs off the main inference thread (`helmet_worker.py`) as an async worker — it was moved there because running it inline stretched the tracking-stage cycle time to as much as 850 ms, which made the Kalman tracker (which assumed a roughly fixed step interval) drift and thrash track IDs. Plate/ANPR OCR (`plate_worker.py`) is throttled per track rather than run every frame — at full rate it measured ~1.4s per call, which is far too slow to run per-frame at camera FPS.

## Tiling (`server/app/ai/tiling.py`, `tile_governor.py`, `tile_temporal.py`)

For cameras that need higher effective resolution than the detector's native input size, the engine can split a frame into tiles and run inference on each. The **Adaptive Tile Governor** derives its per-cycle time budget from the actual frame period rather than a fixed constant — an earlier fixed 180ms budget was unrelated to the camera's real frame period and collapsed throughput to 1–2 FPS on some hardware for close to zero recall benefit from the extra tiles. The governor now scales inference resolution (320–1280 px) and tile count to hold GPU utilization in a 70–90% band.

## Tracking (`server/app/analytics.py` and the pipeline's Module 4)

An original ByteTrack-style implementation (not the reference ByteTrack codebase): Hungarian assignment between detections and existing tracks, an appearance re-identification signal so IDs survive brief occlusion, and a lost-track gallery so an object that briefly leaves frame can re-acquire its old ID instead of minting a new one. The tracker is time-aware — it advances its Kalman motion model by wall-clock `dt`, not by a fixed per-iteration step, since the pipeline's actual cycle time varies with backend, tile count, and whichever async workers (helmet/plate) are active that frame.

On frames where the AI stage doesn't run inference, the tracker's `predict_only()` path is used instead of feeding it an empty detection list — the two are not equivalent: an empty-detections update can zero out tracks that are simply between inference frames, showing up as overlay flicker.

## Analytics (`server/app/analytics.py`)

`CameraAnalytics.update()` consumes tracked boxes (never segmentation masks — the detector is detection-only) and produces:

- Vehicle speed estimation (km/h), Kalman-smoothed, requiring two-line distance calibration per camera
- Zone entry/exit, intrusion, restricted-area and perimeter-crossing rules
- Directional line crossing with sub-frame interpolation
- Dwell time, loitering, crowd density
- Unattended / removed object detection
- Parking occupancy, using an original visual-score implementation (`_parking_visual_score`) built on standard OpenCV/NumPy statistics — Sobel gradient fraction, interquartile spread, median deviation

Detections that reach the client go through a single emission path, `resolve_emitted_detections()` — this is deliberate: earlier bugs produced two overlay boxes for one physical object because a second code path could independently emit a box for the same detection. There is intentionally no second renderer.

## Zone profiles

A camera's active AI capabilities (which detectors run, which analytics rules apply) are controlled by a `zone_profile` that narrows the active detection classes (`PROFILE_CLASSES`). Zone-profile configuration lives in the portal's Admin Studio and is applied to the engine via the realtime sync path described in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What is deliberately not shipped

Face **recognition** (identity matching) is not implemented — `face.py` only detects. PPE detection beyond helmets, fire/smoke detection, and red-light/stop-line violations are not shipped; the product surfaces these as explicitly locked/roadmap capabilities rather than as toggles that silently emit nothing.
