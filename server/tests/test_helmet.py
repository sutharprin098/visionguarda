"""RT-DETR helmet detector (server/app/ai/helmet.py).

Two layers, since no real helmet weights ship in the repo:
  1. Decode-contract unit tests — the risky new code. Synthetic tensors shaped
     exactly like the official RT-DETR ONNX (labels/boxes/scores) and the fused
     single-output export, decoded through the real HelmetDetector methods.
  2. A runtime-plumbing smoke test — the real ONNX Runtime session + IO binding
     + preprocess path, exercised against an ONNX that DOES ship (yolox_tiny).
     It asserts the path RUNS on this machine's ORT build without raising; it
     does NOT assert helmet accuracy (that needs the real RT-DETR weights and is
     what prepare_helmet_model.py validates).
"""
import os

import numpy as np
import pytest

from app.ai import helmet as H

S = 640


def _bare_detector(class_map, contract, conf=0.3, nms=0.45):
    """A HelmetDetector with decode state set but NO ORT session — lets us feed
    synthetic model outputs straight into the decode methods."""
    d = H.HelmetDetector.__new__(H.HelmetDetector)
    d.conf = conf
    d.nms = nms
    d.input_size = S
    d.class_map = class_map
    d.last_error = None
    d._contract = contract
    return d


def test_canon_maps_helmet_variants():
    assert H._canon("helmet") == "helmet"
    assert H._canon("With Helmet") == "helmet"
    assert H._canon("no_helmet") == "no_helmet"
    assert H._canon("No Helmet") == "no_helmet"
    assert H._canon("without helmet") == "no_helmet"
    assert H._canon("nohelmet") == "no_helmet"
    assert H._canon("person") is None
    assert H._canon("number_plate") is None


def test_load_classes_from_txt(tmp_path):
    model = tmp_path / "rtdetr_helmet.onnx"
    model.write_bytes(b"not a real model")   # _load_classes only reads the txt
    (tmp_path / H.config.HELMET_CLASSES_FILE).write_text("helmet\nno_helmet\n")
    cmap = H._load_classes(str(model))
    assert cmap == {0: "helmet", 1: "no_helmet"}


def test_load_classes_missing_txt_raises(tmp_path):
    model = tmp_path / "rtdetr_helmet.onnx"
    model.write_bytes(b"x")
    with pytest.raises(FileNotFoundError):
        H._load_classes(str(model))


def test_select_providers_always_includes_cpu():
    provs = H._select_providers()
    assert provs[-1] == "CPUExecutionProvider" or "CPUExecutionProvider" in provs
    # CUDA/DirectML only appear if that ORT build is installed; CPU always works.


def test_decode_triple_official_contract():
    """labels [1,300], boxes [1,300,4] xyxy in SxS px, scores [1,300]."""
    d = _bare_detector({0: "helmet", 1: "no_helmet"}, "triple")
    boxes = np.zeros((1, 300, 4), np.float32)
    labels = np.zeros((1, 300), np.int64)
    scores = np.zeros((1, 300), np.float32)
    boxes[0, 0] = [280, 280, 360, 360]; labels[0, 0] = 1; scores[0, 0] = 0.9   # no_helmet, kept
    boxes[0, 1] = [10, 10, 40, 40];      labels[0, 1] = 5; scores[0, 1] = 0.95  # class 5 -> ignored
    boxes[0, 2] = [100, 100, 130, 130];  labels[0, 2] = 0; scores[0, 2] = 0.10  # below conf -> dropped
    dets = d._nms(d._decode_triple(boxes, labels, scores, scale=1.0, cx1=0, cy1=0))
    assert len(dets) == 1, dets
    assert dets[0]["class"] == "no_helmet"
    assert dets[0]["confidence"] == pytest.approx(0.9)
    b = dets[0]["bbox"]
    assert (b["x1"], b["y1"], b["x2"], b["y2"]) == pytest.approx((280, 280, 360, 360))


def test_decode_triple_applies_letterbox_and_crop_offset():
    d = _bare_detector({0: "helmet", 1: "no_helmet"}, "triple")
    boxes = np.zeros((1, 300, 4), np.float32)
    labels = np.zeros((1, 300), np.int64)
    scores = np.zeros((1, 300), np.float32)
    boxes[0, 0] = [200, 100, 280, 180]; labels[0, 0] = 0; scores[0, 0] = 0.8
    # scale 0.5 (crop was 2x the letterbox), crop origin (50, 60)
    dets = d._decode_triple(boxes, labels, scores, scale=0.5, cx1=50, cy1=60)
    b = dets[0]["bbox"]
    # frame = crop_origin + input_px / scale
    assert b["x1"] == pytest.approx(50 + 200 / 0.5)
    assert b["y1"] == pytest.approx(60 + 100 / 0.5)


def test_decode_single_fused_contract():
    """[1,N,4+nc]: cx,cy,w,h normalised 0-1 + per-class scores."""
    d = _bare_detector({0: "helmet", 1: "no_helmet"}, "single")
    arr = np.zeros((1, 300, 6), np.float32)
    arr[0, 0, :4] = [0.5, 0.5, 0.125, 0.125]   # -> 280..360 in 640px
    arr[0, 0, 4:] = [0.1, 0.9]                  # argmax=1 no_helmet
    dets = d._nms(d._decode_single(arr, scale=1.0, cx1=0, cy1=0))
    assert len(dets) == 1
    assert dets[0]["class"] == "no_helmet"
    b = dets[0]["bbox"]
    assert (b["x1"], b["x2"]) == pytest.approx((280, 360))


def test_decode_single_pixel_coords_yolov8_export():
    """A plain YOLOv8 detect export gives cx,cy,w,h in INPUT PIXELS and a
    transposed [1,4+nc,N] layout — the common real case. Coords must NOT be
    re-scaled by S (that was the bug that made a real helmet model emit nothing);
    they are already pixels."""
    d = _bare_detector({0: "helmet", 1: "no_helmet"}, "single")
    arr = np.zeros((1, 6, 300), np.float32)     # [1, 4+nc, N] (transposed)
    arr[0, :4, 0] = [320, 320, 80, 80]          # pixels in 640 space -> 280..360
    arr[0, 4:, 0] = [0.9, 0.1]                  # argmax=0 helmet
    dets = d._nms(d._decode_single(arr, scale=1.0, cx1=0, cy1=0))
    assert len(dets) == 1 and dets[0]["class"] == "helmet"
    b = dets[0]["bbox"]
    assert (b["x1"], b["y1"], b["x2"], b["y2"]) == pytest.approx((280, 280, 360, 360))


def test_nms_drops_overlapping_helmet_and_no_helmet_on_one_head():
    d = _bare_detector({0: "helmet", 1: "no_helmet"}, "triple")
    boxes = np.zeros((1, 300, 4), np.float32)
    labels = np.zeros((1, 300), np.int64)
    scores = np.zeros((1, 300), np.float32)
    boxes[0, 0] = [280, 280, 360, 360]; labels[0, 0] = 1; scores[0, 0] = 0.9  # no_helmet
    boxes[0, 1] = [282, 282, 362, 362]; labels[0, 1] = 0; scores[0, 1] = 0.7  # helmet, overlaps
    dets = d._nms(d._decode_triple(boxes, labels, scores, 1.0, 0, 0))
    assert len(dets) == 1 and dets[0]["class"] == "no_helmet"


# --- runtime plumbing smoke test (real ORT session + IO binding) -----------
_YOLOX = os.path.join(os.path.dirname(__file__), "..", "yolox_tiny.onnx")


@pytest.mark.skipif(not os.path.exists(_YOLOX), reason="yolox_tiny.onnx not present")
def test_runtime_plumbing_runs_via_real_ort_session(tmp_path):
    """The RT-DETR run path (session load, provider select, letterbox preprocess,
    IO binding, run_with_iobinding, copy_outputs_to_cpu, decode) must execute
    without raising against a REAL ONNX on this machine's ORT build. Uses the
    shipped yolox_tiny model (single-output => the fused-contract branch); the
    decoded boxes are meaningless for a non-helmet model, but the plumbing is
    what we're proving. Real helmet accuracy is validated by
    prepare_helmet_model.py against real RT-DETR weights."""
    import shutil
    model = tmp_path / "model.onnx"
    shutil.copy2(_YOLOX, model)
    (tmp_path / H.config.HELMET_CLASSES_FILE).write_text("helmet\nno_helmet\n")

    det = H.HelmetDetector(str(model), conf=0.99, nms=0.45, input_size=S)
    assert det._contract == "single"           # yolox_tiny has one input, one output
    assert det.active_provider.endswith("ExecutionProvider")

    frame = np.zeros((480, 640, 3), np.uint8)
    moto = [{"x1": 200, "y1": 200, "x2": 300, "y2": 320}]
    person = [{"x1": 205, "y1": 150, "x2": 295, "y2": 320}]
    out = det.detect_on_riders(frame, moto, person)   # must not raise
    assert isinstance(out, list)
    assert det.last_error is None, det.last_error
    assert det.last_infer_ms > 0.0                     # a real forward pass happened
