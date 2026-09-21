# CamAI ACAP Production Deployment & Operational Governance

This document covers production deployment standards, resource governance, thermal management, failure recovery, and VMS integration for **CamAI ACAP**.

---

## 1. Resource Allocation & Limits

Embedded network cameras operate under strict cgroups quotas imposed by AXIS OS. Exceeding these limits causes the operating system to forcefully kill the process (`SIGKILL`).

| Resource Metric | Maximum Quota | Target Production Usage | Safety Margin |
|---|---|---|---|
| **RAM (ARTPEC-8)** | 512 MB | 112 MB - 145 MB | ~360 MB Free |
| **RAM (ARTPEC-7)** | 256 MB | 85 MB - 95 MB | ~160 MB Free |
| **CPU Utilization** | 100% (4 cores) | 15% - 25% | ~75% Headroom |
| **DLPU NPU Utilization** | 100% | 40% - 60% | ~40% Headroom |
| **Flash Storage** | 128 MB | 14 MB (App + Model) | ~114 MB Free |

---

## 2. Thermal Management & Backpressure Control

Outdoor dome cameras subject to direct solar radiation must maintain stable internal temperatures.

1. **Backpressure Strategy (`ResourceGovernor`):**
   - Inference queue length limit: `5 frames`.
   - When inference queue fills up, the engine activates `DROP_OLDEST` strategy to drop the stale frame buffer immediately rather than expanding RAM or increasing processing delay.
2. **Adaptive Frame Rate Throttling:**
   - Default processing cadence: `15 FPS`.
   - Under elevated thermal conditions (> 70°C internal camera sensor reading), the governor dynamically lowers inference cadence to `5 FPS` until temperature normalizes.

---

## 3. Crash Recovery & Daemon Governance

CamAI ACAP is registered with `runMode: respawn` in `manifest.json`.
- If the application encounters an unhandled exception or memory error, AXIS OS systemd manager automatically restarts the process within 1 second.
- Configuration settings persist in camera NVRAM via `axparameter`, ensuring uninterrupted recovery without loss of ROI rules or threshold configurations.

---

## 4. VMS Integration (Axis Camera Station, Milestone, Genetec)

Events emitted via `EventProducer` (`axevent`) populate the native camera ONVIF event tree:
- **Topic:** `tns1:RuleEngine/CamAI/Security/Intrusion`
- **Topic:** `tns1:RuleEngine/CamAI/Security/LineCrossing`

Any standard VMS connected via ONVIF or AXIS Media Control (AMC) can trigger alarms, PTZ presets, recording bookmarking, or audio alerts directly from these native camera events.
