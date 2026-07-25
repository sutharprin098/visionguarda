# CamAI Engine — Hardware Tiers & Performance Tuning

The AI engine auto-detects the machine it runs on and configures itself. This
document explains what each hardware tier can actually deliver and how to unlock
the high-performance (NVIDIA) path.

## TL;DR — what to expect per hardware tier

| Tier | Example | Inference / frame | Realistic FPS (1 cam) | Notes |
|------|---------|-------------------|------------------------|-------|
| **NVIDIA GPU + TensorRT** | RTX 3050+/T4/A2 | **3–8 ms (FP16)** | **25–60** | Full path: tiling, adaptive res, FP16. This is the tier the "<10 ms / 70–95 % GPU" targets need. |
| **NVIDIA GPU + CUDA** | any CUDA GPU | 6–12 ms | 20–45 | No TensorRT engine build; still real GPU accel. |
| **Intel iGPU (OpenVINO)** | UHD 620 / Iris Xe | 15 ms @320, ~40 ms @416 | 12–20 | iGPU ≈ CPU speed; its value is **offloading the CPU**. Static-shape pinned, tiling single-pass. |
| **CPU only** | any x86-64 | 40–60 ms | 5–12 | Fallback. Works, but this is the floor. |

> **Important:** an Intel *integrated* GPU (UHD/Iris) is **not** a throughput
> accelerator — it runs this model at roughly the same speed as the CPU. Pinning
> inference to it still helps, because it frees the CPU cores for capture,
> tracking, the secondary detectors and MJPEG encoding. Do **not** expect
> `<10 ms` inference or `25–60 FPS` from an iGPU laptop; that requires an NVIDIA
> GPU (see below).

## How auto-detection works

At model load the engine scores every available backend and picks the strongest:

```
TensorRT (100) > CUDA (90) > Intel GPU / OpenVINO (80) > DirectML (75) > CPU (10–15)
```

- **Intel GPU path** (`OpenVINO`): the model is reshaped to **one static input
  shape** `[1,3,S,S]` (default `S=416`, env `CAMAI_IGPU_STATIC_IMGSZ`). This is
  deliberate: the Intel GPU driver recompiles kernels *per input shape*, each
  compile costing 9–16 s. A single static shape compiles once, is disk-cached,
  and never recompiles at runtime — which is what stops the multi-resolution /
  adaptive-size **crash loop** on iGPU hardware. On this tier the multi-pass
  tiling ("Invisible Zoom") is reduced to a single full-frame pass.
- **NVIDIA / CPU paths**: keep **dynamic** input shapes, so adaptive resolution
  and the full multi-resolution tiling engine stay enabled.

The detected profile is logged at startup, e.g.:
```
[CameraManager] Hardware profile: Intel GPU (static imgsz=416). Tiling
multi-resolution disabled; single-pass detection for stable 24/7 runtime.
```

## Unlocking the NVIDIA (TensorRT / CUDA) path

The engine already contains the TensorRT + CUDA execution-provider logic. It
only needs the GPU build of ONNX Runtime and (optionally) an FP16 model export.

1. **Use a machine with an NVIDIA GPU** and current drivers + CUDA runtime.
2. **Install the GPU build of ONNX Runtime** in the engine's environment
   (replace the CPU-only `onnxruntime`):
   ```
   pip uninstall onnxruntime
   pip install onnxruntime-gpu        # brings CUDA EP; TensorRT EP if TRT present
   ```
   Verify: `python -c "import onnxruntime as ort; print(ort.get_available_providers())"`
   should list `TensorrtExecutionProvider` and/or `CUDAExecutionProvider`.
3. **(Recommended) export an FP16 model** so the CUDA EP runs in half precision.
   The engine automatically prefers a `<model>_fp16.onnx` sibling when the CUDA
   EP is active:
   ```
   yolo export model=yolo11s.pt format=onnx half=True   # -> yolo11s_fp16.onnx
   ```
   TensorRT enables FP16 itself (`trt_fp16_enable`) and caches its built engine
   under `trt_cache/` next to the model — the first run builds it (slow), every
   run after is fast.
4. **Nothing else changes.** On a CUDA/TensorRT device `static_imgsz` stays
   `None`, so adaptive resolution + full tiling turn back on automatically and
   the `<10 ms / 25–60 FPS / 70–95 % GPU` targets become reachable.

## Environment knobs (all optional)

| Env var | Default | Effect |
|---------|---------|--------|
| `CAMAI_IGPU_STATIC_IMGSZ` | `416` | iGPU static input side (mult. of 32). `320` = fastest (~15 ms, less small-object recall); `512`/`640` = more recall, slower. |
| `CAMAI_FORCE_CPU` | off | Force CPU inference (diagnostics / broken GPU driver). |
| `CAMAI_TILING_ENABLED` | on (off on iGPU) | Multi-pass zoom tiling. |
| `CAMAI_TILING_MULTI_RESOLUTION` | on (off on iGPU) | Per-tile resolution ladder. |
| `CAMAI_HELMET_ENABLED` / `CAMAI_ANPR_ENABLED` | on | Traffic-mode secondary networks (run only when the camera's mode enables them). |

## Why CPU was pinned at ~94 % on the iGPU laptop (fixed)

Three compounding causes, all addressed:

1. **Per-shape GPU recompiles** (adaptive size + multi-resolution tiling) → 9–16 s
   stalls tripped the 20 s watchdog → restart → recompile → crash loop. Fixed by
   the static-shape pin + single-pass tiling on iGPU.
2. **A duplicated `_detect_motion()` call** diffed each frame against itself and
   returned "no motion" almost always, so detection only fired on the 1 s
   force-timer (objects appeared ~1 s late). Fixed (single call).
3. **Multi-pass tiling + 3 CPU-only secondary networks** ran on 4 weak ULV cores.
   On iGPU, tiling is now single-pass and the secondaries stay gated per camera
   mode.
