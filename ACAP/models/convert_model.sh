#!/usr/bin/env bash
# convert_model.sh — Convert server ONNX model to Larod-compatible .tflite
# Run inside the ACAP Native SDK Docker container:
#   docker run --rm \
#       -v "$(git rev-parse --show-toplevel)":/workspace \
#       axisecp/acap-native-sdk \
#       bash /workspace/ACAP/models/convert_model.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_MODELS_DIR="${SCRIPT_DIR}/../../server/models"
OUT_DIR="${SCRIPT_DIR}"

ONNX_MODEL="${SERVER_MODELS_DIR}/yolox_tiny.onnx"

if [ ! -f "${ONNX_MODEL}" ]; then
    echo "[convert_model] ERROR: Source model not found: ${ONNX_MODEL}"
    exit 1
fi

echo "[convert_model] Source model: ${ONNX_MODEL}"

# ── CPU TFLite (ARTPEC-6/7, always available, no DLPU) ──────────────────────
echo "[convert_model] Converting to cpu-tflite..."
larod-convert \
    --model "${ONNX_MODEL}" \
    --format tflite \
    --output "${OUT_DIR}/yolox_tiny.tflite"
echo "[convert_model] OK: ${OUT_DIR}/yolox_tiny.tflite"

# ── ARTPEC-8 DLPU TFLite (INT8; requires calibration dataset) ───────────────
# Calibration frames are optional but strongly recommended for INT8 accuracy.
# Without them, default per-tensor min/max quantisation is used.
CALIB_DIR="${SCRIPT_DIR}/calib_frames"
DLPU_OUT="${OUT_DIR}/yolox_tiny_dlpu.tflite"

echo "[convert_model] Converting to axis-a8-dlpu-tflite..."
if [ -d "${CALIB_DIR}" ]; then
    CALIB_ARGS="--calibration_dataset ${CALIB_DIR}"
    echo "[convert_model] Using calibration frames from ${CALIB_DIR}"
else
    CALIB_ARGS=""
    echo "[convert_model] WARNING: No calib_frames/ directory found. Using default quantisation."
    echo "                For best accuracy, add representative camera frames to:"
    echo "                ACAP/models/calib_frames/ (JPEG or PNG, same aspect ratio as camera)"
fi

larod-convert \
    --model "${ONNX_MODEL}" \
    --format dlpu-tflite \
    --output "${DLPU_OUT}" \
    ${CALIB_ARGS} || {
    echo "[convert_model] WARNING: DLPU conversion failed (ARTPEC-8 SDK tools may not be present)."
    echo "                The cpu-tflite model will still work."
}

if [ -f "${DLPU_OUT}" ]; then
    echo "[convert_model] OK: ${DLPU_OUT}"
fi

echo ""
echo "[convert_model] Conversion complete."
echo "  CPU model:  ACAP/models/yolox_tiny.tflite   → use LarodChip=cpu-tflite"
echo "  DLPU model: ACAP/models/yolox_tiny_dlpu.tflite → use LarodChip=axis-a8-dlpu-tflite"
echo ""
echo "Set via axparameter on the camera:"
echo "  axparameter set camai_acap ModelPath models/yolox_tiny.tflite"
echo "  axparameter set camai_acap LarodChip cpu-tflite"
