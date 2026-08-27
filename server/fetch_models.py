"""Auto-downloader for CamAI YOLOX models on cloud instances."""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def main():
    print("Exporting models for CamAI Cloud Inference Engine...", flush=True)
    export_script = os.path.join(BASE_DIR, "export_models.py")
    if os.path.exists(export_script):
        os.system(f"{sys.executable} {export_script} yolox_tiny")
    print("Model fetch complete.", flush=True)

if __name__ == "__main__":
    main()
