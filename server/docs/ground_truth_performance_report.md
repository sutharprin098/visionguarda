# CamAI Ground-Truth Performance Measurement Report

**Engine Version:** CamAI v1.0.0 (Intel iGPU / OpenVINO Async Pipeline)  
**Date:** 2026-09-04 22:44:26  
**Sample Count:** 300 frames (100 warm-up iterations discarded)  
**Instrumentation Overhead:** `0.02%` (Verified < 2.0%)  

---

## Executive Summary & Acceptance Criteria Answers

| Question / Metric | Measurement Result | Engineering Diagnosis |
|-------------------|--------------------|-----------------------|
| **1. Is 25 ms inference a measurement or budget?** | **MEASURED (`15.89 ms` p95)** | **Confirmed Measurement**: Measured directly via OpenVINO async completion callback (`InferRequest.start_async()`), not submit budget. |
| **2. Real Sustained Throughput (Hot Silicon)** | **`62.9 FPS`** | Derived from Bottleneck Stage Service Time ($1.0 / \max(T_{\text{service}})$). |
| **3. True Glass-to-Glass Latency** | **`28.45 ms` (p95)** | Decoder output timestamp to WebSocket payload dispatch completion. |

---

## Core Metric Breakdown (3 Distinct Numbers)

1. **Sum of Per-Stage Compute Time ($\sum \text{Service}$):**  
   - **p50:** `24.91 ms`  
   - **p95:** `29.16 ms`  
   - **p99:** `31.92 ms`  

2. **Sustained Engine Throughput:**  
   - **`62.9 FPS`** (Limited by stage: `Inference (Async)` @ `15.89 ms`)  

3. **True Glass-to-Glass Latency ($T_{\text{dispatch}} - T_{\text{capture}}$):**  
   - **p50:** `25.09 ms`  
   - **p95:** `28.45 ms`  
   - **p99:** `30.86 ms`  

---

## Stage-by-Stage Latency (Service Time vs Queue Wait)

| Pipeline Stage | Queue Wait p50 (ms) | Queue Wait p95 (ms) | Queue Wait p99 (ms) | Service Time p50 (ms) | Service Time p95 (ms) | Service Time p99 (ms) |
|----------------|---------------------|---------------------|---------------------|-----------------------|-----------------------|-----------------------|
| **Decode** | 0.00 | 0.00 | 0.00 | 0.78 | 1.32 | 1.70 |
| **Enhancement** | 0.00 | 0.00 | 0.00 | 0.18 | 0.27 | 0.33 |
| **Preprocess** | 0.00 | 0.00 | 0.00 | 0.04 | 0.10 | 0.14 |
| **Inference (Async)** | 0.00 | 0.00 | 0.00 | 15.53 | 15.89 | 15.95 |
| **NMS / Postproc** | 0.09 | 0.15 | 0.21 | 0.00 | 0.00 | 0.01 |
| **Tracking** | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| **Preview Encode** | 0.00 | 0.00 | 0.00 | 8.35 | 11.51 | 13.69 |
| **Transport / WS** | 0.00 | 0.00 | 0.01 | 0.03 | 0.06 | 0.10 |

---

## Inference Service Time Distribution (ASCII Histogram)
```
 15.11 -  15.27 ms | ████████████                   (38)
 15.27 -  15.43 ms | █████████████                  (41)
 15.43 -  15.59 ms | ██████████████████████████████ (94)
 15.59 -  15.75 ms | ███████████████████████        (73)
 15.75 -  15.91 ms | ██████████████                 (44)
 15.91 -  16.07 ms | ██                             (8)
 16.07 -  16.23 ms |                                (0)
 16.23 -  16.39 ms |                                (1)
 16.39 -  16.55 ms |                                (0)
 16.55 -  16.71 ms |                                (1)
```

---

## OpenVINO Layer Profiling Summary (`ov::ProfilingInfo`)

| Node Name | Exec Type | Real Time (us) | CPU Time (us) | Status |
|-----------|-----------|----------------|---------------|--------|
| `conv2d_stem` | `fused_fp16` | 850 | 120 | EXECUTED |
| `yolo_head_cls` | `fused_fp16` | 1420 | 310 | EXECUTED |

---

*Report generated automatically by CamAI nanosecond harness on 2026-09-04 22:44:26*