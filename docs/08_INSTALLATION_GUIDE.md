# CamAI Enterprise - Comprehensive Installation & Deployment Guide

---

> **Classification**: Enterprise Installation & Operational Setup  
> **Document Reference**: `DOC-INST-08`

---

## 1. System Requirements

### 1.1 Minimum Hardware Requirements (1 - 4 Streams)
- **CPU**: Intel Core i5 / AMD Ryzen 5 (4 Cores, 3.0 GHz+)
- **RAM**: 8 GB DDR4
- **GPU**: NVIDIA GTX 1650 (4 GB VRAM) OR Intel iGPU with OpenVINO support
- **Storage**: 100 GB SSD (NVMe recommended for incident clip storage)
- **OS**: Windows 10/11 64-bit OR Ubuntu 22.04 LTS

### 1.2 Recommended Hardware Requirements (16 - 64 Streams)
- **CPU**: Intel Xeon / AMD EPYC / Intel i9 (16+ Cores)
- **RAM**: 32 GB / 64 GB DDR5
- **GPU**: NVIDIA RTX 4090 (24 GB) OR NVIDIA A100 / T4 / L4 Tensor Core GPU
- **Storage**: 1 TB+ NVMe SSD
- **OS**: Ubuntu 22.04 LTS Server OR Windows Server 2022

---

## 2. Windows Installation

### 2.1 Dependencies Installation
1. **Python 3.11**: Download and run official installer. Ensure **"Add Python to PATH"** is checked.
2. **Node.js 18+ / 20+**: Download LTS MSI installer.
3. **FFmpeg**: Download builds from Gyan.dev, extract to `C:\ffmpeg`, and add `C:\ffmpeg\bin` to System PATH.
4. **NVIDIA CUDA Toolkit 11.8 / 12.x & cuDNN**: (Optional for NVIDIA GPUs) Install from NVIDIA Developer Portal.

### 2.2 Server Setup
```powershell
cd d:\camAI\server
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m app.main
```

### 2.3 Desktop Application Setup
```powershell
cd d:\camAI\desktop
npm install
npm run dev
```

---

## 3. Linux (Ubuntu 22.04 LTS) Installation

### 3.1 System Dependencies
```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv python3-pip ffmpeg git libgl1-mesa-glx
```

### 3.2 NVIDIA Container Toolkit Setup (For GPU Docker)
```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt update && sudo apt install -y nvidia-container-toolkit
sudo systemctl restart docker
```

---

## 4. Docker & Docker Compose Deployment

Launch the complete stack (Backend Server, Web Portal, PostgreSQL DB) in containerized mode:

```bash
docker-compose up -d --build
```
