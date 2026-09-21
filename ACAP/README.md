# CamAI ACAP Native Application

**CamAI ACAP** is a high-performance, modular edge-AI surveillance analytics application built on the official **AXIS Camera Application Platform (ACAP) Native SDK**. It runs directly inside supported AXIS network camera devices (e.g. ARTPEC-8 / ARTPEC-7 DLPU devices) to provide real-time object detection, multi-object tracking, region-of-interest (ROI) intrusion detection, tripwire line crossing, ONVIF event emission, and stream overlay rendering on-device without remote GPU server stream re-transmission.

---

## 1. Architecture Overview

```
                   AXIS NETWORK CAMERA
 ┌─────────────────────────────────────────────────────────┐
 │  AXIS OS Hardware & Drivers                             │
 │  - Camera Sensor & Image Signal Processor (ISP)         │
 │  - ARTPEC-8 Deep Learning Processing Unit (DLPU)        │
 └────────────────────────────┬────────────────────────────┘
                              │
 ┌────────────────────────────▼────────────────────────────┐
 │  CamAI ACAP Native C++ Core Engine                      │
 │                                                         │
 │  [ Video Acquisition ] ──► AXIS VDO API (vdo-stream.h)  │
 │           │                                             │
 │           ▼                                             │
 │  [ Frame Preprocessing ] ──► Zero-copy YUV/NV12 → RGB   │
 │           │                                             │
 │  [ AI Inference Engine ] ──► AXIS Larod / ONNX Runtime  │
 │           │                                             │
 │  [ ByteTrack C++ Engine] ──► Kalman Filter + Hungarian │
 │           │                                             │
 │  [ Modular Analytics ]  ──► Security & Perimeter ROI    │
 │           │                                             │
 ├───────────┼───────────────────────────┬─────────────────┤
 │           ▼                           ▼                 ▼
 │     AXIS axevent                AXIS axoverlay    AXIS axparameter
 │     (ONVIF/Axis Events)         (Live Overlay)    (Camera Config UI)
 └───────────┬───────────────────────────┬─────────────────┬┘
             │                           │                 │
 ┌───────────▼───────────────────────────▼─────────────────▼┐
 │  AXIS OS / VMS Systems (Axis Camera Station, Milestone)  │
 └─────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure

```
ACAP/
├── manifest.json                  # Official AXIS ACAP Manifest Schema v2.0
├── Dockerfile                     # Multi-arch SDK container environment
├── Makefile                       # C++ cross-compilation Makefile
├── README.md                      # Architecture and developer guide
├── INSTALL.md                     # Installation and AXIS OS setup guide
├── PRODUCTION_DEPLOYMENT.md       # Hardware readiness & deployment guide
├── app/
│   ├── main.cpp                   # Entrypoint & signal handling
│   ├── camai_engine.hpp/.cpp      # Core Pipeline Coordinator
│   ├── video_pipeline.hpp/.cpp    # AXIS VDO API wrapper
│   ├── inference.hpp/.cpp         # AXIS Larod API / ONNX Runtime wrapper
│   ├── tracking.hpp/.cpp          # C++ ByteTrack tracker
│   ├── events.hpp/.cpp            # AXIS axevent API integration
│   ├── overlay.hpp/.cpp           # AXIS axoverlay API integration
│   ├── config.hpp/.cpp            # AXIS axparameter API integration
│   └── diagnostics.hpp/.cpp       # Watchdog & resource governor
├── modules/
│   ├── module_interface.hpp       # Polymorphic module interface
│   ├── security/                  # Reference Security & Perimeter module
│   ├── traffic/                   # Traffic & ANPR stub
│   ├── ppe/                       # Factory PPE stub
│   ├── retail/                    # Retail Intelligence stub
│   ├── smart_city/                # Smart City stub
│   ├── micro_motion/              # Micro Motion stub
│   └── custom/                    # Custom Engine stub
├── models/
│   ├── yolox_tiny.onnx            # Production ONNX model
│   └── export_acap_model.py       # Model converter for ACAP
├── tests/                         # C++ unit test suite
└── benchmarks/                    # Machine-readable performance profiler
```

---

## 3. Building the ACAP Package

### Using AXIS Official ACAP Docker SDK Environment

To build an installable `.eap` package for `aarch64` (ARTPEC-8):

```bash
docker build --build-arg ARCH=aarch64 -t camai-acap-builder .
docker run --rm -v $(pwd):/opt/app camai-acap-builder
```

For 32-bit `armv7hf` (ARTPEC-7):

```bash
docker build --build-arg ARCH=armv7hf -t camai-acap-builder-armv7 .
docker run --rm -v $(pwd):/opt/app camai-acap-builder-armv7
```

---

## 4. Key Features & Native AXIS OS Integration

- **AXIS VDO API (`libvdo`):** Zero-copy frame buffer acquisition directly from hardware camera sensor.
- **AXIS Larod API (`liblarod`):** Hardware-accelerated AI model inference on ARTPEC-8 DLPU NPU.
- **AXIS axevent API (`libaxevent`):** Native ONVIF / Axis event emission for VMS integration (Axis Camera Station, Milestone, Genetec).
- **AXIS axoverlay API (`libaxoverlay`):** Hardware-rendered bounding box and HUD stream overlays.
- **AXIS axparameter API (`libaxparameter`):** Persistent camera web configuration interface.
- **ByteTrack Multi-Object Tracking:** Pure C++ Kalman filtering + Hungarian matching for zero ID switches.
- **Resource Watchdog (`ResourceGovernor`):** `DROP_OLDEST` backpressure queue strategy preventing frame buffer bloat and memory overruns.
