# CamAI Enterprise - Source Code & Module Documentation

---

> **Classification**: Enterprise Technical & Developer Manual  
> **Document Reference**: `DOC-CODE-04`

---

## 1. Project Directory Structure

```
camAI/
├── client/                     # SaaS Web Portal Frontend (React 18, Vite, TailwindCSS)
│   ├── src/
│   │   ├── components/         # Reusable UI components & canvas overlays
│   │   ├── pages/              # Dashboard, Live Monitoring, Camera Config, Reports
│   │   ├── services/           # Supabase & REST API client integrations
│   │   └── utils/              # Geometry & canvas calculation helpers
├── desktop/                    # Desktop Monitoring Suite (Electron, React, TypeScript)
│   ├── src/
│   │   ├── components/         # FullscreenViewer, CCTVPlayer, DetectionOverlay
│   │   └── screens/            # Workspace multi-grid camera monitor
├── server/                     # Core Backend Engine (Python 3.11, FastAPI, OpenCV, ONNX)
│   ├── app/
│   │   ├── ai/                 # AI Engine, Models, Tile Governor, Tiling
│   │   │   ├── backend.py      # Multi-backend runner (TensorRT, CUDA, OpenVINO, DirectML)
│   │   │   ├── pipeline.py     # 5-stage CameraPipeline thread management
│   │   │   ├── tile_governor.py# Dynamic GPU load governor
│   │   │   ├── tiling.py       # Adaptive high-res tile cropper engine
│   │   │   ├── face.py         # YuNet face detection runner
│   │   │   ├── helmet.py       # Motorcycle helmet compliance model runner
│   │   │   ├── plate.py        # ANPR license plate detector
│   │   │   └── plate_ocr.py    # CRNN optical character recognition engine
│   │   ├── analytics.py        # Rule engine (Zones, Speed, Line Crossings)
│   │   ├── camera_manager.py   # Multi-camera process supervisor
│   │   ├── camera_test.py      # Camera health probe & discovery
│   │   ├── config.py           # Configuration manager & path resolutions
│   │   ├── gpu_monitor.py      # Background GPU sampler
│   │   ├── main.py             # FastAPI server REST & WebSocket routes
│   │   ├── recorder.py         # MP4 incident ring-buffer recorder
│   │   └── storage.py          # Snapshot & clip file storage manager
│   └── tests/                  # Automated pytest suite (211+ tests)
├── supabase/                   # Database schemas & migrations
└── docs/                       # Enterprise Technical Documentation Package
```

---

## 2. Core Python Backend Modules (`server/app/`)

### 2.1 `app/ai/backend.py` (`EngineBackend`)
- **Purpose**: Encapsulates model execution across hardware platforms (NVIDIA TensorRT, CUDA, OpenVINO GPU/CPU, DirectML, CPU ONNX Runtime).
- **Key Methods**:
  - `_backend_score(backend_type)`: Scores available acceleration providers to ensure fastest hardware runner is selected.
  - `_load_openvino(path)`: Compiles OpenVINO model with FP16 precision hint and disk compile caching.
  - `_load_onnx(path)`: Configures ONNX Runtime session with TensorRT / CUDA / DirectML provider fallback chain.
  - `run_inference(tensor)`: Performs forward pass on preprocessed float32/float16 input image tensor.

### 2.2 `app/ai/pipeline.py` (`CameraPipeline`)
- **Purpose**: Orchestrates asynchronous 5-stage pipeline per camera feed.
- **Sub-Threads**:
  1. `_capture_loop()`: Continuously reads frames from OpenCV `VideoCapture` or FFmpeg RTSP pipeline.
  2. `_decode_loop()`: Decodes NV12/BGR frame, calculates decode latency, pushes to `_decoded_slot`.
  3. `_ai_loop()`: Warm-up infer request, motion detection check, adaptive interval inference, calls `backend.run_inference()`.
  4. `_tracking_loop()`: Calls `ByteTrack.update()`, resolves track boxes, computes speed estimates, calls `CameraAnalytics.update()`.
  5. `_telemetry_loop()`: Constructs `latest_telemetry` dictionary and broadcasts to active WebSocket subscribers.

### 2.3 `app/analytics.py` (`CameraAnalytics`)
- **Purpose**: Evaluates spatial and temporal rules over detected tracks.
- **Key Features**:
  - `_speed_for()`: Computes vehicle speed in km/h using real-world physical object height constants (`CLASS_HEIGHT_M`), camera distance geometry, and 1D Kalman noise filters.
  - `filter_by_profile()`: Narrows detections based on active profile (`traffic`, `security`, `factory`).
  - `filter_by_features()`: Applies feature toggles (`speed_limit`, `helmet_detection`, `anpr`, `object_left_behind`).

### 2.4 `app/ai/tile_governor.py` (`ResourceGovernor`)
- **Purpose**: Closed-loop dynamic load balancer managing GPU allocations.
- **Key Classes**:
  - `ResourceGovernor`: Samples GPU utilization, VRAM %, external CPU, and GPU temperature.
  - `Allocation`: Dataclass specifying millisecond latency budget, max tile passes, and maximum input resolution allowed for the camera.

---

## 3. Desktop Application Components (`desktop/src/`)

### 3.1 `components/FullscreenViewer.tsx`
- **Purpose**: Provides high-framerate overlay view for selected camera.
- **Key Features**: Auto-reconnecting MJPEG stream, SVG/Canvas bounding box overlay, speed metric labels, and HUD telemetry status bar.

### 3.2 `components/CCTVPlayer.tsx`
- **Purpose**: Standard tile player component used in the multi-camera grid. Handles video stream lifecycle, paused state optimization, and fallback poster images.

---

## 4. Frontend SaaS Web Portal (`client/src/`)

### 4.1 `pages/LiveMonitoring.tsx`
- **Purpose**: Primary web monitoring page featuring dynamic grid selection, WebSocket telemetry listener, and interactive alert sidebar.

### 4.2 `components/ZoneEditor.tsx`
- **Purpose**: Canvas-based interactive vector editor allowing admins to draw intrusion zones, counting lines, and speed gate calibration lines over live stream snapshots.
