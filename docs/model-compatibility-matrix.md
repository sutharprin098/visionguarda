# CamAI ACAP Model Compatibility Matrix

This matrix documents the AI models evaluated for edge deployment on AXIS ACAP devices.

| Model | Current Format | Target Format | Input | Output | Estimated RAM | Estimated Compute | License | ACAP Status |
|---|---|---|---|---|---|---|---|---|
| **YOLOX-Tiny** | ONNX (`yolox_tiny.onnx`) | ONNX / Larod Model | 416x416x3 RGB | `[1, 3549, 85]` BBoxes + Scores | ~120 MB | ~6.4 GFLOPs (ARTPEC-8 DLPU) | Apache-2.0 | **Supported (Production Target)** |
| **YOLOX-S** | ONNX (`yolox_s.onnx`) | ONNX / Larod Model | 640x640x3 RGB | `[1, 8400, 85]` BBoxes + Scores | ~350 MB | ~26.8 GFLOPs (ARTPEC-8 DLPU) | Apache-2.0 | **Supported (High-Memory ARTPEC-8 Devices)** |
| **YOLOX-M** | ONNX (`yolox_m.onnx`) | ONNX / Larod Model | 640x640x3 RGB | `[1, 8400, 85]` BBoxes + Scores | ~850 MB | ~73.8 GFLOPs | Apache-2.0 | **Unsupported (Exceeds Embedded Thermal/RAM Limits)** |
| **RT-DETR Helmet** | ONNX (`helmet.onnx`) | ONNX / Larod Model | 640x640x3 RGB | `[1, 300, 6]` BBoxes + Scores | ~220 MB | ~31.0 GFLOPs | Apache-2.0 | **Supported (Secondary Module)** |
| **LPD-YuNet Plate** | ONNX (`plate_detector.onnx`)| ONNX / Larod Model | 320x240x3 RGB | `[1, N, 14]` Plates + Landmarks | ~45 MB | ~1.2 GFLOPs | Apache-2.0 | **Supported (Lightweight ANPR Module)** |
| **CRNN OCR** | ONNX (`plate_ocr.onnx`) | ONNX / Larod Model | 100x32x1 Gray | `[1, 25, 37]` Char Probs | ~60 MB | ~1.8 GFLOPs | Apache-2.0 | **Supported (ANPR Text Recognition)** |
| **Zero-DCE Enhancer** | PyTorch / ONNX | N/A | Variable RGB | Enhanced RGB Image | ~400 MB | ~45.0 GFLOPs | MIT | **Incompatible (AXIS Lightfinder ISP handles hardware enhancement)** |

---

## Technical Notes

1. **Quantization Requirements:** Models targeting ARTPEC-7/8 DLPU run best in INT8 or FP16 tensor representations. Quantization calibration datasets are maintained in `models/calibration`.
2. **Post-Processing (NMS):** Post-processing is executed natively on the camera CPU using vectorized C++ code to offload the NPU/DLPU accelerator.
