# AWS Cloud Inference Node — Deployment Guide

Operational reference for the CamAI cloud inference endpoint hosted on AWS EC2. Covers instance setup, security groups, systemd configuration, API contract, and measured latency.

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [EC2 Instance Specification](#2-ec2-instance-specification)
3. [Security Group Configuration](#3-security-group-configuration)
4. [Deployment](#4-deployment)
5. [Systemd Service Setup](#5-systemd-service-setup)
6. [API Endpoints](#6-api-endpoints)
7. [Latency Benchmarks](#7-latency-benchmarks)
8. [Operations Log](#8-operations-log)

---

## 1. Architecture

The hybrid inference pipeline offloads detection to a remote EC2 node when cloud mode is active:

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
│  - Target Resolution: 320px                             │
└─────────────────────────────────────────────────────────┘
```

Frames are JPEG-compressed (quality 75), resized to 320px, and transmitted to the EC2 node. The node returns normalized bounding boxes and class predictions. Measured roundtrip is ~130ms.

---

## 2. EC2 Instance Specification

| Parameter | Value |
|---|---|
| Region | `ap-south-1` (Mumbai) |
| Instance ID | `i-0efc8fbbe4931c880` |
| Instance Type | `c6i.xlarge` |
| OS | Ubuntu 26.04 LTS (x86_64) |
| Public IPv4 | `13.203.71.14` |
| Availability Zone | `ap-south-1c` |

---

## 3. Security Group Configuration

Security Group: `sg-03820599645fc97b1` (`launch-wizard-1`)

### Inbound Rules

| Protocol | Port | Source | Purpose |
|---|---|---|---|
| TCP | 22 | `0.0.0.0/0` | SSH / EC2 Instance Connect |
| TCP | 8000 | `0.0.0.0/0` | Cloud inference API |

---

## 4. Deployment

### Manual startup via SSH

```bash
ssh -i /path/to/key.pem ubuntu@13.203.71.14
cd ~/camAI
git pull origin main
sudo fuser -k 8000/tcp
python3 server/run_cloud_node.py --port 8000 --host 0.0.0.0
```

---

## 5. Systemd Service Setup

For automatic startup on boot and crash recovery:

```bash
sudo nano /etc/systemd/system/camai-cloud.service
```

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

```bash
sudo systemctl daemon-reload
sudo systemctl enable camai-cloud
sudo systemctl start camai-cloud
sudo systemctl status camai-cloud
```

---

## 6. API Endpoints

### Health check

```
GET http://13.203.71.14:8000/health
```

```json
{
  "status": "ok",
  "service": "CamAI Cloud AI Node",
  "backend_ready": true,
  "timestamp": 1787911932.95
}
```

### Inference

```
POST http://13.203.71.14:8000/api/detect
Content-Type: application/json
```

Request:

```json
{
  "image_b64": "<base64_encoded_jpeg>",
  "target_size": 320
}
```

Response:

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

## 7. Latency Benchmarks

Measured during live stress test:

| Metric | Measured | Target |
|---|---|---|
| Cloud inference latency | 24.5 ms | < 50 ms |
| Total roundtrip (network + inference) | 132.3 ms | < 250 ms |
| Frame resolution | 320 px | 320 px |

---

## 8. Operations Log

### 2026-08-29 — Systemd deployment

| Attribute | Value |
|---|---|
| Timestamp (UTC) | 2026-08-29 07:44:08 |
| Instance | `CamAI-Cloud-Node` (`c6i.xlarge`) |
| Public IP | `13.203.71.14` |
| OS | Ubuntu 26.04 LTS |
| Backend | OpenVINO CPU (`yolox_tiny`) |
| Git commit | `b6ba8e9` (`origin/main`) |

**Changes made:**

1. Pulled latest v1.0.7 pipeline updates and cloud node fixes.
2. Created `/etc/systemd/system/camai-cloud.service` with `Restart=always` / `RestartSec=3`.
3. Enabled and started the service.

**Rationale:** Running the server manually via terminal caused the process to stop on session disconnect or instance reboot. Systemd auto-restarts within 3 seconds on crash.
