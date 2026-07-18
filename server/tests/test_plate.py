"""ANPR plate localisation (server/app/ai/plate.py).

No plate weights ship, so: (1) unit-test the gating + vehicle-crop + decode math
(the reusable core), and (2) a runtime-plumbing smoke test against a real ONNX
(yolox_tiny, generic contract) to prove the session/decode path runs on this
machine's ORT. Plate accuracy needs the real detector and is validated when it
is installed.
"""
import os
import numpy as np
import pytest

from app.ai import plate as P
from app import config


def _bare(contract="generic", conf=0.5, nms=0.3, input_size=(640, 640)):
    d = P.PlateDetector.__new__(P.PlateDetector)
    d.conf = conf
    d.nms = nms
    d.last_error = None
    d.input_size = input_size
    d._contract = contract
    return d


# --- gating: the anti-false-positive core ----------------------------------
def test_gate_accepts_single_row_plate():
    assert P.gate_plate(0, 0, 120, 30, crop_w=400, crop_h=200)   # aspect 4


def test_gate_accepts_indian_two_row_plate():
    # ~2:1 two-row plate (common on Indian two-wheelers) must pass.
    assert P.gate_plate(0, 0, 80, 40, crop_w=400, crop_h=300)


def test_gate_rejects_wide_painted_banner():
    # "emisiones"-style banner: very wide, low aspect band excludes it.
    assert not P.gate_plate(0, 0, 300, 20, crop_w=400, crop_h=200)  # aspect 15


def test_gate_rejects_too_small_to_ocr():
    assert not P.gate_plate(0, 0, 30, 12, crop_w=400, crop_h=200)   # w < 40


def test_gate_rejects_covering_most_of_vehicle():
    # a "plate" that is a third+ of the vehicle crop is a mis-detection.
    assert not P.gate_plate(0, 0, 250, 120, crop_w=300, crop_h=200)  # area frac 0.5


# --- vehicle crops ----------------------------------------------------------
def test_vehicle_crops_skips_tiny_vehicles():
    d = _bare()
    frame = np.zeros((480, 640, 3), np.uint8)
    boxes = [{"x1": 100, "y1": 100, "x2": 300, "y2": 260},   # big enough
             {"x1": 10, "y1": 10, "x2": 30, "y2": 30}]        # < 48px, skipped
    crops = d._vehicle_crops(frame, boxes)
    assert len(crops) == 1


# --- generic decoder (YOLO-style) ------------------------------------------
def test_decode_generic_normalised_cxcywh():
    d = _bare(input_size=(640, 640))
    # one row: cx,cy,w,h normalised + 1 class score
    arr = np.zeros((1, 1, 5), np.float32)
    arr[0, 0] = [0.5, 0.5, 0.2, 0.1, 0.9]     # -> 320px wide? cx.. compute below
    raw = d._decode_generic(arr, scale=1.0, crop_w=640, crop_h=640)
    assert len(raw) == 1
    x1, y1, x2, y2 = raw[0]["_box"]
    assert x2 - x1 == pytest.approx(0.2 * 640)   # 128 px
    assert raw[0]["_score"] == pytest.approx(0.9)


def test_decode_generic_respects_confidence():
    d = _bare(conf=0.8)
    arr = np.zeros((1, 2, 5), np.float32)
    arr[0, 0] = [0.5, 0.5, 0.2, 0.1, 0.9]     # kept
    arr[0, 1] = [0.3, 0.3, 0.2, 0.1, 0.4]     # below 0.8 -> dropped
    raw = d._decode_generic(arr, scale=1.0, crop_w=640, crop_h=640)
    assert len(raw) == 1


# --- LPD-YuNet priors + decode ---------------------------------------------
def test_lpd_priors_count_and_range():
    d = _bare(contract="lpd_yunet")
    priors = d._make_lpd_priors()
    # 3600 + 600 + 160 + 60 anchors (strides 8/16/32/64 over 320x240)
    assert priors.shape == (4420, 4)
    # Centres are normalised into (0,1); anchor SIZES may exceed 1 for the
    # largest min_size (256px > 240px input height) — that's expected SSD.
    assert priors[:, 0].min() >= 0.0 and priors[:, 0].max() <= 1.0   # cx
    assert priors[:, 1].min() >= 0.0 and priors[:, 1].max() <= 1.0   # cy
    assert priors[:, 2:].min() > 0.0                                 # positive sizes


def test_decode_lpd_score_and_box():
    d = _bare(contract="lpd_yunet")
    d._priors = np.array([[0.5, 0.5, 0.2, 0.2]], np.float32)
    loc = np.zeros((1, 14), np.float32)
    # four corners -> normalised (0.4..0.6, 0.45..0.55): see plate.py channel map
    loc[0, 4], loc[0, 5] = -5.0, -1.25     # corner0 (x=0.4, y=0.45)
    loc[0, 6], loc[0, 7] = +5.0, -1.25     # corner1 (x=0.6, y=0.45)
    loc[0, 10], loc[0, 11] = +5.0, +1.25   # corner2 (x=0.6, y=0.55)
    loc[0, 12], loc[0, 13] = -5.0, +1.25   # corner3 (x=0.4, y=0.55)
    conf = np.array([[0.19, 0.81]], np.float32)   # cls score 0.81
    iou = np.array([0.9], np.float32)
    raw = d._decode_lpd(loc, conf, iou, crop_w=400, crop_h=200)
    assert len(raw) == 1
    assert raw[0]["_score"] == pytest.approx(np.sqrt(0.81 * 0.9), rel=1e-4)
    x1, y1, x2, y2 = raw[0]["_box"]
    assert (x1, x2) == pytest.approx((160.0, 240.0))   # 0.4*400, 0.6*400
    assert (y1, y2) == pytest.approx((90.0, 110.0))    # 0.45*200, 0.55*200
    # and it survives gating (aspect 4, w 80, area small)
    final = d._finalise(raw, 400, 200, 0, 0)
    assert len(final) == 1 and final[0]["class"] == "number_plate"
    assert final[0]["plate_text"] is None               # OCR is a later stage


def test_finalise_drops_ungated_candidate():
    d = _bare()
    raw = [{"_box": (0, 0, 300, 20), "_score": 0.9}]    # aspect 15 banner
    assert d._finalise(raw, 400, 200, 0, 0) == []


# --- runtime plumbing smoke test (real ORT session) ------------------------
_YOLOX = os.path.join(os.path.dirname(__file__), "..", "yolox_tiny.onnx")


@pytest.mark.skipif(not os.path.exists(_YOLOX), reason="yolox_tiny.onnx not present")
def test_runtime_plumbing_runs_via_real_ort_session(tmp_path):
    """The plate run path (session load, provider select, preprocess, run,
    decode, gating) must execute without raising against a real ONNX. yolox_tiny
    is a generic single-output model; decoded boxes are meaningless for a non-
    plate model, but the plumbing is what we prove here."""
    import shutil
    model = tmp_path / "plate_detector.onnx"
    shutil.copy2(_YOLOX, model)
    det = P.PlateDetector(str(model), conf=0.99, nms=0.3)
    assert det._contract == "generic"
    assert det.active_provider.endswith("ExecutionProvider")

    frame = np.zeros((480, 640, 3), np.uint8)
    vehicles = [{"x1": 100, "y1": 100, "x2": 400, "y2": 340}]
    out = det.detect_on_vehicles(frame, vehicles)   # must not raise
    assert isinstance(out, list)
    assert det.last_error is None, det.last_error
    assert det.last_infer_ms > 0.0
