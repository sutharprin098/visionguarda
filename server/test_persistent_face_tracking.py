#!/usr/bin/env python3
"""Verification test for Persistent Face & Body Tracking in CamAI.

Validates:
1. Target Face Match -> Track #1 created and tagged as `TARGET: Prince`.
2. Face Disappears (Person turns around, only body visible) -> Hungarian matcher pairs track, Track #1 keeps identity `TARGET: Prince` (ReID active, face_matched=False).
3. Continuous person tracking without face -> Track #1 is maintained across multiple frames.
4. Face Reappears -> Track #1 absorbs the face detection and maintains Track #1 without minting duplicate Track #2.
"""
import sys
import numpy as np
from app.ai.pipeline import ByteTracker, resolve_emitted_detections

def test_persistent_face_tracking():
    print("==================================================")
    print("TEST: Persistent Face & Body Tracking Lifecycle")
    print("==================================================")
    
    tracker = ByteTracker(max_lost_seconds=2.0, reid_ttl=15.0, n_init=1)
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame_shape = (480, 640)
    
    # ----------------------------------------------------
    # Phase 1: Frame 1 - Person enters with face visible
    # ----------------------------------------------------
    det_f1 = [{
        "class": "TARGET: Prince",
        "confidence": 0.88,
        "bbox": {"x1": 100, "y1": 100, "x2": 200, "y2": 350},
        "custom_match": True,
        "target_name": "Prince",
        "target_id": "tgt_001",
        "track_label": "TARGET: Prince (88%)",
        "face_matched": True
    }]
    
    tracks_raw_1 = tracker.update(det_f1, frame=frame, frame_shape=frame_shape, conf_thresh=0.20, dt=0.04)
    emitted_1, _ = resolve_emitted_detections(tracker, tracks_raw_1, det_f1, [])
    
    assert len(emitted_1) == 1, f"Expected 1 emitted detection, got {len(emitted_1)}"
    track_id_1 = emitted_1[0]["track_id"]
    print(f"Frame 1: Person entered with face -> Track #{track_id_1}, Class: {emitted_1[0]['class']}, Target: {emitted_1[0].get('target_name')}, Face Matched: {emitted_1[0].get('face_matched')}")
    assert emitted_1[0].get("target_name") == "Prince"
    assert emitted_1[0].get("face_matched") is True
    
    # ----------------------------------------------------
    # Phase 2: Frames 2-6 - Person turns around (NO face visible, only generic 'person' detected)
    # ----------------------------------------------------
    print("\nPhase 2: Person turns around (Face invisible, YOLOX emits generic 'person')...")
    for frame_idx in range(2, 7):
        # Body moves slightly to the right
        x_shift = (frame_idx - 1) * 5
        det_person_only = [{
            "class": "person",  # Generic detector output (no face match!)
            "confidence": 0.82,
            "bbox": {"x1": 100 + x_shift, "y1": 100, "x2": 200 + x_shift, "y2": 350},
        }]
        
        tracks_raw = tracker.update(det_person_only, frame=frame, frame_shape=frame_shape, conf_thresh=0.20, dt=0.04)
        emitted, _ = resolve_emitted_detections(tracker, tracks_raw, det_person_only, [])
        
        assert len(emitted) == 1, f"Frame {frame_idx}: Expected 1 detection, got {len(emitted)}"
        curr_tid = emitted[0]["track_id"]
        curr_cls = emitted[0]["class"]
        curr_tgt = emitted[0].get("target_name")
        reid_act = emitted[0].get("reid_active")
        face_m   = emitted[0].get("face_matched")
        
        print(f"Frame {frame_idx}: Track #{curr_tid}, Class: {curr_cls}, Target: {curr_tgt}, ReID Active: {reid_act}, Face Matched: {face_m}")
        assert curr_tid == track_id_1, f"ID switch detected! Expected {track_id_1}, got {curr_tid}"
        assert curr_tgt == "Prince", f"Target identity lost! Expected 'Prince', got '{curr_tgt}'"
        assert reid_act is True, "ReID active flag should be True"
        assert face_m is False, "Face matched flag should be False when person is turned away"

    # ----------------------------------------------------
    # Phase 3: Frame 7 - Person turns back around (Face visible again)
    # ----------------------------------------------------
    print("\nPhase 3: Person turns back toward camera (Face matches again)...")
    det_f7 = [{
        "class": "TARGET: Prince",
        "confidence": 0.91,
        "bbox": {"x1": 130, "y1": 100, "x2": 230, "y2": 350},
        "custom_match": True,
        "target_name": "Prince",
        "target_id": "tgt_001",
        "track_label": "TARGET: Prince (91%)",
        "face_matched": True
    }]
    tracks_raw_7 = tracker.update(det_f7, frame=frame, frame_shape=frame_shape, conf_thresh=0.20, dt=0.04)
    emitted_7, _ = resolve_emitted_detections(tracker, tracks_raw_7, det_f7, [])
    
    assert len(emitted_7) == 1, f"Expected 1 detection, got {len(emitted_7)}"
    assert emitted_7[0]["track_id"] == track_id_1, f"Duplicate track created on face reappearance! Expected {track_id_1}, got {emitted_7[0]['track_id']}"
    assert emitted_7[0].get("target_name") == "Prince"
    assert emitted_7[0].get("face_matched") is True
    print(f"Frame 7: Face Reappeared -> Track #{emitted_7[0]['track_id']}, Class: {emitted_7[0]['class']}, Face Matched: {emitted_7[0].get('face_matched')}")

    print("\n==================================================")
    print("SUCCESS: Persistent Face & Person Tracking verified perfectly!")
    print(f"Single Track ID #{track_id_1} persisted through all face appearances & disappearances.")
    print("==================================================")

if __name__ == "__main__":
    test_persistent_face_tracking()
