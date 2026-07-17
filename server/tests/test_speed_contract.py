"""
Speed reporting contract (server/app/analytics.py).

Speed is AUTOMATIC — no lines to draw. Metres-per-pixel is derived from the
detected object's own height against a real-world prior (CLASS_HEIGHT_M), so a
number comes out of a bare camera with no operator setup.

Two rules this suite exists to enforce:

  1. The number must be grounded in real geometry, not a tuning constant. Speed
     used to be (normalised_displacement / dt) * 100.0 / (cy + 0.2) — 100.0 was
     invented and the result could not be km/h. test_estimated_speed_matches_
     known_ground_truth pins the replacement against hand-computed physics.

  2. An ESTIMATE MAY NOT ACCUSE ANYONE. The estimate is ~+/-20-30% (class-average
     height prior, assumes motion across the view). It is fine for "traffic is
     doing about 50"; it is not evidence. Speed-limit alerts therefore still
     require a calibrated two-line gate, and speed_calibrated stays False.

The calibrated gate path is covered in
test_analytics.py::test_calibrated_speed_gate_two_line_crossing.
"""
import time

from app.analytics import CameraAnalytics, CLASS_HEIGHT_M, _estimate_mpp

FW, FH = 640, 480


def det(track_id, cls, x1, y1, x2, y2, conf=0.8):
    return {"track_id": track_id, "class": cls, "confidence": conf,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def car_at(track_id, cx, cy, h_px=60):
    """A car box centred at (cx, cy) with a given pixel height (=> known scale)."""
    w = h_px * 2.0  # arbitrary; only height drives the scale
    return det(track_id, "car", cx - w / 2, cy - h_px / 2, cx + w / 2, cy + h_px / 2)


# ---------------------------------------------------------------------------
# The scale reference itself
# ---------------------------------------------------------------------------

def test_mpp_derives_from_real_object_height():
    """A 1.5m car 60px tall => 0.025 m/px. This is arithmetic on a measured
    quantity, not a fitted constant."""
    b = {"x1": 100, "y1": 100, "x2": 220, "y2": 160}  # 60px tall
    mpp = _estimate_mpp(b, "car", FW, FH)
    assert mpp == CLASS_HEIGHT_M["car"] / 60.0
    assert abs(mpp - 0.025) < 1e-9


def test_mpp_rejects_boxes_clipped_by_the_frame_edge():
    """A clipped box is shorter on screen than the object really is, which
    inflates m/px and therefore speed — the classic way this technique invents
    200km/h ghosts as a vehicle enters or leaves frame."""
    assert _estimate_mpp({"x1": 0, "y1": 100, "x2": 120, "y2": 160}, "car", FW, FH) is None
    assert _estimate_mpp({"x1": 100, "y1": 0, "x2": 220, "y2": 60}, "car", FW, FH) is None
    assert _estimate_mpp({"x1": 500, "y1": 100, "x2": FW, "y2": 160}, "car", FW, FH) is None
    assert _estimate_mpp({"x1": 100, "y1": 400, "x2": 220, "y2": FH}, "car", FW, FH) is None


def test_mpp_rejects_tiny_and_unknown_classes():
    # Too small: per-pixel quantisation error alone would be several percent.
    assert _estimate_mpp({"x1": 100, "y1": 100, "x2": 110, "y2": 110}, "car", FW, FH) is None
    # No size prior for this class -> no honest scale.
    assert _estimate_mpp({"x1": 100, "y1": 100, "x2": 220, "y2": 160}, "traffic_light", FW, FH) is None


def test_taller_object_further_away_reads_as_smaller_scale():
    """Perspective falls out for free: the same car further away is fewer pixels
    tall, so each pixel covers MORE metres."""
    near = _estimate_mpp({"x1": 100, "y1": 100, "x2": 340, "y2": 220}, "car", FW, FH)  # 120px
    far = _estimate_mpp({"x1": 100, "y1": 100, "x2": 160, "y2": 130}, "car", FW, FH)   # 30px
    assert far > near


# ---------------------------------------------------------------------------
# The estimate
# ---------------------------------------------------------------------------

def test_estimated_speed_matches_known_ground_truth():
    """Hand-computed physics, end to end.

    Car 60px tall => 0.025 m/px. Move it 100px in ~0.10s:
        100px * 0.025 m/px = 2.5m in 0.10s = 25 m/s = 90 km/h.
    The Kalman filter converges over a few updates rather than snapping, so
    drive it and check the value lands in the right neighbourhood.
    """
    a = CameraAnalytics("cam_gt")
    x, y = 100.0, 240.0
    dt = 0.10
    for _ in range(12):
        a.update([car_at(1, x, y, h_px=60)], zones=[], lines=[], frame_w=FW, frame_h=FH)
        time.sleep(dt)
        x += 100.0
        if x > 520:  # keep clear of the frame edge (clipped boxes are excluded)
            x = 100.0
            a.track_last_px.pop(1, None)  # teleport isn't motion

    speed = a.track_speeds.get(1)
    assert speed is not None
    # Generous band: sleep() jitter moves dt around, and the filter lags.
    assert 55 < speed < 130, f"expected ~90 km/h, got {speed}"


def test_moving_object_reports_a_speed_with_no_lines_drawn():
    a = CameraAnalytics("cam_auto")
    x = 100.0
    last = None
    for _ in range(8):
        last = car_at(1, x, 240, h_px=60)
        a.update([last], zones=[], lines=[], frame_w=FW, frame_h=FH)
        time.sleep(0.05)
        x += 40.0

    assert last["speed"] is not None, "speed must work with no calibration lines"
    assert last["speed"] > 0
    assert last["speed_source"] == "estimated"


def test_an_estimate_is_never_labelled_calibrated():
    """The label is the whole safeguard: downstream code keys off it."""
    a = CameraAnalytics("cam_label")
    x = 100.0
    last = None
    for _ in range(5):
        last = car_at(1, x, 240, h_px=60)
        a.update([last], zones=[], lines=[], frame_w=FW, frame_h=FH)
        time.sleep(0.04)
        x += 40.0
    assert last["speed_calibrated"] is False


def test_speed_is_unavailable_for_a_class_with_no_size_prior():
    a = CameraAnalytics("cam_noprior")
    last = None
    for i in range(4):
        last = det(1, "traffic_light", 100 + i * 20, 100, 140 + i * 20, 160)
        a.update([last], zones=[], lines=[], frame_w=FW, frame_h=FH)
        time.sleep(0.04)
    assert last["speed"] is None
    assert last["speed_source"] == "unavailable"


def test_stationary_object_reads_near_zero():
    a = CameraAnalytics("cam_still")
    last = None
    for _ in range(8):
        last = car_at(1, 300, 240, h_px=60)
        a.update([last], zones=[], lines=[], frame_w=FW, frame_h=FH)
        time.sleep(0.04)
    assert last["speed"] is not None
    assert last["speed"] < 5, f"parked car should read ~0, got {last['speed']}"


def test_per_track_scale_state_is_cleaned_up_with_the_track():
    """Otherwise a busy road grows these dicts unbounded across a shift."""
    a = CameraAnalytics("cam_gc")
    a.REID_GRACE_SECONDS = 0.0
    a.update([car_at(1, 300, 240)], zones=[], lines=[], frame_w=FW, frame_h=FH)
    assert 1 in a.track_mpp
    time.sleep(0.05)
    a.update([], zones=[], lines=[], frame_w=FW, frame_h=FH)  # track gone
    assert 1 not in a.track_mpp
    assert 1 not in a.track_last_px


# ---------------------------------------------------------------------------
# An estimate may not accuse anyone
# ---------------------------------------------------------------------------

def test_speed_limit_rule_does_not_fire_on_an_estimate():
    """THE regression test. det["speed"] is now populated by default, so a rule
    gating on `speed is not None` would raise real speeding alerts off a ~25%
    estimate — the fabricated-evidence behaviour this whole design removed."""
    a = CameraAnalytics("cam_rule")
    rules = [{
        "id": "r1", "name": "Speed cap", "is_enabled": True,
        "trigger_type": "speed_limit",
        "conditions": {"speed_limit": 1.0},  # absurdly low: fires on any real number
        "actions": [{"type": "alert", "message": "too fast"}],
    }]

    fired = False
    x = 100.0
    for _ in range(8):
        alerts, *_ = a.update([car_at(1, x, 240, h_px=60)], zones=[], lines=[],
                              frame_w=FW, frame_h=FH, rules=rules)
        fired = fired or any(al["type"] == "custom_rule" for al in alerts)
        time.sleep(0.04)
        x += 40.0

    assert not fired, "speed-limit rule fired on an uncalibrated estimate"


def test_traffic_profile_speed_violation_does_not_fire_on_an_estimate():
    a = CameraAnalytics("cam_traffic")
    features = {"speed_limit": {"enabled": True, "limit": 1.0}}

    fired = False
    x = 100.0
    for _ in range(8):
        alerts, *_ = a.update([car_at(1, x, 240, h_px=60)], zones=[], lines=[],
                              frame_w=FW, frame_h=FH,
                              zone_profile="traffic", profile_features=features)
        fired = fired or any(al["type"] == "speed_limit" for al in alerts)
        time.sleep(0.04)
        x += 40.0

    assert not fired, "traffic speed violation fired on an uncalibrated estimate"
