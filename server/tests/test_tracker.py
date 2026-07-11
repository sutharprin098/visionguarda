"""
Tracker ID-persistence tests (server/app/ai/pipeline.py::ByteTracker).

These exist to protect the "same ID until the object permanently leaves
frame" requirement: appearance re-identification + Hungarian data
association + a lost-track gallery so IDs survive occlusion/overlap/stops
instead of churning. See memory/project_tracker_reid_rewrite.md for the
full design rationale.
"""
import numpy as np
import pytest
from scipy.optimize import linear_sum_assignment

from app.ai.pipeline import ByteTracker

W, H = 640, 480


def make_frame(color_boxes):
    frame = np.full((H, W, 3), 40, dtype=np.uint8)
    for (x1, y1, x2, y2), color in color_boxes:
        frame[y1:y2, x1:x2] = color
    return frame


def det(bbox, cls="person", conf=0.8):
    x1, y1, x2, y2 = bbox
    return {"class": cls, "confidence": conf, "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2}}


def test_same_id_survives_full_occlusion():
    tracker = ByteTracker(max_lost_frames=10, reid_ttl=30.0, n_init=2)
    RED = (30, 30, 220)

    track_id = None
    x = 50
    for _ in range(6):
        bbox = (x, 200, x + 60, 340)
        frame = make_frame([(bbox, RED)])
        out = tracker.update([det(bbox)], frame=frame, frame_shape=(H, W), conf_thresh=0.25)
        x += 15
        if out:
            track_id = out[0]["track_id"]
    assert track_id is not None, "track was never confirmed"

    # Full occlusion for longer than max_lost_frames — forces gallery demotion
    for _ in range(14):
        tracker.update([], frame=make_frame([]), frame_shape=(H, W), conf_thresh=0.25)
    assert tracker.lost_gallery, "expected the track to be demoted into the lost gallery"

    reappear_bbox = (x + 20, 200, x + 80, 340)
    frame = make_frame([(reappear_bbox, RED)])
    out = None
    for _ in range(3):
        out = tracker.update([det(reappear_bbox)], frame=frame, frame_shape=(H, W), conf_thresh=0.25)
        if out:
            break

    assert out, "track did not reappear after occlusion"
    assert out[0]["track_id"] == track_id, "ID switched after occlusion — re-id gallery failed"


def test_visually_different_object_not_falsely_reidentified():
    tracker = ByteTracker(max_lost_frames=10, reid_ttl=30.0, n_init=2)
    RED = (30, 30, 220)
    BLUE = (220, 30, 30)

    track_id = None
    x = 50
    for _ in range(6):
        bbox = (x, 200, x + 60, 340)
        out = tracker.update([det(bbox)], frame=make_frame([(bbox, RED)]), frame_shape=(H, W), conf_thresh=0.25)
        x += 15
        if out:
            track_id = out[0]["track_id"]

    for _ in range(14):
        tracker.update([], frame=make_frame([]), frame_shape=(H, W), conf_thresh=0.25)

    new_bbox = (x + 20, 200, x + 80, 340)
    out = tracker.update([det(new_bbox)], frame=make_frame([(new_bbox, BLUE)]), frame_shape=(H, W), conf_thresh=0.25)
    if not out:
        out = tracker.update([det(new_bbox)], frame=make_frame([(new_bbox, BLUE)]), frame_shape=(H, W), conf_thresh=0.25)

    assert out, "new object was never confirmed"
    assert out[0]["track_id"] != track_id, "appearance gate incorrectly re-identified a visually different object"


def test_dwell_time_present_and_monotonic():
    tracker = ByteTracker(max_lost_frames=10, reid_ttl=30.0, n_init=1)
    bbox = (100, 100, 160, 240)
    out1 = tracker.update([det(bbox)], frame=make_frame([(bbox, (30, 30, 220))]), frame_shape=(H, W), conf_thresh=0.25)
    assert out1 and out1[0]["dwell_time"] >= 0.0
    out2 = tracker.update([det(bbox)], frame=make_frame([(bbox, (30, 30, 220))]), frame_shape=(H, W), conf_thresh=0.25)
    assert out2[0]["dwell_time"] >= out1[0]["dwell_time"]
    assert out2[0]["track_id"] == out1[0]["track_id"]


def test_quantitative_id_consistency_multi_object_long_duration():
    """Directly validates the goal's '99 percent plus ID consistency' bar
    with an actual measured number, not just qualitative single-object spot
    checks. 5 objects over 100 frames: one goes fully invisible for 15
    frames (occlusion), two cross paths/overlap around frame 75, one sits
    stationary for 40 frames then starts moving (stop-then-go). Ground
    truth object identity is matched to tracker output each frame by
    nearest centroid (Hungarian, gated at 60px) and any change in the
    tracker's assigned id for a continuously-tracked object counts as a
    switch.
    """
    tracker = ByteTracker(max_lost_frames=20, reid_ttl=30.0, n_init=2)
    N_FRAMES = 100
    colors = [(200, 30, 30), (30, 200, 30), (30, 30, 200), (200, 200, 30), (200, 30, 200)]

    def obj0(f):  # left->right, fully occluded (no detection) frames 60-74
        if 60 <= f < 75:
            return None
        x = 20 + f * 3.5
        return (x, 200, x + 50, 320)

    def obj1(f):  # right->left, continuous, never occluded
        x = 600 - f * 3.5
        return (x, 200, x + 50, 320)

    def obj2(f):  # moves down, overlaps obj3 around frame 75
        y = 20 + f * 2.8
        return (250, y, 300, y + 80)

    def obj3(f):  # moves up, overlaps obj2 around frame 75
        y = 440 - f * 2.8
        return (260, y, 310, y + 80)

    def obj4(f):  # stationary for 40 frames, then starts moving
        if f < 40:
            return (400, 400, 450, 460)
        x = 400 + (f - 40) * 2
        return (x, 400, x + 50, 460)

    trajectories = [obj0, obj1, obj2, obj3, obj4]
    gt_track_id = {}
    switches = 0
    matched_object_frames = 0

    for f in range(N_FRAMES):
        gt_boxes = {}
        color_boxes = []
        for i, traj in enumerate(trajectories):
            raw = traj(f)
            if raw is None:
                continue
            bbox = tuple(int(v) for v in raw)
            gt_boxes[i] = bbox
            color_boxes.append((bbox, colors[i]))

        frame = make_frame(color_boxes)
        dets_in = [det(b) for b, _ in color_boxes]
        out = tracker.update(dets_in, frame=frame, frame_shape=(H, W), conf_thresh=0.25)

        gt_indices = list(gt_boxes.keys())
        if gt_indices and out:
            gt_centroids = [((gt_boxes[i][0] + gt_boxes[i][2]) / 2, (gt_boxes[i][1] + gt_boxes[i][3]) / 2) for i in gt_indices]
            out_centroids = [((t["bbox"]["x1"] + t["bbox"]["x2"]) / 2, (t["bbox"]["y1"] + t["bbox"]["y2"]) / 2) for t in out]
            cost = np.zeros((len(gt_indices), len(out_centroids)))
            for gi, gc in enumerate(gt_centroids):
                for oi, oc in enumerate(out_centroids):
                    cost[gi, oi] = np.hypot(gc[0] - oc[0], gc[1] - oc[1])
            rows, cols = linear_sum_assignment(cost)
            for r, c in zip(rows, cols):
                if cost[r, c] > 60:
                    continue
                obj_i = gt_indices[r]
                assigned_id = out[c]["track_id"]
                matched_object_frames += 1
                if obj_i in gt_track_id:
                    if gt_track_id[obj_i] != assigned_id:
                        switches += 1
                    gt_track_id[obj_i] = assigned_id
                else:
                    gt_track_id[obj_i] = assigned_id

    consistency = 1.0 - (switches / matched_object_frames)
    print(f"[id-consistency] switches={switches} matched_object_frames={matched_object_frames} consistency={consistency:.4f}")
    assert matched_object_frames > 300, "sanity check: most object-frames should have matched to a track"
    assert consistency >= 0.99, (
        f"ID consistency {consistency:.4f} below the 99% target "
        f"({switches} switches across {matched_object_frames} matched object-frames)"
    )
