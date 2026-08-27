# CamAI Ground-Truth Performance Measurement Report

**Engine Version:** CamAI v1.0.0 (Intel iGPU / OpenVINO Async Pipeline)  
**Date:** 2026-08-27 19:17:50  
**Sample Count:** 300 frames (100 warm-up iterations discarded)  
**Instrumentation Overhead:** `0.09%` (Verified < 2.0%)  

---

## Executive Summary & Acceptance Criteria Answers

| Question / Metric | Measurement Result | Engineering Diagnosis |
|-------------------|--------------------|-----------------------|
| **1. Is 25 ms inference a measurement or budget?** | **MEASURED (`75.97 ms` p95)** | **Confirmed Measurement**: Measured directly via OpenVINO async completion callback (`InferRequest.start_async()`), not submit budget. |
| **2. Real Sustained Throughput (Hot Silicon)** | **`13.2 FPS`** | Derived from Bottleneck Stage Service Time ($1.0 / \max(T_{\text{service}})$). |
| **3. True Glass-to-Glass Latency** | **`127.27 ms` (p95)** | Decoder output timestamp to WebSocket payload dispatch completion. |

---

## Core Metric Breakdown (3 Distinct Numbers)

1. **Sum of Per-Stage Compute Time ($\sum \text{Service}$):**  
   - **p50:** `98.91 ms`  
   - **p95:** `136.10 ms`  
   - **p99:** `158.63 ms`  

2. **Sustained Engine Throughput:**  
   - **`13.2 FPS`** (Limited by stage: `Inference (Async)` @ `75.97 ms`)  

3. **True Glass-to-Glass Latency ($T_{\text{dispatch}} - T_{\text{capture}}$):**  
   - **p50:** `103.97 ms`  
   - **p95:** `127.27 ms`  
   - **p99:** `136.60 ms`  

---

## Stage-by-Stage Latency (Service Time vs Queue Wait)

| Pipeline Stage | Queue Wait p50 (ms) | Queue Wait p95 (ms) | Queue Wait p99 (ms) | Service Time p50 (ms) | Service Time p95 (ms) | Service Time p99 (ms) |
|----------------|---------------------|---------------------|---------------------|-----------------------|-----------------------|-----------------------|
| **Decode** | 0.00 | 0.00 | 0.00 | 2.75 | 4.32 | 5.15 |
| **Enhancement** | 0.00 | 0.01 | 0.01 | 11.87 | 17.92 | 25.75 |
| **Preprocess** | 0.00 | 0.01 | 0.02 | 9.38 | 13.12 | 15.49 |
| **Inference (Async)** | 2.32 | 4.58 | 6.04 | 53.69 | 75.97 | 83.56 |
| **NMS / Postproc** | 0.22 | 0.64 | 1.01 | 0.27 | 0.56 | 0.88 |
| **Tracking** | 0.00 | 0.00 | 0.01 | 0.12 | 0.28 | 0.46 |
| **Preview Encode** | 0.00 | 0.00 | 0.00 | 20.76 | 23.77 | 27.11 |
| **Transport / WS** | 0.00 | 0.01 | 0.01 | 0.07 | 0.15 | 0.24 |

---

## Inference Service Time Distribution (ASCII Histogram)
```
 36.91 -  42.08 ms | ████                           (20)
 42.08 -  47.25 ms | ████                           (19)
 47.25 -  52.42 ms | ██████████████████             (75)
 52.42 -  57.59 ms | ██████████████████████████████ (123)
 57.59 -  62.75 ms | █████                          (24)
 62.75 -  67.92 ms | ██                             (10)
 67.92 -  73.09 ms | ██                             (9)
 73.09 -  78.26 ms | █                              (7)
 78.26 -  83.43 ms | ██                             (9)
 83.43 -  88.59 ms |                                (4)
```

---

## OpenVINO Layer Profiling Summary (`ov::ProfilingInfo`)

| Node Name | Exec Type | Real Time (us) | CPU Time (us) | Status |
|-----------|-----------|----------------|---------------|--------|
| `convolution:/backbone/C3_n3/conv1/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16_1x1__f16` | 602 | 23 | Status.EXECUTED |
| `convolution:/backbone/C3_n3/conv2/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16_1x1__f16` | 175 | 24 | Status.EXECUTED |
| `convolution:/backbone/C3_n3/conv3/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 304 | 25 | Status.EXECUTED |
| `convolution:/backbone/C3_n3/m/m.0/conv1/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 132 | 26 | Status.EXECUTED |
| `convolution:/backbone/C3_n3/m/m.0/conv2/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 551 | 24 | Status.EXECUTED |
| `convolution:/backbone/C3_n4/conv1/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16_1x1__f16` | 176 | 23 | Status.EXECUTED |
| `convolution:/backbone/C3_n4/conv2/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16_1x1__f16` | 195 | 78 | Status.EXECUTED |
| `convolution:/backbone/C3_n4/conv3/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16_1x1__f16` | 327 | 22 | Status.EXECUTED |
| `convolution:/backbone/C3_n4/m/m.0/conv1/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 153 | 29 | Status.EXECUTED |
| `convolution:/backbone/C3_n4/m/m.0/conv2/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 577 | 36 | Status.EXECUTED |
| `convolution:/backbone/C3_p3/conv1/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 272 | 21 | Status.EXECUTED |
| `convolution:/backbone/C3_p3/conv2/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 300 | 21 | Status.EXECUTED |
| `convolution:/backbone/C3_p3/conv3/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 289 | 20 | Status.EXECUTED |
| `convolution:/backbone/C3_p3/m/m.0/conv1/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 94 | 20 | Status.EXECUTED |
| `convolution:/backbone/C3_p3/m/m.0/conv2/conv/Conv/WithoutBiases` | `convolution_gpu_bfyx_f16__f16` | 492 | 20 | Status.EXECUTED |

---

*Report generated automatically by CamAI nanosecond harness on 2026-08-27 19:17:50*