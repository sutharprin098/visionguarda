# 🚀 CamAI AWS Cloud AI Inference Engine — Deployment & Architecture Guide

This document provides a comprehensive operational overview, architecture blueprint, security setup, deployment workflow, and latency benchmarks for the **CamAI AWS Cloud AI Inference Infrastructure**.

---

## 📑 Table of Contents
1. [System Architecture](#1-system-architecture)
2. [AWS EC2 Instance Specification](#2-aws-ec2-instance-specification)
3. [AWS Security Group Configuration](#3-aws-security-group-configuration)
4. [Deployment & Startup Instructions](#4-deployment--startup-instructions)
5. [Automated Systemd Service Setup](#5-automated-systemd-service-setup)
6. [API Specification & Endpoints](#6-api-specification--endpoints)
7. [Performance & Latency Benchmarks](#7-performance--latency-benchmarks)
8. [Resiliency & Failure Cool-Off Mechanism](#8-resiliency--failure-cool-off-mechanism)

---

## 1. System Architecture

The **CamAI Hybrid Inference Pipeline** operates in a multi-tier client-cloud configuration:

```
┌─────────────────────────────────────────────────────────┐
│                     Desktop Client / Server             │
│  - Pipeline Coordinator & Camera Stream Readers         │
│  - Cloud Client (app/ai/cloud_client.py)                │
└────────────────────────────┬────────────────────────────┘
                             │
                             │ HTTPS / HTTP POST /api/detect
                             ▼
┌─────────────────────────────────────────────────────────┐
│              AWS EC2 Cloud AI Node (Port 8000)          │
│  - Microservice: server/run_cloud_node.py               │
│  - Engine: OpenVINO CPU/GPU Inference                   │
│  - Target Resolution: 320px (Optimized for Speed)       │
└─────────────────────────────────────────────────────────┘
```

When **Cloud Mode** is active, video frames are compressed to JPEG (Quality: 75), resized to 320px target size, and transmitted to the remote AWS EC2 instance. The cloud node returns normalized detection bounding boxes and class predictions in under **140ms total roundtrip**.

---

## 2. AWS EC2 Instance Specification

| Parameter | AWS Configuration Detail |
|---|---|
| **Region** | `ap-south-1` (Asia Pacific - Mumbai) |
| **Instance ID** | `i-0efc8fbbe4931c880` |
| **Instance Name** | `CamAI-Cloud-Node` |
| **Instance Type** | `c6i.xlarge` |
| **Operating System** | Ubuntu 26.04 LTS (x86_64) |
| **Public IPv4 Address** | `13.203.71.14` |
| **Public IPv4 DNS** | `ec2-13-203-71-14.ap-south-1.compute.amazonaws.com` |
| **Availability Zone** | `ap-south-1c` |

---

## 3. AWS Security Group Configuration

- **Security Group ID**: `sg-03820599645fc97b1`
- **Security Group Name**: `launch-wizard-1`

### Required Inbound Rules Table

| Rule Type | Protocol | Port Range | Source | Description / Purpose |
|---|---|---|---|---|
| **SSH** | TCP | `22` | `0.0.0.0/0` | Enables AWS Console EC2 Instance Connect & SSH Terminal Access |
| **Custom TCP** | TCP | `8000` | `0.0.0.0/0` | Enables CamAI Desktop Client access to Cloud AI Inference API |

---

## 4. Deployment & Startup Instructions

### Manual Startup via SSH Terminal

1. **Connect to EC2 Instance**:
   Use AWS EC2 Instance Connect or standard SSH:
   ```bash
   ssh -i /path/to/key.pem ubuntu@13.203.71.14
   ```

2. **Navigate & Update Code**:
   ```bash
   cd ~/camAI
   git pull origin main
   ```

3. **Kill Any Stale Processes on Port 8000**:
   ```bash
   sudo fuser -k 8000/tcp
   ```

4. **Launch Cloud Node Microservice**:
   ```bash
   python3 server/run_cloud_node.py --port 8000 --host 0.0.0.0
   ```

---

## 5. Automated Systemd Service Setup

To ensure the AWS Cloud Server automatically starts on system boot and restarts if crashed:

1. Create a service file on the EC2 server:
   ```bash
   sudo nano /etc/systemd/system/camai-cloud.service
   ```

2. Add the following configuration:
   ```ini
   [Unit]
   Description=CamAI Cloud AI Inference Node
   After=network.target

   [Service]
   Type=simple
   User=ubuntu
   WorkingDirectory=/home/ubuntu/camAI
   ExecStart=/usr/bin/python3 /home/ubuntu/camAI/server/run_cloud_node.py --port 8000 --host 0.0.0.0
   Restart=always
   RestartSec=3

   [Install]
   WantedBy=multi-user.target
   ```

3. Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable camai-cloud
   sudo systemctl start camai-cloud
   ```

4. Check service status:
   ```bash
   sudo systemctl status camai-cloud
   ```

---

## 6. API Specification & Endpoints

### 1. Health Check Endpoint
- **URL**: `GET http://13.203.71.14:8000/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "service": "CamAI Cloud AI Node",
    "backend_ready": true,
    "timestamp": 1787911932.95
  }
  ```

### 2. Inference Endpoint
- **URL**: `POST http://13.203.71.14:8000/api/detect`
- **Headers**: `Content-Type: application/json`
- **Payload**:
  ```json
  {
    "image_b64": "<base64_encoded_jpeg_string>",
    "target_size": 320
  }
  ```
- **Response**:
  ```json
  {
    "status": "success",
    "latency_ms": 24.5,
    "count": 1,
    "detections": [
      {
        "class": "person",
        "confidence": 0.9124,
        "bbox": { "x1": 120, "y1": 45, "x2": 340, "y2": 620 }
      }
    ]
  }
  ```

---

## 7. Performance & Latency Benchmarks

Validated end-to-end telemetry measurements recorded during live stress test:

| Test Metric | Measured Value | Benchmark Target | Status |
|---|---|---|---|
| **Pure Cloud AI Inference Latency** | **24.5 ms** | < 50.0 ms | 🟢 PASSED |
| **Total Roundtrip Latency (Network + AI)** | **132.3 ms** | < 250.0 ms | 🟢 PASSED |
| **HTTP Response Code** | **200 OK** | 200 OK | 🟢 PASSED |
| **Target Frame Resolution** | **320 px** | 320 px | 🟢 OPTIMIZED |

---

## 8. Resiliency & Failure Cool-Off Mechanism

The system includes a client-side **Failure Cool-Off Governor** located in `server/app/ai/cloud_client.py`:

- **Cool-Off Window (`ENDPOINT_COOL_OFF_S`)**: Set to **15.0 seconds**.
- **Behavior**: If the primary AWS endpoint (`http://13.203.71.14:8000`) suffers network drops or becomes unreachable, it is flagged for cool-off.
- **Failover Routing**: Subsequent frames immediately skip probing the dead endpoint and route to the local microservice (`http://127.0.0.1:8099`) or local OpenVINO pipeline.
- **Result**: Zero video freezing or per-frame connection stalls, maintaining continuous 30+ FPS video streams.

---
*Document generated for CamAI VisionGuarda Infrastructure Team.*
