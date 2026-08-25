import os
import cv2
import json
import uuid
import time
import numpy as np
import torch
import threading
from PIL import Image
from torchvision import models, transforms

# Base directory for custom models
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(CURRENT_DIR, "custom_models")
META_FILE = os.path.join(CURRENT_DIR, "custom_models_meta.json")

# Legacy single-file path (for migration)
LEGACY_EMBEDDINGS_FILE = os.path.join(CURRENT_DIR, "custom_model_embeddings.npy")

os.makedirs(MODELS_DIR, exist_ok=True)

_model_lock = threading.Lock()
_feature_extractor = None
_preprocess = None
_device = None

# In-memory cache of multi-model embeddings and metadata
# _cached_models = { model_id: { "meta": dict, "embeddings": np.ndarray } }
_cached_models = {}
_cache_lock = threading.Lock()
_cache_initialized = False


def _init_model():
    """Lazy initialization of the MobileNetV3 feature extractor."""
    global _feature_extractor, _preprocess, _device
    with _model_lock:
        if _feature_extractor is not None:
            return
        
        _device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[CustomDetector] Initializing MobileNetV3 on {_device}...")
        
        _feature_extractor = models.mobilenet_v3_large(pretrained=True).to(_device)
        _feature_extractor.eval()
        
        _preprocess = transforms.Compose([
            transforms.Resize(224),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ])


def get_embedding(img_bgr):
    """Extracts a 960-dimensional unit-normalized feature vector from a BGR image crop."""
    _init_model()
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    
    tensor = _preprocess(pil_img).unsqueeze(0).to(_device)
    with torch.no_grad():
        features = _feature_extractor.features(tensor)
        features = torch.nn.functional.adaptive_avg_pool2d(features, (1, 1))
        features = torch.flatten(features, 1)
        
    embedding = features[0].cpu().numpy()
    norm = np.linalg.norm(embedding)
    if norm > 1e-8:
        embedding = embedding / norm
    return embedding


def _load_meta():
    if os.path.exists(META_FILE):
        try:
            with open(META_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[CustomDetector] Error reading metadata file: {e}")
    return []


def _save_meta(meta_list):
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta_list, f, indent=2)


def _ensure_cache_loaded(force_reload=False):
    global _cached_models, _cache_initialized
    with _cache_lock:
        if _cache_initialized and not force_reload:
            return
        
        meta_list = _load_meta()
        new_cached = {}
        
        # Check legacy migration if meta_list is empty and legacy file exists
        if not meta_list and os.path.exists(LEGACY_EMBEDDINGS_FILE):
            try:
                legacy_arr = np.load(LEGACY_EMBEDDINGS_FILE)
                legacy_id = "model_legacy_default"
                legacy_path = os.path.join(MODELS_DIR, f"{legacy_id}.npy")
                np.save(legacy_path, legacy_arr)
                legacy_meta = {
                    "id": legacy_id,
                    "name": "Custom Product",
                    "active": True,
                    "reference_count": int(legacy_arr.shape[0]),
                    "created_at": time.time()
                }
                meta_list.append(legacy_meta)
                _save_meta(meta_list)
                print("[CustomDetector] Migrated legacy embeddings into multi-model store.")
            except Exception as e:
                print(f"[CustomDetector] Legacy migration failed: {e}")

        for meta in meta_list:
            model_id = meta["id"]
            npy_path = os.path.join(MODELS_DIR, f"{model_id}.npy")
            if os.path.exists(npy_path):
                try:
                    arr = np.load(npy_path)
                    new_cached[model_id] = {
                        "meta": meta,
                        "embeddings": arr
                    }
                except Exception as e:
                    print(f"[CustomDetector] Error loading model {model_id}: {e}")

        _cached_models = new_cached
        _cache_initialized = True
        print(f"[CustomDetector] Cache loaded with {len(_cached_models)} models.")


def list_custom_models():
    """Lists metadata of all registered custom models."""
    _ensure_cache_loaded()
    with _cache_lock:
        return [item["meta"] for item in _cached_models.values()]


def register_custom_model(name, images_data):
    """
    Extracts embeddings for a list of image bytes and registers a new named model.
    """
    _init_model()
    if not name or not name.strip():
        name = f"Custom Product {time.strftime('%H:%M:%S')}"
    else:
        name = name.strip()

    embeddings = []
    for idx, img_bytes in enumerate(images_data):
        nparr = np.frombuffer(img_bytes, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            print(f"[CustomDetector] Failed to decode image index {idx}")
            continue
        emb = get_embedding(img_bgr)
        embeddings.append(emb)

    if not embeddings:
        raise ValueError("No valid images could be decoded to register the model.")

    embeddings_arr = np.array(embeddings, dtype=np.float32)
    model_id = f"model_{uuid.uuid4().hex[:8]}"
    npy_path = os.path.join(MODELS_DIR, f"{model_id}.npy")
    
    np.save(npy_path, embeddings_arr)

    model_meta = {
        "id": model_id,
        "name": name,
        "active": True,
        "reference_count": len(embeddings),
        "created_at": time.time()
    }

    meta_list = _load_meta()
    meta_list.append(model_meta)
    _save_meta(meta_list)

    with _cache_lock:
        _cached_models[model_id] = {
            "meta": model_meta,
            "embeddings": embeddings_arr
        }

    print(f"[CustomDetector] Registered model '{name}' (ID: {model_id}) with {len(embeddings)} reference images.")
    return model_meta


def register_embeddings(images_data):
    """Legacy wrapper for registering embeddings under a default name."""
    meta = register_custom_model("Custom Product", images_data)
    return meta["reference_count"]


def toggle_custom_model(model_id, active):
    """Toggles active/inactive state of a model."""
    _ensure_cache_loaded()
    meta_list = _load_meta()
    target_meta = None
    for meta in meta_list:
        if meta["id"] == model_id:
            meta["active"] = bool(active)
            target_meta = meta
            break
            
    if target_meta is None:
        raise ValueError(f"Model ID '{model_id}' not found.")

    _save_meta(meta_list)

    with _cache_lock:
        if model_id in _cached_models:
            _cached_models[model_id]["meta"]["active"] = bool(active)

    return target_meta


def delete_custom_model(model_id):
    """Deletes a custom model by ID."""
    _ensure_cache_loaded()
    meta_list = _load_meta()
    meta_list = [m for m in meta_list if m["id"] != model_id]
    _save_meta(meta_list)

    npy_path = os.path.join(MODELS_DIR, f"{model_id}.npy")
    if os.path.exists(npy_path):
        try:
            os.remove(npy_path)
        except Exception as e:
            print(f"[CustomDetector] Failed to delete file {npy_path}: {e}")

    with _cache_lock:
        _cached_models.pop(model_id, None)

    print(f"[CustomDetector] Deleted model ID '{model_id}'.")
    return {"success": True, "deleted_id": model_id}


def load_embeddings(force_reload=False):
    """Backward compatibility helper returning concatenated active embeddings or None."""
    _ensure_cache_loaded(force_reload=force_reload)
    active_arrays = []
    with _cache_lock:
        for m in _cached_models.values():
            if m["meta"].get("active", True):
                active_arrays.append(m["embeddings"])
                
    if active_arrays:
        return np.vstack(active_arrays)
    return None


def get_custom_model_status():
    """Introspects overall custom models status."""
    models_meta = list_custom_models()
    active_models = [m for m in models_meta if m.get("active", True)]
    total_refs = sum(m["reference_count"] for m in active_models)
    latest_ts = max([m.get("created_at", 0) for m in active_models], default=None)
    
    return {
        "registered": len(active_models) > 0,
        "reference_count": total_refs,
        "total_models": len(models_meta),
        "active_models_count": len(active_models),
        "timestamp": latest_ts,
        "models": models_meta
    }


def has_active_custom_models():
    """Returns True if there is at least one active custom model loaded."""
    _ensure_cache_loaded()
    with _cache_lock:
        return any(m["meta"].get("active", True) for m in _cached_models.values())


def match_crop(crop_bgr, threshold=0.38):
    """
    Matches an incoming frame crop against all ACTIVE custom models.
    Returns: (is_match, similarity_score, matched_model_name)
    """
    _ensure_cache_loaded()
    
    with _cache_lock:
        active_entries = [m for m in _cached_models.values() if m["meta"].get("active", True)]
        
    if not active_entries:
        return False, 0.0, None
        
    crop_emb = get_embedding(crop_bgr)
    
    best_overall_score = -1.0
    winning_model_name = None
    
    for entry in active_entries:
        ref_pool = entry["embeddings"]
        model_name = entry["meta"]["name"]
        
        similarities = np.dot(ref_pool, crop_emb)
        best_sim = float(np.max(similarities))
        
        top_k = min(3, len(similarities))
        top_scores = np.partition(similarities, -top_k)[-top_k:]
        mean_sim = float(np.mean(top_scores))
        
        score_to_check = max(best_sim, mean_sim)
        
        if score_to_check > best_overall_score:
            best_overall_score = score_to_check
            winning_model_name = model_name

    if best_overall_score >= threshold:
        return True, best_overall_score, winning_model_name
        
    return False, best_overall_score, None
