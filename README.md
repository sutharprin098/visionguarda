# CamAI — Enterprise Human Detection & Segmentation

A production-quality localhost web application for real-time AI human detection using your webcam, powered by **YOLO11n Seg** running locally on your machine.

---

## ✨ Features

- 🎥 **Live webcam** feed with 500ms frame capture
- 🔍 **YOLO11** person detection — bounding boxes, confidence scores
- 🎭 **Segmentation** mask overlay from local YOLO11n Seg
- 📊 **Enterprise dashboard** — 8 stat cards, activity feed, AI pipeline status
- 📂 **Detection history** — browse, expand, download JSON
- 📋 **API logs** — full request log table
- ⚙️ **Settings** — capture interval, quality, toggles
- 🌙 **Dark / Light mode** with system preference detection
- ⚡ **Single-request lock** — never freezes the UI

---

## 🚀 Quick Start

### 1. Prerequisites

- Node.js ≥ 18
- A local Python environment with the required packages installed

### 2. Clone & Install

```bash
cd d:\camAI

# Install root dependencies (concurrently)
npm install

# Install server + client dependencies
npm run install:all
```

### 3. Configure Environment

```bash
copy server\.env.example server\.env
```

Edit `server/.env`:

```env
PORT=3000
PYTHON_MODEL_PORT=5001
YOLO_MODEL_PATH=yolo11n-seg.pt
YOLO_CONFIDENCE=0.25
YOLO_IOU=0.45
YOLO_IMAGE_SIZE=640
```

Install Python dependencies and run the local model server:

```bash
python -m pip install -r server/server-requirements.txt
python server/python_model_server.py
```

### 4. Start

```bash
npm run dev
```

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3000

---

## 🧭 Usage

1. Open http://localhost:5173
2. Click **Live Camera** in the sidebar
3. Click **Start Camera** and allow browser camera permission
4. Click **Auto Detect ON** — frames are sent every 500ms
5. Watch bounding boxes and segmentation masks appear over detected humans

---

## 🏗️ Architecture

```
camAI/
├── client/                    # React 18 + Vite + TypeScript + Tailwind
│   └── src/
│       ├── components/
│       │   ├── camera/        # CameraFeed, DetectionOverlay
│       │   ├── dashboard/     # StatCard, AIStatusCard
│       │   ├── history/       # HistoryTable
│       │   ├── layout/        # Sidebar, Header
│       │   ├── logs/          # APILogs
│       │   └── settings/      # SettingsPanel
│       ├── hooks/             # useWebcam, useDetection, useHistory, useTheme
│       ├── pages/             # Dashboard, LiveCamera, History, APILogs, Settings
│       ├── types/             # Shared TypeScript interfaces
│       └── utils/             # api.ts (Axios), formatters.ts
│
└── server/                    # Express + TypeScript + local model proxy
    └── src/
        ├── routes/            # detect.ts, history.ts, status.ts
        ├── services/          # replicateService.ts (modular AI provider)
        │                      # storageService.ts (file-based JSON history)
        ├── types/             # Shared interfaces
        └── utils/             # imageUtils.ts
```

---

## 🔌 API Reference

### `POST /api/detect`
Upload a webcam frame for detection.

**Body**: `multipart/form-data` — field `image` (JPEG/PNG)

**Response**:
```json
{
  "success": true,
  "people": 1,
  "detections": [{ "class": "person", "confidence": 0.91, "bbox": { "x1":10, "y1":20, "x2":300, "y2":500 } }],
  "segmentedImage": "<base64>",
  "processingTime": 2800,
  "yoloLatency": 1200,
  "samLatency": 1600,
  "status": "human_found",
  "timestamp": "2026-07-08T01:00:00.000Z",
  "id": "uuid"
}
```

### `GET /api/history` — Full detection history
### `DELETE /api/history` — Clear history
### `GET /api/history/logs` — API request log
### `DELETE /api/history/logs` — Clear logs
### `GET /api/status` — Server health

---

## 🔧 Swapping to a Self-Hosted Model

The local Python model is proxyed through `server/src/services/replicateService.ts` to `server/python_model_server.py`.

If you want to swap the local backend to a different inference provider, update the `AIProvider` implementation in `server/src/services/replicateService.ts`.

No route or controller code changes are required.

---

## 🛠️ Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start both server + client |
| `npm run install:all` | Install all dependencies |
| `npm run build` | Build both for production |

---

## 📝 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | Optional | Server port (default: 3000) |
| `PYTHON_MODEL_PORT` | Optional | Local Python model server port (default: 5001) |
| `YOLO_MODEL_PATH` | Optional | Local YOLO model path (default: yolo11n-seg.pt) |

---

## 🤖 Models

| Model | Purpose | Deployment |
|---|---|---|
| YOLO11n Seg | Person detection + segmentation | Local Python model |
