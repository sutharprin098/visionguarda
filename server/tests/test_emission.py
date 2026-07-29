"""
Overlay emission tests (server/app/ai/pipeline.py::resolve_emitted_detections).

These protect the "one object -> exactly one bounding box" invariant.

The bug these were written against: the frame's boxes used to be the UNION of
the raw detector output and the tracker's coasting predictions. Whenever the
tracker dropped a frame for an object the detector still saw, BOTH were
emitted — the raw detection as a solid box with no track_id, and the track's
Kalman prediction as a dashed "coasting" box — so a single object wore two
boxes at once.
"""
import numpy as np
import pytest

from app.ai.pipeline import ByteTracker, Track, resolve_emitted_detections


def det(bbox, cls="car", conf=0.9):
    x1, y1, x2, y2 = bbox
    return {"class": cls, "confidence": conf, "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def trk(track_id, bbox, cls="car", conf=0.9, dwell=1.0):
    x1, y1, x2, y2 = bbox
    return {"track_id": track_id, "class": cls, "confidence": conf, "dwell_time": dwell,
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def _tracker_with_coasting_track(bbox, cls="car", frames_missed=1):
    """A tracker holding one CONFIRMED track that the tracker did not match
    this frame (time_since_update > 0) — i.e. a coasting track."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    t = Track(1, list(bbox), cls, 0.9, embedding=None, n_init=2)
    t.state = "confirmed"
    t.time_since_update = frames_missed
    # Coasting is aged in seconds off the tracker clock, so a fabricated track
    # has to be placed on that clock too: advance it by the same number of
    # reference-cadence frames the caller asked to skip.
    t.last_clock = 0.0
    tracker._clock = frames_missed / 25.0
    tracker.tracks = [t]
    return tracker


def test_overlapping_same_class_tracks_collapse_to_one_box():
    """Two confirmed tracks stacked on one physical object (an ID switch that
    left both alive) must NOT paint two boxes on one person. Same-class boxes
    at IoU>0.7 collapse to one — the 'N boxes on one human' fix."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    box = (100, 100, 200, 300)
    near = (104, 103, 205, 305)   # IoU with box > 0.7
    tracks_raw = [trk(1, box, cls="person"), trk(2, near, cls="person")]
    dets, masks = resolve_emitted_detections(
        tracker, tracks_raw, [det(box, cls="person"), det(near, cls="person")], [[], []]
    )
    assert len(dets) == 1, f"one person must emit one box, got {len(dets)}"
    assert len(masks) == len(dets)


def test_overlapping_different_class_boxes_both_survive():
    """A rider's person box and motorcycle box overlap heavily but are different
    objects — the dedup must never merge across classes."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    box = (100, 100, 200, 300)
    tracks_raw = [trk(1, box, cls="person"), trk(2, box, cls="motorcycle")]
    dets, _ = resolve_emitted_detections(
        tracker, tracks_raw, [det(box, cls="person"), det(box, cls="motorcycle")], [[], []]
    )
    assert {d["class"] for d in dets} == {"person", "motorcycle"}


def test_object_never_gets_both_a_raw_box_and_a_coasting_box():
    """THE regression test for duplicate boxes.

    An object the tracker failed to match this frame, but that the detector
    still fired on. Previously: the raw detection escaped as a solid,
    track_id-less box AND the confirmed track coasted a dashed box over the
    same object. Now the tracker is authoritative — exactly one box.
    """
    BOX = (100, 100, 200, 300)
    tracker = _tracker_with_coasting_track(BOX)

    # Detector still sees the object; tracker matched nothing this frame, so
    # tracks_raw (which only ever carries time_since_update==0 tracks) is empty.
    dets, masks = resolve_emitted_detections(tracker, [], [det(BOX)], [[]])

    assert len(dets) == 1, f"one object must produce exactly one box, got {len(dets)}: {dets}"
    assert len(masks) == len(dets), "masks must stay index-parallel with detections"
    # The surviving box is the tracker's, so it carries an identity.
    assert dets[0]["track_id"] == 1
    assert dets[0]["tracking_status"] == "coasting"


def test_every_emitted_box_has_a_track_id():
    """No track_id means analytics.update() skips the detection entirely (it is
    keyed by track), which is why such boxes could never show speed or dwell."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    tracks_raw = [trk(7, (10, 10, 60, 120))]
    # A raw detection that matches no track at all (nowhere near it).
    dets, _ = resolve_emitted_detections(
        tracker, tracks_raw, [det((10, 10, 60, 120)), det((500, 400, 560, 470))], [[], []]
    )

    assert all(d.get("track_id") is not None for d in dets), dets
    assert [d["track_id"] for d in dets] == [7]


def test_unmatched_raw_detection_is_dropped_not_emitted_as_phantom():
    """A detection the tracker has not (yet) turned into a confirmed track is
    not an object we can identify — emitting it produced the anonymous solid
    box that doubled up with the tracker's own."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    dets, masks = resolve_emitted_detections(tracker, [], [det((100, 100, 200, 300))], [[]])
    assert dets == []
    assert masks == []


def test_tracked_detection_keeps_its_class_and_mask():
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    BOX = (100, 100, 200, 300)
    mask = [[1, 2], [3, 4]]
    tracks_raw = [trk(3, BOX, cls="car")]

    dets, masks = resolve_emitted_detections(tracker, tracks_raw, [det(BOX, cls="truck")], [mask])

    assert len(dets) == 1
    assert dets[0]["track_id"] == 3
    assert dets[0]["tracking_status"] == "tracked"
    # Detection contributes the class; the track contributes the position.
    assert dets[0]["class"] == "truck"
    assert masks == [mask]


def test_track_with_no_matching_detection_still_emits_a_box():
    """Guards the fix against over-correcting: a fast mover whose Kalman box
    falls under the IoU>0.3 re-association gate must not vanish."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    # Track is live (in tracks_raw) but the only detection is far away.
    tracks_raw = [trk(5, (100, 100, 200, 300))]
    dets, masks = resolve_emitted_detections(tracker, tracks_raw, [det((500, 400, 560, 470))], [[]])

    assert len(dets) == 1
    assert dets[0]["track_id"] == 5
    assert dets[0]["tracking_status"] == "tracked"
    assert dets[0]["bbox"] == {"x1": 100, "y1": 100, "x2": 200, "y2": 300}


def test_two_overlapping_detections_on_one_track_emit_one_box():
    """NMS near-duplicates / a person split into two boxes: both overlap the
    same track. Only one may claim it; the loser must not be emitted."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    tracks_raw = [trk(1, (100, 100, 200, 300))]
    dets, masks = resolve_emitted_detections(
        tracker, tracks_raw, [det((100, 100, 200, 300)), det((105, 104, 205, 305))], [[], []]
    )

    assert len(dets) == 1, f"expected one box, got {len(dets)}"
    assert len(masks) == 1


def test_coasting_stops_after_the_render_window():
    BOX = (100, 100, 200, 300)
    tracker = _tracker_with_coasting_track(BOX, frames_missed=6)
    dets, _ = resolve_emitted_detections(tracker, [], [], [], coast_render_seconds=5 / 25.0)
    assert dets == []


def test_tentative_track_does_not_coast():
    """Only confirmed tracks may coast; a tentative one has not earned an ID."""
    tracker = ByteTracker(max_lost_seconds=0.4, reid_ttl=30.0, n_init=2)
    t = Track(1, [100, 100, 200, 300], "car", 0.9, embedding=None, n_init=2)
    t.state = "tentative"
    t.time_since_update = 1
    tracker.tracks = [t]
    dets, _ = resolve_emitted_detections(tracker, [], [], [])
    assert dets == []


def test_no_track_is_ever_emitted_twice():
    """A track present in tracks_raw must not also produce a coasting box."""
    BOX = (100, 100, 200, 300)
    tracker = _tracker_with_coasting_track(BOX)
    # Same track id also appears as live this frame.
    tracks_raw = [trk(1, BOX)]
    dets, _ = resolve_emitted_detections(tracker, tracks_raw, [det(BOX)], [[]])

    ids = [d["track_id"] for d in dets]
    assert len(ids) == len(set(ids)) == 1, f"track emitted more than once: {dets}"
    assert dets[0]["tracking_status"] == "tracked"
