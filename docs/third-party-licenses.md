# CamAI ACAP Third-Party Licenses & IP Audit

This document lists all third-party libraries, toolchains, and AI model dependencies incorporated into the **CamAI System (Edge ACAP + AWS Cloud Pipeline)**, along with their licensing terms.

---

## 1. Edge Component (CamAI ACAP EAP)

The Edge ACAP package is a lightweight client deployed on AXIS cameras.

### Frontend Dependencies (Web UI)
| Name | Version | License |
|---|---|---|
| **React** | 18.3.1 | MIT License |
| **React DOM** | 18.3.1 | MIT License |
| **Tailwind CSS** | 3.4.4 | MIT License |
| **Vite** | 5.3.1 | MIT License |
| **Lucide React** | 0.395.0 | MIT License |
| **clsx** | 2.1.1 | MIT License |

### Build & Platform Dependencies
| Name | Version | License | Notes |
|---|---|---|---|
| **AXIS ACAP Native SDK** | 4.x | AXIS License Agreement | Used for packaging EAP manifest/CGI |
| **Bash / CGI** | System | GPL/MIT | Standard Linux built-ins provided by AXIS OS |

---

## 2. Cloud Component (AWS AI Pipeline)

The heavy AI processing and model execution are deployed securely on the AWS server and are **not** bundled inside the ACAP EAP package.

### Server Dependencies
| Name | Version | License | Source / Repository |
|---|---|---|---|
| **FastAPI / Uvicorn** | - | MIT License | tiangolo/fastapi |
| **OpenCV Python** | 4.x | Apache License 2.0 | opencv/opencv-python |
| **NumPy** | - | BSD 3-Clause | numpy/numpy |

### AI Model Dependencies (Cloud Hosted)
| Model Name | Upstream Creator | License | Redistribution Compliance |
|---|---|---|---|
| **YOLOX** | Megvii Technology | Apache License 2.0 | Commercial use permitted. Hosted on private server. |
| **RT-DETR Helmet** | Baidu / Open Source | Apache License 2.0 | Commercial use permitted. Hosted on private server. |
| **LPD-YuNet** | OpenCV / Shiqi Yu | Apache License 2.0 / MIT | Commercial use permitted. Hosted on private server. |
| **CRNN OCR** | Open Source | Apache License 2.0 | Commercial use permitted. Hosted on private server. |

---

## IP Declaration
CamAI is a proprietary edge-to-cloud computer vision system. The Edge ACAP binary (`.eap`) contains strictly proprietary integration logic and MIT-licensed UI components. Heavy AI models are strictly isolated in a private cloud environment. No GPL / Copyleft code is statically linked or distributed in a way that infects the proprietary codebase.
