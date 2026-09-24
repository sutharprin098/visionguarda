# ACAP Model Files

## Why this directory is (mostly) empty in source control

The Larod inference engine on Axis hardware requires models in `.tflite` format.
The ONNX models used by the server (`server/models/`) are **not** directly
loadable by Larod on ARTPEC-7/8.

## How to generate the ACAP model from the server ONNX

### Prerequisites

1. Docker installed
2. ACAP Native SDK image: `axisecp/acap-native-sdk:latest`

### Conversion steps (inside SDK container)

```bash
docker run --rm \
    -v "$(pwd)/ACAP/models":/workspace/models \
    -v "$(pwd)/server/models":/workspace/server_models \
    axisecp/acap-native-sdk \
    bash /workspace/models/convert_model.sh
```

This produces:
- `models/yolox_tiny.tflite` — ARTPEC-7 CPU (cpu-tflite backend)
- `models/yolox_tiny_dlpu.tflite` — ARTPEC-8 DLPU (axis-a8-dlpu-tflite)

### Manual conversion

```bash
# Inside the SDK container:
larod-convert \
    --model /workspace/server_models/yolox_tiny.onnx \
    --format tflite \
    --output /workspace/models/yolox_tiny.tflite

# For ARTPEC-8 DLPU (INT8 quantised):
larod-convert \
    --model /workspace/server_models/yolox_tiny.onnx \
    --format dlpu-tflite \
    --output /workspace/models/yolox_tiny_dlpu.tflite \
    --calibration_dataset /workspace/calib_frames/
```

## Model selection at runtime

The `LarodChip` axparameter controls which Larod backend is used.
The `ModelPath` axparameter controls the model file path.

| Camera chip | Recommended backend | Model file |
|---|---|---|
| ARTPEC-6 (armv7hf) | `cpu-tflite` | `yolox_tiny.tflite` |
| ARTPEC-7 (aarch64) | `cpu-tflite` or `axis-a7-dlpu-tflite` | `yolox_tiny.tflite` |
| ARTPEC-8 (aarch64) | `axis-a8-dlpu-tflite` | `yolox_tiny_dlpu.tflite` |

Set from the camera's web UI → Apps → CamAI Edge → Settings,
or via SSH:

```bash
# On camera via SSH:
axparameter set camai_acap LarodChip axis-a8-dlpu-tflite
axparameter set camai_acap ModelPath models/yolox_tiny_dlpu.tflite
```

## YOLOX output tensor shape

The YOLOX-tiny model at 416×416 input produces:
- Input:  `[1, 3, 416, 416]` float32 (CHW, range 0-255, BGR)
- Output: `[1, 3549, 85]` float32 (batch=1, 3549 anchors, 5+80 classes)

The `decode_yolox_tensor()` function in `app/inference.cpp` matches this contract.
If you use a different resolution (e.g. 640×640), update:
- `CAMAI_INPUT_W` and `CAMAI_INPUT_H` compile flags in Makefile
- The model exported with the matching input shape
