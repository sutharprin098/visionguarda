import os
import sys
import cv2
import numpy as np
import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.ai.custom_detector import (
    register_custom_model,
    list_custom_models,
    toggle_custom_model,
    delete_custom_model,
    match_crop
)

def test_multi_custom_detector_lifecycle():
    # 1. Generate 2 synthetic test images for Model A ("Box Model")
    img_a1 = np.full((300, 300, 3), (50, 100, 200), dtype=np.uint8)
    img_a2 = np.full((300, 300, 3), (55, 105, 205), dtype=np.uint8)
    
    _, buf_a1 = cv2.imencode(".jpg", img_a1)
    _, buf_a2 = cv2.imencode(".jpg", img_a2)
    
    meta_a = register_custom_model("Box Model", [buf_a1.tobytes(), buf_a2.tobytes()])
    assert meta_a["name"] == "Box Model"
    assert meta_a["reference_count"] == 2
    assert meta_a["active"] is True
    model_a_id = meta_a["id"]
    
    # 2. Generate test image for Model B ("Bottle Model")
    img_b1 = np.full((300, 300, 3), (220, 40, 10), dtype=np.uint8)
    _, buf_b1 = cv2.imencode(".jpg", img_b1)
    meta_b = register_custom_model("Bottle Model", [buf_b1.tobytes()])
    assert meta_b["name"] == "Bottle Model"
    model_b_id = meta_b["id"]
    
    # 3. List models
    models = list_custom_models()
    model_ids = [m["id"] for m in models]
    assert model_a_id in model_ids
    assert model_b_id in model_ids
    
    # 4. Test Crop Matching against Model A
    is_match_a, score_a, name_a = match_crop(img_a1, threshold=0.55)
    assert is_match_a is True
    assert name_a == "Box Model"
    assert score_a > 0.55
    
    # 5. Toggle Model A to inactive and test matching
    toggle_custom_model(model_a_id, False)
    is_match_deactive, _, name_deactive = match_crop(img_a1, threshold=0.55)
    # Box Model is inactive, so img_a1 should not match Box Model
    assert name_deactive != "Box Model"
    
    # 6. Reactivate Model A
    toggle_custom_model(model_a_id, True)
    is_match_reactivated, _, name_reactivated = match_crop(img_a1, threshold=0.55)
    assert is_match_reactivated is True
    assert name_reactivated == "Box Model"
    
    # 7. Cleanup created test models
    delete_custom_model(model_a_id)
    delete_custom_model(model_b_id)
    
    remaining_ids = [m["id"] for m in list_custom_models()]
    assert model_a_id not in remaining_ids
    assert model_b_id not in remaining_ids
