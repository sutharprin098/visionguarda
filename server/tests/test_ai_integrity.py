import pytest
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.analytics import filter_by_features, filter_by_profile

def test_ai_pipeline_integrity():
    """
    STRICT INTEGRITY TEST: Ensures the AI inference logic is not bypassed.
    """
    mock_detections = [
        {"bbox": {"x1": 10, "y1": 10, "x2": 50, "y2": 50}, "class": "person", "confidence": 0.88},
        {"bbox": {"x1": 100, "y1": 100, "x2": 200, "y2": 200}, "class": "car", "confidence": 0.95}
    ]
    
    filtered = filter_by_profile(mock_detections, "security")
    assert len(filtered) > 0, "CRITICAL ERROR: AI detections are being dropped blindly"
    
    features = {"person_detection": {"enabled": True}, "vehicle_detection": {"enabled": True}}
    filtered_features = filter_by_features(filtered, features)
    assert len(filtered_features) == 2, "CRITICAL ERROR: AI detections are being dropped. AI BYPASS DETECTED."

def test_no_ai_bypass_in_code():
    """
    Fails if anyone commits 'bypass AI' or 'disable inference' in pipeline.py
    """
    pipeline_path = os.path.join(os.path.dirname(__file__), '..', 'app', 'ai', 'pipeline.py')
    if os.path.exists(pipeline_path):
        with open(pipeline_path, 'r', encoding='utf-8') as f:
            content = f.read()
        phrase1 = "by" + "pass ai inf" + "erence"
        phrase2 = "dis" + "able detec" + "tions"
        assert phrase1 not in content, "FATAL: AI Inference bypass code detected!"
        assert phrase2 not in content, "FATAL: Code to dis" + "able detec" + "tions found!"


