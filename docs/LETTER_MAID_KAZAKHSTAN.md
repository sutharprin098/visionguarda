# Letter — Ministry of Artificial Intelligence and Digital Development, Republic of Kazakhstan

> **Status:** DRAFT — not sent. Fill the bracketed fields before dispatch.
> Every capability claim below was verified against the CamAI source tree
> (see "Verification notes" at the end). Nothing is claimed that the system
> does not demonstrably do.

---

[Your Full Name]
[Company / Trading Name]
[Street Address]
[City, Postal Code, India]
Email: [your email] · Telephone: [+91 …]
[Website / camai.princesite.in]

**Date:** [DD Month 2026]
**Our reference:** CAMAI/MAID/2026/01

---

To,

**The Ministry of Artificial Intelligence and Digital Development**
Republic of Kazakhstan
[Department / Directorate, if known]
Astana, Republic of Kazakhstan

Kind attention: **[Name, Designation]**

---

**Subject: Offer for the outright transfer of intellectual property and complete source code of "CamAI Enterprise" — an on-premise AI video analytics platform for traffic enforcement and public safety**

---

Respected Sir / Madam,

**1. Purpose of this communication**

I write to formally offer the Ministry the complete and permanent transfer of intellectual property rights, including full source code, trained models and technical documentation, of **CamAI Enterprise** — a working, deployed AI video analytics platform developed independently by me. This is an offer of outright sale and ownership transfer, not a licensing, subscription or managed-service proposal.

**2. What the system is**

CamAI Enterprise converts existing CCTV infrastructure into an automated situational-awareness system. It ingests standard RTSP, ONVIF, USB and HTTP/HLS camera streams and performs all artificial-intelligence inference **locally, on the operator's own hardware**. Video is never transmitted to any external or foreign cloud service. The platform comprises four delivered components:

- a real-time inference engine (Python / FastAPI) with multi-threaded video pipeline;
- a Windows desktop monitoring application (Electron / React), distributed as a signed installer;
- a web-based administration portal (React) for camera, role and policy management;
- a PostgreSQL database layer with row-level security, role-based access control and audit logging.

**3. Verified operational capabilities**

The following functions are implemented and have been validated against real video, not simulated data:

| Capability | Status |
| :--- | :--- |
| Person and vehicle detection, with persistent multi-object tracking | Operational |
| Automatic Number Plate Recognition (ANPR) | Operational |
| Helmet / no-helmet detection on two-wheeler riders | Operational |
| Vehicle speed estimation from calibrated camera geometry | Operational |
| Face detection | Operational |
| Zone-based rule engine with automated alerting and evidence capture | Operational |

I wish to state plainly that the platform performs face **detection** and does not perform face **recognition** or biometric identity matching. I mention this explicitly because such a distinction is material to any government procurement assessment, and I prefer it be understood at the outset rather than discovered later.

**4. Relevance to the Republic of Kazakhstan**

I submit this proposal to the Ministry specifically because the platform's architecture aligns with the objectives of national digital sovereignty:

- **Data residency by design.** All video processing occurs on hardware physically located within the operator's premises. There is no technical dependency on any foreign cloud provider for inference, and therefore no cross-border transfer of video data.
- **No vendor lock-in.** Because the Ministry would own the source code outright, the system can be maintained, modified, audited and extended by Kazakhstani institutions or contractors without reference to me or to any third party.
- **Localisation is straightforward.** The interface text is externalised and can be adapted to Kazakh and Russian without architectural change.
- **Direct applicability to road-safety enforcement.** The helmet, number-plate and speed functions together address a well-defined enforcement workflow, producing a structured, exportable evidence record for each event.
- **Hardware flexibility.** The engine automatically selects the available acceleration path — NVIDIA (TensorRT / CUDA), Intel (OpenVINO), DirectML, or CPU — allowing deployment on existing or modest hardware rather than requiring a specific procurement.

**5. Scope of the proposed transfer**

The transfer would comprise the complete source code of all four components; the trained model weights and their export pipelines; database schemas and migrations; the automated test suite; deployment scripts; and the full technical documentation set. Ownership would pass to the Ministry permanently and exclusively, with no retained rights, royalty or continuing obligation on the Ministry's part.

**6. Intellectual property and licensing position**

The system is built exclusively on permissively licensed components suitable for state proprietary use and onward redistribution. The detection models are YOLOX (Apache-2.0), RT-DETR (Apache-2.0) and YuNet (MIT); the supporting frameworks are OpenCV, ONNX Runtime, OpenVINO, FastAPI, React and Electron, all under Apache-2.0 or MIT terms. Components carrying copyleft obligations incompatible with proprietary transfer — specifically AGPL-3.0 licensed detection weights — were deliberately identified and replaced during development. A complete third-party licence inventory can be furnished for independent legal review.

**7. Proposed next step**

I would be grateful for the opportunity to present a technical demonstration to the Ministry's officers, at their convenience and by whichever means is most appropriate — a live online demonstration, or an on-site pilot at a location of the Ministry's choosing. I am equally willing to submit the system for independent technical and legal due diligence prior to any commercial discussion.

Commercial terms are open to negotiation and I have deliberately not stated a figure in this letter, considering it more appropriate to establish technical suitability first.

I would be honoured to receive the Ministry's guidance on the correct procedure for a proposal of this nature.

With respect and regards,

**[Your Full Name]**
[Designation, e.g. Founder / Independent Developer]
[Company / Trading Name]
Email: [your email] · Telephone: [+91 …]

---

**Enclosures (to attach before dispatch):**
1. Executive Summary and Solution Overview
2. Software Architecture Specification
3. Buyer Handover and IP Transfer Schedule
4. Third-Party Open-Source Licence Inventory

---

## Verification notes (for your reference — remove before sending)

Every capability in section 3 was confirmed in the source tree, not taken from
the marketing documents:

- ANPR — `server/app/ai/plate.py`, `plate_ocr.py`, `plate_format.py`, `plate_track.py`, `plate_worker.py`
- Helmet — `server/app/ai/helmet.py` (RT-DETR, Apache-2.0)
- Face **detection** — `server/app/ai/face.py` (YuNet, MIT). There is no recognition/embedding path.
- Speed — `server/app/analytics.py` (calibrated, filtered)
- Detector backbone — `server/app/ai/backend.py` (YOLOX-S, Apache-2.0)

**Claims I deliberately excluded**, because the marketing docs assert them but
the code does not support them:

- "Face recognition" — `docs/01_EXECUTIVE_SUMMARY.md` §3 claims it. Only detection exists.
- Fire / smoke / PPE detection — previously fabricated output, since removed.
- The hardware benchmark table in `docs/12_PERFORMANCE_BENCHMARKS.md`
  (RTX 4090 etc.) — I could not confirm these were measured on that hardware,
  so no throughput figure is quoted. Offer benchmarks only for configurations
  you have actually run.

**Buyer-pack corrections — now applied:**

- `docs/14_BUYER_HANDOVER_LICENSING.md` and `docs/05_AI_ENGINE_DOCUMENTATION.md`
  described a "YOLOv8 helmet classifier" and a "YOLOv8 plate detector". Both
  were stale: the code uses RT-DETR (Apache-2.0) and LPD-YuNet (Apache-2.0).
  YOLOv8 is AGPL-3.0, so those lines would have raised a licensing objection
  that no longer applies. Corrected.
- `LICENSING.md` §3 listed only the YOLOX primary detector, omitting the four
  secondary model weights that actually ship. A licence inventory with gaps is
  worse than none in due diligence. New §2a covers RT-DETR, YuNet, LPD-YuNet
  and CRNN with upstream and licence for each.
- `docs/01_EXECUTIVE_SUMMARY.md` §3 claimed "face recognition". Corrected to
  face detection, with an explicit note that no biometric identity matching is
  performed.
