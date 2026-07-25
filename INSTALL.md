# CamAI Enterprise - Quick Installation Guide

---

## Environment Prerequisites

- **Python**: 3.11+
- **Node.js**: 18+ or 20+
- **FFmpeg**: Must be installed and accessible on environment PATH.

---

## 1. Quick Local Development Setup

### Backend Core Server
```bash
cd server
python -m venv venv

# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
python -m app.main
```
Server runs on `http://127.0.0.1:8000`.

### Desktop Monitor Application
```bash
cd desktop
npm install
npm run dev
```

### Web SaaS Portal
```bash
cd client
npm install
npm run dev
```

---

## 2. Docker Deployment

Deploy all services using Docker Compose:
```bash
docker-compose up -d --build
```
- **Web SaaS Portal**: `http://localhost:3000`
- **FastAPI Core Engine**: `http://localhost:8000`
- **API Documentation**: `http://localhost:8000/docs`
