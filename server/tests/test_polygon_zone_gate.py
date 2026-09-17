"""Unit test suite for strict Polygon Zone Containment and Exclusion filtering."""

import pytest
from app.analytics import _point_in_zone_shape, filter_detections_by_user_zones


def test_point_in_polygon_exact_scaling():
    # Polygon covering normalized region [0.2, 0.2] to [0.8, 0.8]
    poly_pts = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]
    
    # Inside point
    assert _point_in_zone_shape(0.5, 0.5, poly_pts, "polygon", 1920, 1080) is True
    
    # Outside point
    assert _point_in_zone_shape(0.1, 0.1, poly_pts, "polygon", 1920, 1080) is False
    assert _point_in_zone_shape(0.9, 0.9, poly_pts, "polygon", 1920, 1080) is False


def test_filter_detections_by_user_zones_inclusion():
    zones = [
        {
            "id": "zone_A",
            "name": "Intrusion Zone A",
            "zoneType": "intrusion",
            "shapeType": "polygon",
            "points": [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5], [0.2, 0.5]],
        }
    ]

    detections = [
        # Inside zone_A (x1=0.25, y1=0.25, x2=0.35, y2=0.35 -> centroid 0.3, 0.3)
        {"id": 1, "class": "person", "bbox": {"x1": 480, "y1": 270, "x2": 672, "y2": 378}},
        # Outside zone_A (centroid 0.8, 0.8)
        {"id": 2, "class": "car", "bbox": {"x1": 1440, "y1": 810, "x2": 1632, "y2": 918}},
    ]

    filtered = filter_detections_by_user_zones(detections, zones, frame_w=1920, frame_h=1080)
    assert len(filtered) == 1
    assert filtered[0]["id"] == 1


def test_filter_detections_by_user_zones_privacy_mask():
    zones = [
        {
            "id": "mask_1",
            "name": "Privacy Mask",
            "zoneType": "privacy_mask",
            "shapeType": "polygon",
            "points": [[0.0, 0.0], [0.3, 0.0], [0.3, 0.3], [0.0, 0.3]],
        }
    ]

    detections = [
        # Inside privacy mask (centroid 0.15, 0.15) -> must be dropped
        {"id": 1, "class": "person", "bbox": {"x1": 192, "y1": 108, "x2": 384, "y2": 216}},
        # Outside privacy mask (centroid 0.6, 0.6) -> must be kept
        {"id": 2, "class": "person", "bbox": {"x1": 1056, "y1": 594, "x2": 1248, "y2": 702}},
    ]

    filtered = filter_detections_by_user_zones(detections, zones, frame_w=1920, frame_h=1080)
    assert len(filtered) == 1
    assert filtered[0]["id"] == 2
