import time
import os
import psutil
import torch
import numpy as np
import cv2
import openvino as ov
import onnxruntime as ort

print("=================================================================")
print("          CAMAI LOCAL AI ENGINE - PERFORMANCE AUDIT              ")
print("=================================================================")

# Device Diagnostics
cuda_avail = torch.cuda.is_available()
gpu_name = torch.cuda.get_device_name(0) if cuda_avail else "N/A (Intel OpenVINO iGPU/dGPU active)"
cuda_ver = torch.version.cuda if cuda_avail else "N/A"
cudnn_ver = torch.backends.cudnn.version() if cuda_avail else "N/A"
ort_providers = ort.get_available_providers()
ov_core = ov.Core()
ov_devices = ov_core.available_devices

print(f"Current Device:          {'GPU (OpenVINO iGPU/dGPU)' if 'GPU' in ov_devices else 'CPU'}")
print(f"CUDA Available:          {cuda_avail}")
print(f"CUDA Version:            {cuda_ver}")
print(f"cuDNN Version:           {cudnn_ver}")
print(f"TensorRT Status:         {'TensorrtExecutionProvider' in ort_providers}")
print(f"ONNX Runtime Providers:  {ort_providers}")
print(f"PyTorch CUDA Status:     {cuda_avail}")
print(f"GPU Name:                {gpu_name}")
print(f"GPU Memory:              Shared System VRAM")
print(f"OpenVINO Devices:        {ov_devices}")
print("=================================================================\n")
