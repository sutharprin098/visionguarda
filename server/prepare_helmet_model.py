"""Install + validate an RT-DETR helmet model for CamAI. Offline dev/ops tool —
nothing in the shipped engine imports it.

It takes an RT-DETR ONNX you already have (official Apache-2.0 export from
github.com/lyuwenyu/RT-DETR, RT-DETR-R18 or R50), copies it to the directory the
engine searches, writes the classes.txt the detector loads, and — the important
part — LOADS it through ONNX Runtime and runs one dry inference to confirm the
I/O contract app/ai/helmet.py expects. No torch/ultralytics required.

Usage
-----
    python prepare_helmet_model.py --onnx path/to/rtdetr_helmet.onnx
    python prepare_helmet_model.py --onnx rtdetr.onnx --classes helmet,no_helmet
    python prepare_helmet_model.py --onnx rtdetr.onnx --dest D:/models/helmet

Producing the ONNX (done once, in a throwaway env with the RT-DETR repo):
    python tools/export_onnx.py -c configs/rtdetr/rtdetr_r18vd_6x_coco.yml \
        -r rtdetr_helmet.pth --check
That export is Apache-2.0 and yields inputs [images, orig_target_sizes] and
outputs [labels, boxes, scores] — exactly what helmet.py auto-detects.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time

import numpy as np

# Import the engine's resolved paths so this tool writes exactly where the
# engine looks, instead of guessing a directory.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import config  # noqa: E402


def write_classes(dest_dir: str, classes: list[str]) -> str:
    path = os.path.join(dest_dir, config.HELMET_CLASSES_FILE)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(classes) + "\n")
    print(f"  classes.txt -> {path}\n            {classes}")
    return path


def validate(onnx_path: str) -> bool:
    """Load the model and run one dry inference; print the detected contract."""
    try:
        import onnxruntime as ort
    except Exception as e:
        print(f"  [FAIL] onnxruntime not importable: {e}")
        return False

    avail = ort.get_available_providers()
    pref = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    providers = [p for p in pref if p in avail] or ["CPUExecutionProvider"]
    print(f"  available providers: {avail}")
    print(f"  using: {providers[0]}")

    t0 = time.time()
    sess = ort.InferenceSession(onnx_path, providers=providers)
    print(f"  loaded in {(time.time() - t0) * 1000:.0f} ms")

    ins = sess.get_inputs()
    outs = sess.get_outputs()
    print("  inputs:")
    for i in ins:
        print(f"    {i.name:20s} {i.type:16s} {i.shape}")
    print("  outputs:")
    for o in outs:
        print(f"    {o.name:20s} {o.type:16s} {o.shape}")

    S = config.HELMET_INPUT_SIZE
    feed = {ins[0].name: np.zeros((1, 3, S, S), np.float32)}
    if len(ins) > 1:
        sizes_dtype = np.int32 if "int32" in ins[1].type else np.int64
        feed[ins[1].name] = np.array([[S, S]], dtype=sizes_dtype)
        contract = "triple (official RT-DETR: labels/boxes/scores)"
    else:
        contract = "single fused output"
    try:
        t0 = time.time()
        res = sess.run(None, feed)
        dt = (time.time() - t0) * 1000
    except Exception as e:
        print(f"  [FAIL] dry inference raised: {e}")
        return False
    print(f"  dry inference OK in {dt:.0f} ms | contract detected: {contract}")
    print(f"  output shapes: {[np.asarray(r).shape for r in res]}")
    if len(ins) > 1 and len(outs) < 3:
        print("  [WARN] two inputs but <3 outputs — helmet.py expects "
              "labels/boxes/scores for the triple contract. Check the export.")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True, help="path to an RT-DETR helmet ONNX")
    ap.add_argument("--classes", default="helmet,no_helmet",
                    help="comma-separated class names in model-index order, or a path to a classes file")
    ap.add_argument("--dest", default=str(config.HELMET_MODEL_DIR),
                    help="where to install (default: the engine's helmet model dir)")
    ap.add_argument("--name", default=config.HELMET_MODEL, help="installed ONNX filename")
    ap.add_argument("--no-validate", action="store_true", help="skip the dry-inference check")
    args = ap.parse_args()

    if not os.path.exists(args.onnx):
        raise SystemExit(f"ONNX not found: {args.onnx}")

    if os.path.exists(args.classes):
        with open(args.classes, encoding="utf-8") as fh:
            classes = [ln.strip() for ln in fh if ln.strip()]
    else:
        classes = [c.strip() for c in args.classes.split(",") if c.strip()]
    if not classes:
        raise SystemExit("no classes given")

    os.makedirs(args.dest, exist_ok=True)
    dest_onnx = os.path.join(args.dest, args.name)
    if os.path.abspath(args.onnx) != os.path.abspath(dest_onnx):
        shutil.copy2(args.onnx, dest_onnx)
    print(f"  model -> {dest_onnx}")
    write_classes(args.dest, classes)

    ok = True
    if not args.no_validate:
        print("Validating installed model ...")
        ok = validate(dest_onnx)

    print("\nDone." if ok else "\nDone WITH WARNINGS — see [FAIL]/[WARN] above.")
    print("Enable Helmet Detection on a Traffic-profile camera to use it.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
