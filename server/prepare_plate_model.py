"""Install + validate the ANPR models (plate detector + CRNN OCR) for CamAI.
Offline dev/ops tool — nothing in the shipped engine imports it (mirrors
prepare_helmet_model.py).

It copies the plate detector ONNX and the OCR ONNX into the directory the engine
searches, writes the classes.txt / charset.txt those modules load, and LOADS
each through ONNX Runtime with a dry inference to confirm the I/O contract
app/ai/plate.py and app/ai/plate_ocr.py expect. No torch needed.

Usage
-----
    python prepare_plate_model.py --detector plate.onnx --ocr crnn_en.onnx
    # OCR is optional — plates still localise without it:
    python prepare_plate_model.py --detector plate.onnx
    # custom charset (default is EN 0-9a-z) or a charset file:
    python prepare_plate_model.py --detector p.onnx --ocr c.onnx --charset charset_en.txt

Models (all Apache-2.0):
  * plate detector — a YOLO-family plate model (generic single-output) OR the
    OpenCV Zoo license_plate_detection_yunet (loc/conf/iou). app/ai/plate.py
    auto-detects which. LPD-YuNet is Chinese-trained; prefer an India-tuned
    detector for the DM pilot — it drops in here unchanged.
  * OCR — OpenCV Zoo text_recognition_crnn (CRNN_EN etc.).

IMPORTANT: installing the models does not mean ANPR is validated for a site.
Run it on that site's real plate footage and confirm the plate log before
trusting it — the whole reason ANPR was gated this long.
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app import config  # noqa: E402

_EN_36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def _providers():
    import onnxruntime as ort
    pref = ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
    avail = ort.get_available_providers()
    return [p for p in pref if p in avail] or ["CPUExecutionProvider"]


def validate_detector(path: str) -> bool:
    import onnxruntime as ort
    print("Validating plate detector ...")
    sess = ort.InferenceSession(path, providers=_providers())
    ins, outs = sess.get_inputs(), sess.get_outputs()
    for i in ins:
        print(f"  in  {i.name:16s} {i.type:14s} {i.shape}")
    for o in outs:
        print(f"  out {o.name:16s} {o.type:14s} {o.shape}")
    out_names = [o.name.lower() for o in outs]
    is_lpd = len(outs) == 3 and any("loc" in n for n in out_names) and any("conf" in n for n in out_names)
    if is_lpd:
        w, h = 320, 240   # LPD-YuNet fixed input
        contract = "lpd_yunet (loc/conf/iou)"
    else:
        shp = ins[0].shape
        s = shp[2] if isinstance(shp[2], int) else 640
        w = h = int(s)
        contract = "generic single-output"
    try:
        t0 = time.time()
        res = sess.run(None, {ins[0].name: np.zeros((1, 3, h, w), np.float32)})
        print(f"  dry inference OK in {(time.time()-t0)*1000:.0f}ms | contract: {contract}")
        print(f"  output shapes: {[np.asarray(r).shape for r in res]}")
        return True
    except Exception as e:
        print(f"  [FAIL] dry inference: {e}")
        return False


def validate_ocr(path: str) -> bool:
    import onnxruntime as ort
    print("Validating OCR (CRNN) ...")
    sess = ort.InferenceSession(path, providers=_providers())
    ins, outs = sess.get_inputs(), sess.get_outputs()
    ch = ins[0].shape[1] if len(ins[0].shape) > 1 and isinstance(ins[0].shape[1], int) else 1
    print(f"  in  {ins[0].name} {ins[0].type} {ins[0].shape} (channels={ch})")
    try:
        t0 = time.time()
        res = sess.run(None, {ins[0].name: np.zeros((1, ch, 32, 100), np.float32)})
        out = np.asarray(res[0])
        print(f"  dry inference OK in {(time.time()-t0)*1000:.0f}ms | output {out.shape}")
        # T x 1 x C, or 1 x T x C — C is the alphabet+blank.
        c = out.shape[-1]
        print(f"  alphabet+blank size looks like {c}; charset must be {c - 1} chars.")
        return True
    except Exception as e:
        print(f"  [FAIL] dry inference: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--detector", required=True, help="plate detector ONNX")
    ap.add_argument("--ocr", help="CRNN OCR ONNX (optional; plates localise without it)")
    ap.add_argument("--classes", default="number_plate", help="detector classes (comma list or file)")
    ap.add_argument("--charset", default=_EN_36, help="OCR charset string or file (default 0-9a-z)")
    ap.add_argument("--dest", default=str(config.ANPR_MODEL_DIR))
    ap.add_argument("--no-validate", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.detector):
        raise SystemExit(f"detector not found: {args.detector}")
    os.makedirs(args.dest, exist_ok=True)

    det_dest = os.path.join(args.dest, config.ANPR_MODEL)
    if os.path.abspath(args.detector) != os.path.abspath(det_dest):
        shutil.copy2(args.detector, det_dest)
    print(f"  detector -> {det_dest}")

    # classes.txt
    if os.path.exists(args.classes):
        with open(args.classes, encoding="utf-8") as fh:
            classes = [ln.strip() for ln in fh if ln.strip()]
    else:
        classes = [c.strip() for c in args.classes.split(",") if c.strip()]
    with open(os.path.join(args.dest, config.ANPR_CLASSES_FILE), "w", encoding="utf-8") as fh:
        fh.write("\n".join(classes) + "\n")
    print(f"  classes  -> {classes}")

    ok = True
    if not args.no_validate:
        ok &= validate_detector(det_dest)

    if args.ocr:
        if not os.path.exists(args.ocr):
            raise SystemExit(f"OCR not found: {args.ocr}")
        ocr_dest = os.path.join(args.dest, config.ANPR_OCR_MODEL)
        if os.path.abspath(args.ocr) != os.path.abspath(ocr_dest):
            shutil.copy2(args.ocr, ocr_dest)
        print(f"  ocr      -> {ocr_dest}")
        if os.path.exists(args.charset):
            with open(args.charset, encoding="utf-8") as fh:
                charset_text = fh.read()
        else:
            charset_text = args.charset
        with open(os.path.join(args.dest, config.ANPR_OCR_CHARSET), "w", encoding="utf-8") as fh:
            fh.write(charset_text.rstrip("\n") + "\n")
        print(f"  charset  -> {len(charset_text.strip())} chars")
        if not args.no_validate:
            ok &= validate_ocr(ocr_dest)
    else:
        print("  (no OCR model — plates will be localised but not read)")

    print("\nDone." if ok else "\nDone WITH WARNINGS — see [FAIL] above.")
    print("Enable ANPR on a Traffic-profile camera. VALIDATE on real plate "
          "footage before trusting the plate log.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
