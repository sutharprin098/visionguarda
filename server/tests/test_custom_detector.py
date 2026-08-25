import numpy as np
import pytest
import cv2
from fastapi.testclient import TestClient
from app.main import app, require_control_token
from app.ai import custom_detector

@pytest.fixture
def mock_detector_npy(tmp_path, monkeypatch):
    models_dir = tmp_path / "custom_models"
    meta_file = tmp_path / "custom_models_meta.json"
    legacy_file = tmp_path / "legacy_custom.npy"
    models_dir.mkdir(parents=True, exist_ok=True)
    
    monkeypatch.setattr(custom_detector, "MODELS_DIR", str(models_dir))
    monkeypatch.setattr(custom_detector, "META_FILE", str(meta_file))
    monkeypatch.setattr(custom_detector, "LEGACY_EMBEDDINGS_FILE", str(legacy_file))
    
    with custom_detector._cache_lock:
        custom_detector._cached_models = {}
        custom_detector._cache_initialized = False
    
    yield tmp_path
    
    with custom_detector._cache_lock:
        custom_detector._cached_models = {}
        custom_detector._cache_initialized = False

def test_custom_detector_registration_and_matching(mock_detector_npy):
    # Create fake images (RGB, 224x224x3)
    img1 = np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8)
    img2 = np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8)
    
    # Encode images to bytes
    _, bytes1 = cv2.imencode(".jpg", img1)
    _, bytes2 = cv2.imencode(".jpg", img2)
    
    # Initially no embeddings loaded
    assert custom_detector.load_embeddings() is None
    
    # Register reference images
    registered_count = custom_detector.register_embeddings([bytes1.tobytes(), bytes2.tobytes()])
    assert registered_count == 2
    
    # Verify loaded embeddings
    embeddings = custom_detector.load_embeddings()
    assert embeddings is not None
    assert len(embeddings) == 2
    assert embeddings.shape[1] == 960 # MobileNetV3 feature vector size
    
    # Match a crop
    is_match, similarity, matched_name = custom_detector.match_crop(img1, threshold=0.55)
    assert is_match is True
    assert similarity >= 0.55
    assert matched_name is not None

def test_api_endpoints(mock_detector_npy):
    # Enable bypass of control token for simplicity
    app.dependency_overrides[require_control_token] = lambda: None
    
    try:
        client = TestClient(app)
        
        # Get status initially
        response = client.get("/api/custom_model/status")
        assert response.status_code == 200
        assert response.json()["registered"] is False
        assert response.json()["reference_count"] == 0
        
        # Register custom model
        # Use dummy jpeg byte stream
        from io import BytesIO
        from PIL import Image
        
        file_bytes1 = BytesIO()
        Image.new("RGB", (224, 224), color="red").save(file_bytes1, format="JPEG")
        file_bytes1.seek(0)
        
        file_bytes2 = BytesIO()
        Image.new("RGB", (224, 224), color="blue").save(file_bytes2, format="JPEG")
        file_bytes2.seek(0)
        
        files = [
            ("files", ("image1.jpg", file_bytes1, "image/jpeg")),
            ("files", ("image2.jpg", file_bytes2, "image/jpeg")),
        ]
        
        response = client.post(
            "/api/custom_model/register",
            files=files,
            headers={"X-CamAI-Token": "test"} # Just to pass the dependency
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["registered_count"] == 2
        
        # Get status again
        response = client.get("/api/custom_model/status")
        assert response.status_code == 200
        data_status = response.json()
        assert data_status["registered"] is True
        assert data_status["reference_count"] == 2
        assert data_status["timestamp"] is not None
    finally:
        del app.dependency_overrides[require_control_token]
