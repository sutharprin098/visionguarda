# CamAI Enterprise - Testing & Troubleshooting Guide

---

> **Classification**: Enterprise Quality Assurance & Support Manual  
> **Document Reference**: `DOC-TEST-13`

---

## 1. Automated Test Suite

CamAI Enterprise features a 211+ automated test suite covering analytics rules, backend inference, pipeline frame buffers, and camera configuration contracts:

```bash
cd server
pytest
```

---

## 2. Troubleshooting Matrix

| Issue Symptom | Probable Cause | Diagnostic & Solution |
| :--- | :--- | :--- |
| **Black Screen / Feed Drops** | Network loss / RTSP stream disconnect | Auto-reconnection loop in `CCTVPlayer.tsx` and `FullscreenViewer.tsx` automatically retries stream generation |
| **Speed Metrics Not Displaying** | Uncalibrated camera reference geometry | Speed calculation falls back to height-based estimation automatically unless explicitly disabled in profile features |
| **Low FPS / Video Stutter** | Heavy multi-stream GPU saturation | Check `ResourceGovernor` status in `/api/status`. Ensure `CAMAI_FORCE_GPU=1` environment variable is set |
| **Model Load Failure** | Missing ONNX weights / corrupted file | Inspect `server/models/`. System auto-falls back to available ONNX or OpenVINO model artifacts |
