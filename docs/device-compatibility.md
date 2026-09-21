# CamAI ACAP Device Compatibility Matrix

This document defines supported AXIS network camera hardware architectures, operating systems, and target environments for CamAI ACAP.

---

## Target Hardware Specifications

| Specification | Target Device (Primary Reference) | Secondary Target | Minimal Supported Target |
|---|---|---|---|
| **Representative Model** | **AXIS P3268-LV / Q3536-LVE** | **AXIS P3245-LV** | **AXIS M3068-P** |
| **CPU Architecture** | `aarch64` (ARM 64-bit Quad-Core) | `armv7hf` (ARM 32-bit Dual-Core) | `armv7hf` (ARM 32-bit Single-Core) |
| **SoC / Chipset** | ARTPEC-8 | ARTPEC-7 | ARTPEC-6 |
| **AXIS OS Version** | AXIS OS 11.0 - 12.x | AXIS OS 10.x - 11.x | AXIS OS 9.80 - 10.x |
| **ACAP SDK Version** | ACAP Native SDK 11.11.0+ | ACAP Native SDK 3.x / 11.x | ACAP Native SDK 3.x |
| **AI Accelerator** | ARTPEC-8 DLPU (Deep Learning Processing Unit) | ARTPEC-7 DLPU / Machine Learning Engine | None (CPU Arm NEON only) |
| **Total System RAM** | 2048 MB - 4096 MB | 1024 MB - 2048 MB | 512 MB - 1024 MB |
| **ACAP App RAM Limit** | 512 MB | 256 MB | 128 MB |
| **Storage Allocation** | 128 MB Flash / SD Card optional | 64 MB Flash | 32 MB Flash |
| **Expected FPS (YOLOX-Tiny)** | **25 - 30 FPS** | **12 - 15 FPS** | **4 - 6 FPS** |

---

## Supported Camera Models List

### Fully Supported (ARTPEC-8 with DLPU - `aarch64`)
- AXIS P3268-LV / P3267-LV
- AXIS Q3536-LVE / Q3538-LVE
- AXIS Q1656-LE / Q1715
- AXIS M4308-PLE / M4218-LV

### Supported with Reduced Resolution / FPS (ARTPEC-7 with DLPU - `armv7hf`)
- AXIS P3245-LV / P3247-LV
- AXIS Q1645-LE
- AXIS FA54 Main Unit

### Unsupported Models
- Legacy cameras on ARTPEC-5 or older (lacking ACAP Native SDK support).
- Thermal cameras without visual RGB stream processing compatibility.
- Devices with less than 64 MB available ACAP RAM application quota.
