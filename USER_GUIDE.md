# CamAI Enterprise - User Guide

---

## Overview

Welcome to the **CamAI Enterprise User Manual**. This guide provides step-by-step instructions for operators, security analysts, and facility administrators using the CamAI Enterprise monitoring suite.

---

## 1. Getting Started

### 1.1 Launching the Application
- **Desktop Application**: Launch `CamAI Enterprise.exe` from your desktop or Start menu.
- **Web SaaS Portal**: Open your browser and navigate to `http://<server-ip>:3000` or your enterprise portal domain.
- **Login**: Enter your corporate credentials (Email & Password).

---

## 2. Navigating the Interface

```
+-----------------------------------------------------------------------+
|  CamAI Enterprise [Live Monitor]             [Grid: 2x2 v] [Admin]    |
+-----------------------------------------------------------------------+
| +-------------------------+  +-------------------------+              |
| | Camera 1 - Main Gate    |  | Camera 2 - Highway 401   |              |
| | [LIVE] 30 FPS           |  | [LIVE] 30 FPS           |              |
| | Car: 48 km/h            |  | Truck: 62 km/h (ALERT)  |              |
| +-------------------------+  +-------------------------+              |
| +-------------------------+  +-------------------------+              |
| | Camera 3 - Lobby East   |  | Camera 4 - Warehouse    |              |
| | [LIVE] 30 FPS           |  | [LIVE] 30 FPS           |              |
| | Person: 3               |  | No Helmet Alert         |              |
| +-------------------------+  +-------------------------+              |
+-----------------------------------------------------------------------+
| System Status: GPU 74% | CPU 22% | RAM 4.2GB | Active Cameras: 4       |
+-----------------------------------------------------------------------+
```

### 2.1 Top Navigation Bar
- **Live Monitor**: Primary multi-grid stream viewing screen.
- **Incidents & Alerts**: Searchable table of triggered security and traffic events.
- **Analytics & Reports**: Historical charts, heatmaps, and traffic density graphs.
- **Camera Management**: Register, configure, and calibrate camera feeds.
- **Admin Studio**: System health gauges, user management, and AI settings.

---

## 3. Live Monitoring & Fullscreen Viewer

### 3.1 Grid Controls
- Use the **Grid Density Selector** (top right) to toggle between `1x1`, `2x2`, `3x3`, or `4x4` camera displays.
- Cameras auto-reconnect if temporary network drops occur.

### 3.2 Fullscreen Interactive Mode
- Double-click any camera tile to open **Fullscreen View**.
- **Bounding Boxes**: Green boxes represent tracked vehicles/people; Red boxes highlight rule violations (overspeeding, missing helmet, zone breach).
- **Speed Metric Overlay**: Live vehicle speeds are rendered as `45 km/h` above vehicle bounding boxes.
- **HUD Performance Bar**: View real-time pipeline FPS, decode latency, AI inference latency, and hardware resource stats.

---

## 4. Viewing Incidents & Exporting Evidence

1. Navigate to the **Incidents** tab.
2. Filter events by **Camera Name**, **Violation Type** (`Overspeed`, `No Helmet`, `ANPR`, `Intrusion`), or **Date Range**.
3. Click any incident row to open the **Evidence Viewer**:
   - Preview the high-resolution snapshot image with highlighted bounding box.
   - Play the 10-second recorded MP4 video clip.
   - Click **Export Clip** to save evidence to your local computer.

---

## 5. Setting Up Zones & Detection Rules

1. Navigate to **Camera Management** -> Select Camera -> Click **Edit Zones & Rules**.
2. **Adding a Zone**:
   - Select **Intrusion Zone** or **Counting Zone**.
   - Click on the camera canvas to place polygon vertices. Click the initial vertex to close the shape.
3. **Setting a Speed Gate**:
   - Draw Line 1 and Line 2 across the road.
   - Input physical distance between lines (e.g. `10.0 meters`).
   - Set the camera **Speed Limit** (e.g. `50 km/h`).
4. Click **Save Configuration**. The AI engine updates rules dynamically without requiring a system restart.
