"""Fetches CamAI's face models from OpenCV Zoo.

    python fetch_face_models.py            # detector only (what the engine ships)
    python fetch_face_models.py --all      # + SFace, for face recognition work

Licensing — the whole point of pinning these two specifically:

    YuNet (face detection)     MIT           opencv_zoo/models/face_detection_yunet
    SFace (face recognition)   Apache-2.0    opencv_zoo/models/face_recognition_sface

Both permit proprietary redistribution. Do NOT substitute a YOLO-derived face
model: essentially every public one is YOLOv5/YOLOv8 and therefore AGPL-3.0,
which is exactly what this product moved off (see LICENSING.md). A single AGPL
weight file in resources/engine re-contaminates the shipped binary.

Weights are gitignored (*.onnx) like every other model here — they are fetched
on the build machine, not tracked. build_engine.ps1 copies the detector into
dist/camai-engine/ so the frozen exe finds it.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
import urllib.request

# media.githubusercontent.com, not raw. — these are Git LFS objects and the raw.
# host returns a pointer file, which parses as neither ONNX nor an error.
BASE = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models"

MODELS = {
    "face_detection_yunet_2023mar.onnx": {
        "url": f"{BASE}/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "licence": "MIT",
        "required": True,
        "min_bytes": 200_000,
    },
    "face_recognition_sface_2021dec.onnx": {
        "url": f"{BASE}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "licence": "Apache-2.0",
        "required": False,
        "min_bytes": 30_000_000,
    },
}

DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models_face")


def fetch(name: str, spec: dict) -> bool:
    os.makedirs(DEST, exist_ok=True)
    out = os.path.join(DEST, name)
    if os.path.exists(out) and os.path.getsize(out) >= spec["min_bytes"]:
        print(f"  [skip] {name} already present ({os.path.getsize(out):,} bytes)")
        return True

    print(f"  [get ] {name}  ({spec['licence']})")
    try:
        urllib.request.urlretrieve(spec["url"], out)
    except Exception as e:
        print(f"  [FAIL] {name}: {e}")
        return False

    size = os.path.getsize(out)
    # An LFS pointer is a few hundred bytes of text and would otherwise sit on
    # disk looking like a model until cv2 fails cryptically at load time.
    if size < spec["min_bytes"]:
        with open(out, "rb") as fh:
            head = fh.read(64)
        os.remove(out)
        hint = " (looks like a Git LFS pointer, not the model)" if b"git-lfs" in head else ""
        print(f"  [FAIL] {name}: only {size:,} bytes{hint}")
        return False

    digest = hashlib.sha256(open(out, "rb").read()).hexdigest()[:16]
    print(f"  [ ok ] {name}  {size:,} bytes  sha256:{digest}…")
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="also fetch SFace (recognition)")
    args = ap.parse_args()

    print(f"Fetching face models into {DEST}")
    ok = True
    for name, spec in MODELS.items():
        if not spec["required"] and not args.all:
            continue
        ok &= fetch(name, spec)

    if not ok:
        print("\nOne or more models failed. The engine will run without face "
              "detection and log why; it will not fail silently.")
        return 1
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
