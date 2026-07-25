# CamAI Enterprise - REST API & WebSocket Protocol Specification

---

> **Classification**: Enterprise API Specification  
> **Document Reference**: `DOC-API-06`  
> **Base URL**: `http://<server-ip>:8000`  
> **OpenAPI Endpoint**: `http://<server-ip>:8000/docs`

---

## 1. Authentication & Security

All REST API endpoints require a bearer JWT token in the HTTP Authorization header:
```http
Authorization: Bearer <your_jwt_access_token>
```

---

## 2. REST API Endpoints

### 2.1 System & Health
#### `GET /api/status`
Returns process-level resource metrics, GPU utilization, active camera pipelines, and engine uptime.

* **Response Example (`200 OK`)**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "active_cameras": 4,
  "cpu_percent": 18.5,
  "memory_percent": 42.1,
  "gpu_percent": 74.2,
  "gpu_stats": {
    "percent": 74.2,
    "mem_percent": 58.0,
    "temp_c": 62.0
  },
  "backend_device": "CUDA-FP16"
}
```

---

### 2.2 Camera Management
#### `GET /api/cameras`
Lists all registered camera profiles.

#### `POST /api/cameras`
Registers a new RTSP or MJPEG camera stream.

* **Request Body**:
```json
{
  "id": "cam_gate_01",
  "name": "Main Entrance Gate",
  "stream_url": "rtsp://admin:pass123@192.168.1.100:554/h264",
  "profile": "traffic",
  "target_fps": 30.0,
  "enabled": true
}
```

#### `PUT /api/cameras/{camera_id}/config`
Updates zone profiles, rule feature toggles, or vector geometries for a camera.

---

### 2.3 Incidents & Evidence
#### `GET /api/incidents`
Queries recorded incident clips and alerts.

* **Query Parameters**: `camera_id`, `type`, `limit`, `offset`, `start_date`, `end_date`
* **Response Example (`200 OK`)**:
```json
{
  "total": 142,
  "incidents": [
    {
      "id": "inc_982341",
      "camera_id": "cam_gate_01",
      "type": "overspeed",
      "message": "OVERSPEED: Car #41 at 78 km/h (Limit: 50 km/h) on Main Lane",
      "speed_kmh": 78.4,
      "speed_limit": 50.0,
      "clip_url": "/api/clips/inc_982341.mp4",
      "snapshot_url": "/api/snapshots/inc_982341.jpg",
      "timestamp": "2026-07-23T14:45:10Z"
    }
  ]
}
```

---

## 3. Real-Time Telemetry WebSocket Protocol

### `WS /ws/live/{camera_id}`
Establishes a high-frequency (25–60 Hz) bidirectional WebSocket connection for live telemetry streaming.

* **Server Broadcast Payload Example**:
```json
{
  "success": true,
  "people": 2,
  "vehicles": 4,
  "items": 0,
  "other_objects": 0,
  "detections": [
    {
      "id": "track_41",
      "class": "car",
      "confidence": 0.94,
      "speed": 78.4,
      "overspeed": true,
      "bbox": { "x1": 120, "y1": 240, "x2": 310, "y2": 410 }
    }
  ],
  "counters": {
    "in": 142,
    "out": 128,
    "vehicles_in": 110,
    "vehicles_out": 98
  },
  "latency": 24.5,
  "fps": 30.0,
  "target_fps": 30.0,
  "inference_latency": 14.2,
  "processing_time": 18.1,
  "decode_time": 2.4,
  "encode_time": 3.1,
  "queue_length": 0,
  "active_cameras": 4,
  "cpu": 18.5,
  "memory": 42.1,
  "gpu": 74.2,
  "gpu_memory": 58.0,
  "backend": "onnx",
  "device": "CUDA-FP16"
}
```
