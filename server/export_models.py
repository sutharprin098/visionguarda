import os
import sys
import time
from ultralytics import YOLO

def export_model(model_path):
    print(f"==================================================", flush=True)
    print(f"Exporting {model_path}...", flush=True)
    if not os.path.exists(model_path):
        print(f"Error: {model_path} not found. Skipping.", flush=True)
        return
        
    t0 = time.time()
    try:
        model = YOLO(model_path)
        print(f"Loaded {model_path} in {time.time() - t0:.2f}s", flush=True)
        
        # Export to ONNX
        print(f"Starting ONNX export for {model_path}...", flush=True)
        t_onnx = time.time()
        model.export(format="onnx", imgsz=320, dynamic=True, simplify=True)
        print(f"ONNX export succeeded in {time.time() - t_onnx:.2f}s", flush=True)
        
        print(f"Starting OpenVINO export for {model_path}...", flush=True)
        t_ov = time.time()
        model.export(format="openvino", imgsz=320, dynamic=True, simplify=True)
        print(f"OpenVINO export succeeded in {time.time() - t_ov:.2f}s", flush=True)
        
    except Exception as e:
        print(f"Failed to export {model_path}: {e}", flush=True)
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    models = ["yolo11n-seg.pt", "yolo11s-seg.pt", "yolo11m-seg.pt"]
    for m in models:
        export_model(m)
    print("All exports processed.")
