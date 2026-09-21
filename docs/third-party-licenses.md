# CamAI ACAP Third-Party Licenses & IP Audit

This document lists all third-party libraries, toolchains, and AI model dependencies incorporated into CamAI ACAP, along with their licensing terms and commercial redistribution obligations.

---

## Software & Library Dependencies

| Name | Version | License | Source / Repository | Modification Status | Commercial Redistribution Restrictions | Copyleft Obligations |
|---|---|---|---|---|---|---|
| **AXIS ACAP Native SDK** | 11.11.0 | AXIS License Agreement | Axis Communications AB | Unmodified Toolchain | Permitted for deployment on AXIS hardware | None |
| **AXIS VDO API (`libvdo`)** | System Library | AXIS Proprietary / BSD | AXIS OS | Dynamically Linked | Permitted on AXIS OS | None |
| **AXIS Larod API (`liblarod`)** | System Library | AXIS Proprietary / BSD | AXIS OS | Dynamically Linked | Permitted on AXIS OS | None |
| **AXIS axparameter (`libaxparameter`)** | System Library | AXIS Proprietary | AXIS OS | Dynamically Linked | Permitted on AXIS OS | None |
| **AXIS axevent (`libaxevent`)** | System Library | AXIS Proprietary | AXIS OS | Dynamically Linked | Permitted on AXIS OS | None |
| **AXIS axoverlay (`libaxoverlay`)** | System Library | AXIS Proprietary | AXIS OS | Dynamically Linked | Permitted on AXIS OS | None |
| **OpenCV (Core/Imgproc)** | 4.x | Apache License 2.0 | opencv/opencv | Statically/Dynamically linked subset | Permitted with attribution | None |
| **nlohmann/json** | 3.11.x | MIT License | nlohmann/json | Unmodified header-only | Fully Permitted | None |
| **Eigen** | 3.4.x | MPL 2.0 | eigen/eigen | Unmodified header-only | Permitted (Source linkable) | Minimal (MPL per file) |

---

## AI Model Licenses

| Model Name | Upstream Creator | License | Commercial License Notes | Redistribution Compliance |
|---|---|---|---|---|
| **YOLOX (Tiny / S)** | Megvii Technology | Apache License 2.0 | Open source commercial use permitted | Included in ONNX export with copyright header preserved |
| **RT-DETR Helmet** | Baidu / Open Source | Apache License 2.0 | Open source commercial use permitted | Included in ONNX export |
| **LPD-YuNet** | OpenCV / Shiqi Yu | Apache License 2.0 / MIT | Open source commercial use permitted | Included in ONNX export |
| **CRNN OCR** | Open Source | Apache License 2.0 | Open source commercial use permitted | Included in ONNX export |

---

## IP Declaration
CamAI ACAP contains proprietary tracking, region-of-interest calculation, and event classification logic combined with open-source models licensed under Apache 2.0 and MIT. No GPL / Copyleft code is linked into the embedded ACAP binary.
