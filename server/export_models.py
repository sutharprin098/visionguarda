"""Regenerate CamAI's detector weights from upstream YOLOX.

Offline/dev tool — nothing in the shipped engine imports this. It fetches the
official Apache-2.0 YOLOX checkpoints, exports them to ONNX, and converts them
to OpenVINO IR, producing the layout app/ai/backend.py resolves:

    <base>.onnx
    <base>_openvino_model/<base>.xml + .bin

Two export choices matter and are deliberate:

1. `decode_in_inference = False` — the YOLOX head's grid/stride decode is left
   out of the graph and done in numpy by backend.py's postprocess instead.
   Baking the decode in would freeze the grid at one input size; leaving it out
   is what keeps the input dimension dynamic, which the pipeline's adaptive
   imgsz (320..1280) depends on.
2. Dynamic height/width axes — one exported file serves every imgsz the
   pipeline steps through.

Usage:
    python export_models.py                # all three shipped tiers
    python export_models.py yolox_s        # just one

Requires (dev-requirements.txt): torch, plus a checkout of the YOLOX repo,
which this script clones into ./.yolox_upstream on first run.
"""
import os
import subprocess
import sys
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPSTREAM_DIR = os.path.join(BASE_DIR, ".yolox_upstream")
UPSTREAM_REPO = "https://github.com/Megvii-BaseDetection/YOLOX.git"
RELEASE_URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0"

# base_name -> upstream exp name. These three back the Fast / Balanced /
# Accurate tiers the UI offers (client SettingsPanel PERFORMANCE_TIERS).
TIERS = {
    "yolox_tiny": "yolox-tiny",
    "yolox_s": "yolox-s",
    "yolox_m": "yolox-m",
}


def ensure_upstream():
    if not os.path.isdir(UPSTREAM_DIR):
        print(f"Cloning YOLOX (Apache-2.0) into {UPSTREAM_DIR} ...", flush=True)
        subprocess.check_call(
            ["git", "clone", "--depth", "1", UPSTREAM_REPO, UPSTREAM_DIR]
        )
    sys.path.insert(0, UPSTREAM_DIR)


def ensure_checkpoint(base_name):
    pth = os.path.join(BASE_DIR, f"{base_name}.pth")
    if not os.path.exists(pth):
        url = f"{RELEASE_URL}/{base_name}.pth"
        print(f"Downloading {url} ...", flush=True)
        urllib.request.urlretrieve(url, pth)
    return pth


def export(base_name, exp_name):
    import torch
    import openvino as ov
    from yolox.exp import get_exp

    print("=" * 60, flush=True)
    print(f"Exporting {base_name} ({exp_name})", flush=True)

    pth = ensure_checkpoint(base_name)
    exp = get_exp(exp_file=None, exp_name=exp_name)
    model = exp.get_model()
    ckpt = torch.load(pth, map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model"] if "model" in ckpt else ckpt)
    model.eval()
    model.head.decode_in_inference = False

    onnx_path = os.path.join(BASE_DIR, f"{base_name}.onnx")
    torch.onnx.export(
        model,
        torch.randn(1, 3, 640, 640),
        onnx_path,
        input_names=["images"],
        output_names=["output"],
        dynamic_axes={
            "images": {0: "batch", 2: "height", 3: "width"},
            "output": {0: "batch", 1: "anchors"},
        },
        opset_version=11,
        do_constant_folding=True,
        dynamo=False,
    )
    print(f"  ONNX  -> {onnx_path}", flush=True)

    ov_dir = os.path.join(BASE_DIR, f"{base_name}_openvino_model")
    ov.save_model(
        ov.convert_model(onnx_path),
        os.path.join(ov_dir, f"{base_name}.xml"),
        compress_to_fp16=True,
    )
    print(f"  OpenVINO -> {ov_dir}", flush=True)


if __name__ == "__main__":
    requested = sys.argv[1:] or list(TIERS)
    unknown = [m for m in requested if m not in TIERS]
    if unknown:
        raise SystemExit(f"Unknown model(s): {unknown}. Known: {list(TIERS)}")

    ensure_upstream()
    for base_name in requested:
        try:
            export(base_name, TIERS[base_name])
        except Exception as e:
            print(f"Failed to export {base_name}: {e}", flush=True)
            import traceback
            traceback.print_exc()
    print("All exports processed.")
