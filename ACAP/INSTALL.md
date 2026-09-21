# CamAI ACAP Installation Guide

This guide describes how to install, configure, and verify **CamAI ACAP** on target AXIS network cameras running AXIS OS 11.0+.

---

## Prerequisites

1. Supported AXIS Camera device (e.g. AXIS P3268-LV, Q3536-LVE on ARTPEC-8 architecture).
2. AXIS OS version 11.0 or higher.
3. Network access to the camera's Web interface (HTTPS) or VAPIX API.
4. Administrator credentials (`root`).
5. Compiled `.eap` package (`camai_acap_1_0_0_aarch64.eap`).

---

## Installation Steps

### Option A: Via Camera Web Interface (GUI)

1. Log into the AXIS camera Web UI (`https://<camera-ip>`).
2. Navigate to **System** -> **Apps**.
3. Click **Add App** and browse to select `camai_acap_1_0_0_aarch64.eap`.
4. Click **Install**.
5. Once installed, toggle the application switch to **Start**.
6. Verify status displays **Running**.

---

### Option B: Via AXIS VAPIX API (Command Line)

You can deploy the package remotely over cURL:

```bash
curl -k --user root:<password> \
  -F "packager=@camai_acap_1_0_0_aarch64.eap" \
  "https://<camera-ip>/axis-cgi/applications/control.cgi?action=install"
```

To start the application:

```bash
curl -k --user root:<password> \
  "https://<camera-ip>/axis-cgi/applications/control.cgi?action=start&package=camai_acap"
```

---

## Configuration via Web UI / axparameter

Once started, CamAI ACAP settings appear in the camera parameter interface:

- `ConfidenceThreshold`: Detection score threshold (Default: `0.45`)
- `EnableSecurityModule`: Enable Intrusion & Line Crossing rules (`true` / `false`)
- `EnableOverlay`: Enable live bounding box stream overlays (`true` / `false`)
- `IntrusionROICoords`: Polygon coordinates formatted as `x1,y1;x2,y2;x3,y3;x4,y4`
- `TripwireCoords`: Line coordinates formatted as `x1,y1;x2,y2`

---

## Verification & Health Check

Inspect application logs via VAPIX syslog:

```bash
curl -k --user root:<password> \
  "https://<camera-ip>/axis-cgi/systemlog.cgi?appname=camai_acap"
```

Expected log output:
```
[CamAIEngine] AXIS VDO Stream initialized: 1920x1080@15FPS
[InferenceEngine] Successfully loaded model via AXIS Larod: models/yolox_tiny.onnx
[CamAIEngine] Pipeline worker thread running
[CamAI Telemetry] FPS: 15.0 | Latency: 12.4 ms | Processed: 450 | Dropped: 0 | RAM: 112/256 MB
```
