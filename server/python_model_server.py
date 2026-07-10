import base64
import io
import os
import time
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image
from ultralytics import YOLO
import torch

MODEL_PATH = os.environ.get('YOLO_MODEL_PATH', 'yolo11n-seg.pt')
MODEL_CONFIDENCE = float(os.environ.get('YOLO_CONFIDENCE', '0.25'))
MODEL_IOU = float(os.environ.get('YOLO_IOU', '0.45'))
MODEL_SIZE = int(os.environ.get('YOLO_IMAGE_SIZE', '640'))

app = FastAPI(title='CamAI Local YOLO11n Seg Server')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

class DetectRequest(BaseModel):
    image: str
    mimeType: Optional[str] = 'image/jpeg'

class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

class PersonDetection(BaseModel):
    class_name: str = Field(..., alias='class')
    confidence: float
    bbox: BoundingBox
    trackId: int

    class Config:
        allow_population_by_field_name = True

class DetectResponse(BaseModel):
    success: bool
    detections: List[PersonDetection]
    segmentedImage: Optional[str]
    latency: int
    fps: float

model: Optional[YOLO] = None
last_durations: List[float] = []
MODEL_LOADED: bool = False


def load_model() -> YOLO:
    global model
    if model is not None:
        return model

    print(f'[PythonModel] Loading YOLO model from {MODEL_PATH}...')
    # Some torch versions restrict globals during unpickling; allowlist Ultralytics SegmentationModel
    try:
        ser = getattr(torch, 'serialization', None)
        safe_list = []
        try:
            import importlib
            # Collect classes from ultralytics internals that are often present in seg checkpoints
            for mod_name in ('ultralytics.nn', 'ultralytics.nn.modules', 'ultralytics.nn.tasks'):
                try:
                    mod = importlib.import_module(mod_name)
                    for attr in dir(mod):
                        obj = getattr(mod, attr)
                        if isinstance(obj, type):
                            safe_list.append(obj)
                except Exception:
                    continue
        except Exception:
            pass

        # Add common torch.nn classes that may appear in pickles
        try:
            import torch.nn as _nn
            for attr in ('Module', 'Sequential', 'Conv2d', 'ConvTranspose2d', 'BatchNorm2d', 'Linear', 'ReLU'):
                if hasattr(_nn, attr):
                    safe_list.append(getattr(_nn, attr))
            # also include container.Sequential if present
            try:
                if hasattr(_nn.modules, 'container') and hasattr(_nn.modules.container, 'Sequential'):
                    safe_list.append(_nn.modules.container.Sequential)
            except Exception:
                pass
        except Exception:
            pass

        if ser is not None and safe_list:
            try:
                if hasattr(ser, 'add_safe_globals'):
                    ser.add_safe_globals(list(dict.fromkeys(safe_list)))
            except Exception:
                pass
    except Exception:
        pass

    try:
        model = YOLO(MODEL_PATH)
        MODEL_LOADED = True
        print('[PythonModel] Model loaded successfully.')
        return model
    except Exception as e:
        MODEL_LOADED = False
        print(f'[PythonModel] Failed to load model: {e}')
        print('[PythonModel] Continuing without model (fallback mode).')
        return None


def decode_image(data_uri: str) -> np.ndarray:
    if data_uri.startswith('data:'):
        _, b64 = data_uri.split(',', 1)
    else:
        b64 = data_uri
    image_bytes = base64.b64decode(b64)
    return np.array(Image.open(io.BytesIO(image_bytes)).convert('RGB'))


def encode_image_to_base64(image: np.ndarray) -> str:
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(image_rgb)
    with io.BytesIO() as buffer:
        pil_img.save(buffer, format='PNG')
        encoded = base64.b64encode(buffer.getvalue()).decode('utf-8')
    return encoded


def build_overlay(image: np.ndarray, masks: np.ndarray) -> np.ndarray:
    overlay = image.copy()
    height, width = image.shape[:2]
    combined_mask = np.zeros((height, width), dtype=np.uint8)
    for mask in masks:
        mask_bool = mask.astype(bool)
        overlay[mask_bool] = [0, 255, 0]
        combined_mask = np.logical_or(combined_mask, mask_bool)

    alpha = (combined_mask.astype(np.float32) * 0.45)[..., None]
    overlay = (image.astype(np.float32) * (1.0 - alpha) + overlay.astype(np.float32) * alpha).astype(np.uint8)
    return overlay


def get_detection_payload(result: Any, original_shape: tuple) -> List[Dict[str, Any]]:
    detections: List[Dict[str, Any]] = []

    boxes = getattr(result, 'boxes', None)
    masks = getattr(result, 'masks', None)

    if boxes is None:
        return detections

    xyxy = None
    confidence = None
    classes = None

    if hasattr(boxes, 'xyxy'):
        xyxy = boxes.xyxy
    elif hasattr(boxes, 'data'):
        xyxy = boxes.data[:, :4]

    if hasattr(boxes, 'conf'):
        confidence = boxes.conf
    if hasattr(boxes, 'cls'):
        classes = boxes.cls

    if xyxy is None:
        return detections

    xyxy_np = np.asarray(xyxy)
    conf_np = np.asarray(confidence) if confidence is not None else np.zeros((xyxy_np.shape[0],))
    class_np = np.asarray(classes) if classes is not None else np.zeros((xyxy_np.shape[0],))

    person_index = 0
    for idx, (coords, conf_val, class_val) in enumerate(zip(xyxy_np, conf_np, class_np)):
        if conf_val < MODEL_CONFIDENCE:
            continue

        class_name = 'person' if int(class_val) == 0 else str(class_val)
        if class_name != 'person':
            continue

        x1, y1, x2, y2 = coords.tolist()
        if x2 <= x1 or y2 <= y1:
            continue

        detections.append({
            'class': class_name,
            'confidence': float(conf_val),
            'bbox': {
                'x1': float(x1),
                'y1': float(y1),
                'x2': float(x2),
                'y2': float(y2),
            },
            'trackId': person_index,
        })
        person_index += 1

    return detections


@app.on_event('startup')
def startup_event() -> None:
    load_model()


@app.get('/health')
def health() -> dict:
    return {'status': 'ok', 'model': MODEL_PATH, 'modelLoaded': MODEL_LOADED}


@app.post('/detect', response_model=DetectResponse)
def detect(request: DetectRequest) -> DetectResponse:
    try:
        image_np = decode_image(request.image)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'Invalid image data: {exc}')

    # If model failed to load, return an empty-but-successful response so the backend can continue
    local_model = load_model()
    if local_model is None:
        return DetectResponse(
            success=True,
            detections=[],
            segmentedImage=None,
            latency=0,
            fps=0.0,
        )

    start = time.time()

    results = local_model(image_np, imgsz=MODEL_SIZE, conf=MODEL_CONFIDENCE, iou=MODEL_IOU, classes=[0], device='cpu')
    duration_ms = int((time.time() - start) * 1000)

    result = results[0]
    detections = get_detection_payload(result, image_np.shape)

    segmented_image = None
    try:
        masks = getattr(result, 'masks', None)
        if masks is not None:
            mask_data = getattr(masks, 'data', None)
            if mask_data is not None:
                mask_array = np.asarray(mask_data)
                if mask_array.ndim == 2:
                    mask_array = mask_array[np.newaxis, ...]
                if mask_array.shape[0] > 0:
                    overlay = build_overlay(image_np, mask_array)
                    segmented_image = encode_image_to_base64(overlay)
    except Exception:
        segmented_image = None

    if len(last_durations) >= 50:
        last_durations.pop(0)
    last_durations.append(duration_ms)
    avg_fps = 1000.0 / (sum(last_durations) / len(last_durations)) if last_durations else 0.0

    return DetectResponse(
        success=True,
        detections=[PersonDetection(**det) for det in detections],
        segmentedImage=segmented_image,
        latency=duration_ms,
        fps=round(avg_fps, 2),
    )


if __name__ == '__main__':
    import uvicorn
    port = int(os.environ.get('PYTHON_MODEL_PORT', '5001'))
    uvicorn.run('python_model_server:app', host='127.0.0.1', port=port, log_level='info')
