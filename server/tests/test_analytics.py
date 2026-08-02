"""
CameraAnalytics tests (server/app/analytics.py).

Covers: abandoned-object detection, person/vehicle/item zone categorization,
and the occlusion grace window that keeps zone dwell/entry/exit counts
correct for a track that briefly disappears from detections (occlusion)
under the same ID rather than registering a spurious exit+re-entry. See
memory/project_tracker_reid_rewrite.md for why the grace window exists.
"""
import time

import numpy as np

from app.analytics import CameraAnalytics, _object_category

FW, FH = 640, 480


def det(track_id, cls, x1, y1, x2, y2, conf=0.8):
    return {"track_id": track_id, "class": cls, "confidence": conf,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def zone(z_id="z1", **overrides):
    base = {"id": z_id, "name": "Lobby", "shapeType": "polygon", "zoneType": "intrusion",
            "maxOccupancy": 5, "dwellLimit": 999, "points": [[0, 0], [1, 0], [1, 1], [0, 1]]}
    base.update(overrides)
    return base


def test_abandoned_object_alerts_without_owner():
    a = CameraAnalytics("cam1")
    a.ABANDONED_DWELL_SECONDS = 0.0
    fired = False
    for _ in range(8):
        alerts, *_ = a.update([det(1, "backpack", 300, 300, 340, 340)], zones=[], lines=[], frame_w=FW, frame_h=FH)
        fired = fired or any(al["type"] == "abandoned_object" for al in alerts)
    assert fired


def test_no_alert_when_owner_present():
    a = CameraAnalytics("cam2")
    a.ABANDONED_DWELL_SECONDS = 0.0
    fired = False
    for _ in range(8):
        dets = [det(1, "backpack", 300, 300, 340, 340), det(2, "person", 305, 305, 345, 400)]
        alerts, *_ = a.update(dets, zones=[], lines=[], frame_w=FW, frame_h=FH)
        fired = fired or any(al["type"] == "abandoned_object" for al in alerts)
    assert not fired


def undet(cls, x1, y1, x2, y2, conf=0.8):
    """A detection with NO track_id, as helmet.py / face.py append them."""
    return {"class": cls, "confidence": conf,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def test_helmet_violation_fires_once_per_rider():
    """A no_helmet box on a tracked motorcycle raises exactly ONE
    helmet_violation across many frames — the dedup that stops a snapshot+clip
    every ~33ms. The no_helmet box carries no track_id (helmet.py appends it
    that way); the alert is keyed to the motorcycle it sits on."""
    a = CameraAnalytics("cam_helmet")
    moto = det(1, "motorcycle", 300, 300, 360, 400)
    head = undet("no_helmet", 320, 270, 340, 300)   # centred over the bike, above it
    rider = det(2, "person", 305, 260, 355, 400)    # the actual rider _has_valid_rider needs
    count = 0
    for _ in range(10):
        alerts, *_ = a.update([moto, head, rider], zones=[], lines=[], frame_w=FW, frame_h=FH)
        count += sum(1 for al in alerts if al["type"] == "helmet_violation")
    assert count == 1, f"expected exactly one deduped violation, got {count}"


def test_no_helmet_without_a_motorcycle_does_not_alert():
    """A bare head with no bike under it is not a rider — requiring motorcycle
    association is what keeps a pedestrian the model fired on from raising a
    traffic violation."""
    a = CameraAnalytics("cam_helmet2")
    head = undet("no_helmet", 320, 270, 340, 300)
    fired = False
    for _ in range(6):
        alerts, *_ = a.update([head], zones=[], lines=[], frame_w=FW, frame_h=FH)
        fired = fired or any(al["type"] in ("helmet_violation", "triple_riding") for al in alerts)
    assert not fired


def test_triple_riding_escalates_the_violation():
    a = CameraAnalytics("cam_helmet3")
    moto = det(1, "motorcycle", 300, 300, 360, 400)
    head = undet("no_helmet", 320, 270, 340, 300)
    riders = [det(10 + i, "person", 300 + i * 5, 250, 340 + i * 5, 400) for i in range(3)]
    types = set()
    for _ in range(4):
        alerts, *_ = a.update([moto, head, *riders], zones=[], lines=[], frame_w=FW, frame_h=FH)
        types |= {al["type"] for al in alerts}
    assert "triple_riding" in types, f"expected triple_riding, saw {types}"


def test_helmet_no_duplicate_alerts_over_1000_frames():
    """Stress the dedup: 1000 frames of the same helmetless rider on a tracked
    motorcycle must raise exactly ONE violation (within the cooldown), and the
    loop must not crash — the 'no duplicate alerts / no crashes' guarantee."""
    a = CameraAnalytics("cam_stress")
    moto = det(1, "motorcycle", 300, 300, 360, 400)
    head = undet("no_helmet", 320, 270, 340, 300)
    rider = det(2, "person", 305, 260, 355, 400)
    total = 0
    for _ in range(1000):
        alerts, *_ = a.update([moto, head, rider], zones=[], lines=[], frame_w=FW, frame_h=FH)
        total += sum(1 for al in alerts if al["type"] in ("helmet_violation", "triple_riding"))
    assert total == 1, f"expected exactly one deduped violation over 1000 frames, got {total}"


def test_helmet_violation_does_not_repeat_while_rider_stays_in_frame(monkeypatch):
    """A rider who sits in frame for minutes (red light, parked at a stall)
    must raise exactly ONE violation for that whole visit, not one every
    config.HELMET_COOLDOWN (15s default) - that used to mean four-plus
    Telegram messages for a single rider who never left. Advancing well past
    the old cooldown with the SAME track_id still present must not re-fire;
    a DIFFERENT track_id (a genuinely different rider) must still fire its
    own violation normally."""
    import app.analytics as analytics_module

    a = CameraAnalytics("cam_helmet_dwell")
    moto = det(1, "motorcycle", 300, 300, 360, 400)
    head = undet("no_helmet", 320, 270, 340, 300)
    rider = det(2, "person", 305, 260, 355, 400)

    fake_now = 1_000_000.0
    monkeypatch.setattr(analytics_module.time, "time", lambda: fake_now)

    total = 0
    for _ in range(5):
        alerts, *_ = a.update([moto, head, rider], zones=[], lines=[], frame_w=FW, frame_h=FH)
        total += sum(1 for al in alerts if al["type"] == "helmet_violation")
    assert total == 1, f"expected exactly one violation on first sighting, got {total}"

    # Jump forward 5 minutes — the SAME rider (same track_id) is still there.
    fake_now += 300.0
    for _ in range(5):
        alerts, *_ = a.update([moto, head, rider], zones=[], lines=[], frame_w=FW, frame_h=FH)
        total += sum(1 for al in alerts if al["type"] == "helmet_violation")
    assert total == 1, f"same rider re-alerted after only a time jump, got {total} total"

    # A different, newly-tracked rider must still alert normally.
    moto2 = det(3, "motorcycle", 100, 300, 160, 400)
    head2 = undet("no_helmet", 120, 270, 140, 300)
    rider2 = det(4, "person", 105, 260, 155, 400)
    alerts, *_ = a.update([moto2, head2, rider2], zones=[], lines=[], frame_w=FW, frame_h=FH)
    total += sum(1 for al in alerts if al["type"] == "helmet_violation")
    assert total == 2, f"a different rider's violation was suppressed too, got {total} total"


def test_helmet_violation_skips_closer_parked_bike_in_a_cluster():
    """Two motorcycles sit close together: one with a real rider, one parked
    with nobody on it. The no_helmet head is geometrically CLOSER to the
    parked bike than to the ridden one (by raw distance) — a live spot-check
    run 2026-08-02 found exactly this in a dense curbside row near a fruit
    stand: the head-to-bike distance tiebreak alone picked the nearer PARKED
    bike, producing a false helmet_violation with a riderless evidence crop.
    _has_valid_rider() must exclude the parked bike as a candidate regardless
    of it being closer, so the alert associates to the actually-ridden bike."""
    a = CameraAnalytics("cam_cluster")
    moto_ridden = det(1, "motorcycle", 300, 300, 360, 400)
    rider = det(2, "person", 305, 260, 355, 400)
    moto_parked = det(3, "motorcycle", 365, 305, 425, 405)   # no person anywhere near this one
    head = undet("no_helmet", 355, 270, 375, 300)            # closer to moto_parked by centre distance
    found = None
    for _ in range(3):
        alerts, *_ = a.update([moto_ridden, rider, moto_parked, head],
                               zones=[], lines=[], frame_w=FW, frame_h=FH)
        for al in alerts:
            if al["type"] in ("helmet_violation", "triple_riding"):
                found = al
    assert found is not None, "expected the violation to associate to the ridden bike, got none at all"
    assert found["track_id"] == 1, f"associated to track {found['track_id']} — the parked bike, not the rider's"


def test_helmet_alert_carries_evidence_bboxes():
    """The violation must carry rider_bbox + helmet_bbox so the pipeline can save
    rider and helmet crops as evidence."""
    a = CameraAnalytics("cam_ev")
    moto = det(1, "motorcycle", 300, 300, 360, 400)
    head = undet("no_helmet", 320, 270, 340, 300)
    rider = det(2, "person", 305, 260, 355, 400)
    found = None
    for _ in range(3):
        alerts, *_ = a.update([moto, head, rider], zones=[], lines=[], frame_w=FW, frame_h=FH)
        for al in alerts:
            if al["type"] in ("helmet_violation", "triple_riding"):
                found = al
    assert found is not None
    assert "rider_bbox" in found and "helmet_bbox" in found
    assert found["rider_bbox"]["x1"] == 300 and found["helmet_bbox"]["x1"] == 320
    assert found["track_id"] == 1


def plate_det(x1, y1, x2, y2, text="MH12AB1234", conf=0.8):
    """A number_plate detection as plate.py appends it (no track_id)."""
    return {"class": "number_plate", "confidence": conf,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}, "plate_text": text}


def test_number_plate_event_logged_once_per_vehicle():
    a = CameraAnalytics("cam_plate")
    veh = det(1, "car", 300, 300, 460, 440)
    plate = plate_det(360, 410, 430, 435)          # centre inside the car
    count, found = 0, None
    for _ in range(5):
        alerts, *_ = a.update([veh, plate], zones=[], lines=[], frame_w=FW, frame_h=FH)
        for al in alerts:
            if al["type"] == "number_plate":
                count += 1
                found = al
    assert count == 1, f"plate should log once per vehicle (cooldown), got {count}"
    assert found["plate_text"] == "MH12AB1234"
    assert found["track_id"] == 1
    assert "plate_bbox" in found


def test_localised_plate_without_text_raises_no_event():
    a = CameraAnalytics("cam_plate2")
    veh = det(1, "car", 300, 300, 460, 440)
    plate = plate_det(360, 410, 430, 435, text=None)   # localised but unread
    fired = False
    for _ in range(3):
        alerts, *_ = a.update([veh, plate], zones=[], lines=[], frame_w=FW, frame_h=FH)
        fired = fired or any(al["type"] == "number_plate" for al in alerts)
    assert not fired


def test_number_plate_needs_a_vehicle_to_attach_to():
    a = CameraAnalytics("cam_plate3")
    plate = plate_det(360, 410, 430, 435)              # no vehicle in frame
    fired = False
    for _ in range(3):
        alerts, *_ = a.update([plate], zones=[], lines=[], frame_w=FW, frame_h=FH)
        fired = fired or any(al["type"] == "number_plate" for al in alerts)
    assert not fired


def test_zone_occupancy_categorizes_person_vehicle_item_separately():
    a = CameraAnalytics("cam3")
    dets = [det(1, "backpack", 300, 300, 340, 340), det(2, "person", 100, 100, 140, 200), det(3, "car", 400, 400, 460, 440)]
    _, _, _, zone_stats, _, _, _ = a.update(dets, zones=[zone()], lines=[], frame_w=FW, frame_h=FH)
    stats = zone_stats["z1"]
    assert (stats["people_count"], stats["vehicles_count"], stats["items_count"], stats["occupancy"]) == (1, 1, 1, 3)


def test_static_traffic_infrastructure_is_not_counted_as_person_vehicle_or_item():
    a = CameraAnalytics("cam_static")
    dets = [
        det(1, "traffic_light", 100, 100, 120, 180),
        det(2, "stop_sign", 200, 100, 250, 150),
    ]
    _, _, _, zone_stats, line_stats, _, _ = a.update(dets, zones=[zone()], lines=[], frame_w=FW, frame_h=FH)
    stats = zone_stats["z1"]
    assert (stats["people_count"], stats["vehicles_count"], stats["items_count"], stats["occupancy"]) == (0, 0, 0, 0)
    assert line_stats == {}


def test_object_category_boundaries():
    assert _object_category("person") == "person"
    assert _object_category("car") == "vehicle"
    assert _object_category("backpack") == "item"
    assert _object_category("traffic_light") == "infrastructure"
    assert _object_category("license_plate") == "other"


def parking_zone(**overrides):
    base = zone(
        z_id="park1",
        name="P1",
        zoneType="parking",
        points=[[0.25, 0.25], [0.55, 0.25], [0.55, 0.65], [0.25, 0.65]],
    )
    base.update(overrides)
    return base


def test_parking_slot_occupied_by_vehicle_overlap():
    a = CameraAnalytics("cam_parking")
    pz = parking_zone()
    vehicle = det(7, "car", 180, 140, 350, 310)
    _, _, _, zone_stats, _, _, parking_stats = a.update([vehicle], zones=[pz], lines=[], frame_w=FW, frame_h=FH)

    assert parking_stats["total"] == 1
    assert parking_stats["occupied"] == 1
    assert parking_stats["free"] == 0
    assert parking_stats["slots"][0]["status"] == "occupied"
    assert parking_stats["slots"][0]["vehicle_track_id"] == 7
    assert parking_stats["slots"][0]["reason"] == "vehicle_overlap"
    assert zone_stats["park1"]["parking_status"] == "occupied"


def test_parking_slot_free_when_no_vehicle_and_clean_visual_score():
    a = CameraAnalytics("cam_parking_free")
    pz = parking_zone()
    clean_frame = np.full((FH, FW, 3), 120, dtype=np.uint8)
    _, _, _, zone_stats, _, _, parking_stats = a.update([], zones=[pz], lines=[], frame_w=FW, frame_h=FH, frame=clean_frame)

    assert parking_stats["total"] == 1
    assert parking_stats["occupied"] == 0
    assert parking_stats["free"] == 1
    assert parking_stats["slots"][0]["status"] == "free"
    assert zone_stats["park1"]["parking_status"] == "free"


def test_parking_slot_visual_score_fallback_marks_occupied():
    a = CameraAnalytics("cam_parking_visual")
    pz = parking_zone(parkingScoreThreshold=5)
    textured_frame = np.full((FH, FW, 3), 120, dtype=np.uint8)
    textured_frame[120:320, 160:360] = 20
    textured_frame[120:320:8, 160:360] = 240
    _, _, _, _, _, _, parking_stats = a.update([], zones=[pz], lines=[], frame_w=FW, frame_h=FH, frame=textured_frame)

    assert parking_stats["occupied"] == 1
    assert parking_stats["slots"][0]["reason"] == "visual_score"


def test_zone_dwell_survives_brief_occlusion():
    a = CameraAnalytics("cam4")
    z = zone()
    for _ in range(5):
        _, _, _, zone_stats, _, _, _ = a.update([det(1, "person", 200, 200, 240, 300)], zones=[z], lines=[], frame_w=FW, frame_h=FH)
    assert zone_stats["z1"]["entry_count"] == 1
    assert zone_stats["z1"]["exit_count"] == 0

    for _ in range(6):  # occluded — tracker emits nothing for this id
        _, _, _, zone_stats, _, _, _ = a.update([], zones=[z], lines=[], frame_w=FW, frame_h=FH)
    assert zone_stats["z1"]["exit_count"] == 0, "spurious zone exit during brief occlusion"
    assert zone_stats["z1"]["occupancy"] == 1, "occupancy dropped during occlusion"

    for _ in range(3):  # reappears under the same id
        _, _, _, zone_stats, _, _, _ = a.update([det(1, "person", 205, 205, 245, 305)], zones=[z], lines=[], frame_w=FW, frame_h=FH)
    assert zone_stats["z1"]["entry_count"] == 1, "double-counted entry after reappearing"
    assert zone_stats["z1"]["exit_count"] == 0


def test_permanently_gone_track_is_eventually_cleaned_up():
    a = CameraAnalytics("cam5")
    a.REID_GRACE_SECONDS = 0.05
    z = zone()
    a.update([det(1, "person", 200, 200, 240, 300)], zones=[z], lines=[], frame_w=FW, frame_h=FH)
    time.sleep(0.1)
    _, _, _, zone_stats, _, _, _ = a.update([], zones=[z], lines=[], frame_w=FW, frame_h=FH)
    assert zone_stats["z1"]["exit_count"] == 1
    assert 1 not in a.track_history


def test_crowd_density_low_for_scattered_people():
    a = CameraAnalytics("cam6")
    dets = [det(1, "person", 10, 10, 50, 100), det(2, "person", 590, 400, 630, 470)]
    _, _, _, _, _, crowd_stats, _ = a.update(dets, zones=[], lines=[], frame_w=FW, frame_h=FH)
    assert crowd_stats["density_level"] == "low"
    assert crowd_stats["total_people"] == 2
    assert crowd_stats["peak_cell_count"] == 1


def test_crowd_density_flags_tight_cluster():
    a = CameraAnalytics("cam7")
    # 10 people packed into the same small area -> one grid cell, "critical"
    dets = [det(i, "person", 300 + i, 300, 300 + i + 20, 380) for i in range(10)]
    alerts, _, _, _, _, crowd_stats, _ = a.update(dets, zones=[], lines=[], frame_w=FW, frame_h=FH)
    assert crowd_stats["density_level"] == "critical"
    assert crowd_stats["peak_cell_count"] == 10
    assert any(al["type"] == "crowd_density" for al in alerts)


def _bbox_for_normalized_cy(cy_norm, frame_w=FW, frame_h=FH, half_w=20, half_h=20):
    cx_px, cy_px = frame_w / 2, cy_norm * frame_h
    return (cx_px - half_w, cy_px - half_h, cx_px + half_w, cy_px + half_h)


def test_calibrated_speed_gate_two_line_crossing():
    """A vehicle crossing two declared 'speed gate' lines a known real-world
    distance apart should get a calibrated km/h reading, overriding the
    heuristic speed estimate, applied to the detection in the very frame it
    completes the second crossing."""
    a = CameraAnalytics("cam_speed")
    line_a = {"id": "lA", "name": "Gate A", "points": [[0.0, 0.3], [1.0, 0.3]],
              "lineType": "crossing", "speedPairId": "lB", "distanceM": 20.0}
    line_b = {"id": "lB", "name": "Gate B", "points": [[0.0, 0.6], [1.0, 0.6]],
              "lineType": "crossing", "speedPairId": "lA", "distanceM": 20.0}
    lines = [line_a, line_b]

    # bbox arrives directly as the tracker's own position — no independent
    # smoothing in CameraAnalytics — so each step below is crafted to cross
    # exactly one gate line per update() call, landing just past the line
    # (crossing fraction close to 1.0) so the interpolated crossing instant
    # (see segment_crossing_fraction) lands close to that call's timestamp.
    x1, y1, x2, y2 = _bbox_for_normalized_cy(0.10)
    a.update([det(1, "car", x1, y1, x2, y2)], zones=[], lines=lines, frame_w=FW, frame_h=FH)

    x1, y1, x2, y2 = _bbox_for_normalized_cy(0.31)  # crosses Gate A (y=0.3), not yet Gate B (y=0.6)
    a.update([det(1, "car", x1, y1, x2, y2)], zones=[], lines=lines, frame_w=FW, frame_h=FH)
    assert a.speed_gate_pending.get(1) is not None, "Gate A crossing should open a pending speed gate"

    time.sleep(1.0)

    x1, y1, x2, y2 = _bbox_for_normalized_cy(0.61)  # crosses Gate B (y=0.6) ~1s after Gate A
    dets = [det(1, "car", x1, y1, x2, y2)]
    a.update(dets, zones=[], lines=lines, frame_w=FW, frame_h=FH)

    calibrated = a.track_calibrated_speed.get(1)
    assert calibrated is not None, "paired gate crossing should produce a calibrated speed reading"
    expected_kmh = 20.0 / 1.0 * 3.6  # distance_m / dt * 3.6, dt ~= the 1.0s sleep above
    assert abs(calibrated["speed_kmh"] - expected_kmh) < expected_kmh * 0.35, calibrated
    assert 1 not in a.speed_gate_pending, "pending gate should be cleared once paired"

    # The calibrated reading overrides the heuristic estimate on the very
    # detection that completed the crossing, in the same update() call.
    assert dets[0]["speed_calibrated"] is True
    assert abs(dets[0]["speed"] - calibrated["speed_kmh"]) < 0.1


def test_direction_label_from_motion():
    a = CameraAnalytics("cam_dir")
    # First sighting: no prior position, so direction defaults to stationary.
    dets = [det(1, "car", 100, 100, 140, 140)]
    a.update(dets, zones=[], lines=[], frame_w=FW, frame_h=FH)
    assert dets[0]["direction"] == "stationary"

    # Moves right (+x) a clearly-above-jitter-threshold distance -> "E".
    dets = [det(1, "car", 300, 100, 340, 140)]
    a.update(dets, zones=[], lines=[], frame_w=FW, frame_h=FH)
    assert dets[0]["direction"] == "E"

    # Sub-jitter-threshold move -> stays "stationary", not noisy.
    dets = [det(1, "car", 301, 100, 341, 140)]
    a.update(dets, zones=[], lines=[], frame_w=FW, frame_h=FH)
    assert dets[0]["direction"] == "stationary"


def test_lane_assignment_from_lane_type_zone():
    a = CameraAnalytics("cam_lane")
    lane1 = zone(z_id="lane1", name="Lane 1", zoneType="lane", points=[[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]])
    lane2 = zone(z_id="lane2", name="Lane 2", zoneType="lane", points=[[0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.5, 1.0]])
    zones = [lane1, lane2]

    left_car = det(1, "car", 50, 50, 90, 90)     # centroid x ~= 0.11 -> Lane 1
    right_car = det(2, "car", 500, 50, 540, 90)  # centroid x ~= 0.81 -> Lane 2
    a.update([left_car, right_car], zones=zones, lines=[], frame_w=FW, frame_h=FH)

    assert left_car["lane"] == "Lane 1"
    assert right_car["lane"] == "Lane 2"


def test_lane_is_none_outside_any_lane_zone():
    a = CameraAnalytics("cam_lane2")
    intrusion_zone = zone()  # zoneType="intrusion", not "lane" — must not be treated as a lane
    dets = [det(1, "car", 100, 100, 140, 140)]
    a.update(dets, zones=[intrusion_zone], lines=[], frame_w=FW, frame_h=FH)
    assert dets[0]["lane"] is None


def test_speed_gate_ignores_unpaired_line():
    """Crossing two lines that don't declare each other as a speedPairId
    should NOT produce a calibrated reading — only a declared gate pair
    counts, otherwise any two arbitrary line crossings would be
    (meaninglessly) treated as a speed measurement."""
    a = CameraAnalytics("cam_speed2")
    line_a = {"id": "lA", "name": "Gate A", "points": [[0.0, 0.3], [1.0, 0.3]], "lineType": "crossing"}
    line_c = {"id": "lC", "name": "Unrelated Line", "points": [[0.0, 0.6], [1.0, 0.6]], "lineType": "crossing"}
    lines = [line_a, line_c]

    # Same EMA-aware target sequence as the paired-gate test above, so this
    # test genuinely exercises two real line crossings rather than passing
    # vacuously because neither crossing was ever detected.
    for cy in (0.10, 0.90, 0.50):
        x1, y1, x2, y2 = _bbox_for_normalized_cy(cy)
        a.update([det(1, "car", x1, y1, x2, y2)], zones=[], lines=lines, frame_w=FW, frame_h=FH)
    assert a.speed_gate_pending.get(1) is not None, "Gate A crossing should still open a pending gate"

    x1, y1, x2, y2 = _bbox_for_normalized_cy(0.95)
    a.update([det(1, "car", x1, y1, x2, y2)], zones=[], lines=lines, frame_w=FW, frame_h=FH)

    assert 1 not in a.track_calibrated_speed, "unrelated lines must not produce a calibrated speed"


def test_privacy_mask_and_exclusion_zone_filtering():
    a = CameraAnalytics("cam_privacy")
    pm = zone(z_id="pm1", zoneType="privacy_mask", points=[[0.0, 0.0], [0.2, 0.0], [0.2, 0.2], [0.0, 0.2]])
    ez = zone(z_id="ez1", zoneType="exclusion_zone", points=[[0.8, 0.8], [1.0, 0.8], [1.0, 1.0], [0.8, 1.0]])
    
    # det1 inside privacy mask
    det1 = det(1, "person", 5, 5, 15, 15)  # cx, cy ~= 0.015, 0.02
    # det2 inside exclusion zone
    det2 = det(2, "person", 580, 420, 600, 440) # cx, cy ~= 0.92, 0.90
    # det3 outside
    det3 = det(3, "person", 300, 300, 340, 340)
    
    dets = [det1, det2, det3]
    _, _, _, zone_stats, _, _, _ = a.update(dets, zones=[pm, ez], lines=[], frame_w=FW, frame_h=FH)
    
    # Detections should have been filtered down to just det3!
    assert 1 not in a.track_history
    assert 2 not in a.track_history
    assert 3 in a.track_history


def test_custom_rule_engine_rules():
    a = CameraAnalytics("cam_rules")
    a.cooldown_period = 0.0 # disable cooldown
    
    # 1. Custom Intrusion Rule
    r1 = {
        "id": "rule_int_1",
        "name": "Person Intrusion rule",
        "trigger_type": "zone_intrusion",
        "trigger_source_id": "z1",
        "is_enabled": True,
        "conditions": {"class": "person", "min_confidence": 0.5},
        "actions": [{"type": "alert", "message": "Rule 1: Person Intruded!"}]
    }
    
    z1 = zone(z_id="z1")
    person = det(1, "person", 100, 100, 140, 200, conf=0.8)
    alerts, *_ = a.update([person], zones=[z1], lines=[], frame_w=FW, frame_h=FH, rules=[r1])
    
    assert any(al["type"] == "custom_rule" and al["message"] == "Rule 1: Person Intruded!" for al in alerts)
    
    # 2. Custom Loitering Rule
    r2 = {
        "id": "rule_loit_1",
        "name": "Car Loitering rule",
        "trigger_type": "loitering",
        "trigger_source_id": "z1",
        "is_enabled": True,
        "conditions": {"class": "car", "dwell_time": 2.0},
        "actions": [{"type": "alert", "message": "Rule 2: Car Loitering!"}]
    }
    
    car = det(2, "car", 100, 100, 140, 200, conf=0.8)
    a.update([car], zones=[z1], lines=[], frame_w=FW, frame_h=FH, rules=[r2])
    a.zone_active_tracks["z1"][2] = time.time() - 3.0 # simulate 3 seconds inside
    
    alerts, *_ = a.update([car], zones=[z1], lines=[], frame_w=FW, frame_h=FH, rules=[r2])
    assert any(al["type"] == "custom_rule" and al["message"] == "Rule 2: Car Loitering!" for al in alerts)
