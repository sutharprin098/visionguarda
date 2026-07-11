from app.ai.backend import COCO_CLASS_MAP, _passes_geometry_filter


def test_coco_detector_includes_available_traffic_classes():
    assert COCO_CLASS_MAP[9] == "traffic_light"
    assert COCO_CLASS_MAP[11] == "stop_sign"


def test_traffic_sign_geometry_filter_accepts_small_distant_objects():
    assert _passes_geometry_filter("traffic_light", 100, 80, 108, 120, 1920, 1080)
    assert _passes_geometry_filter("stop_sign", 500, 300, 540, 340, 1920, 1080)
