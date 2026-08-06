# CamAI (VisionGuarda) - Full Acquisition & Project Sale Listing Kit

This document contains everything needed to list and sell the **CamAI / VisionGuarda** IP, codebase, and complete project on marketplaces like Acquire.com, Flippa, or via direct buyer outreach.

---

## 1. Ready-to-Post Listing Template (Copy & Paste for Acquire.com / Flippa)

### Listing Title:
> **Enterprise AI Computer Vision & Smart City Surveillance Platform (Full IP + Codebase)**

### Short Summary (Tagline):
> Complete end-to-end AI Video Analytics platform featuring real-time object tracking, vehicle speed estimation, multi-camera telemetry studio, desktop client (Electron/React), cloud web portal (Next.js), Python PyTorch/YOLO inference engine, and Supabase backend.

### Key Highlights:
- **Production-Ready Stack:** Full-stack enterprise architecture built with Python (YOLO/PyTorch/OpenCV), Electron desktop client, Next.js web portal, and Supabase/PostgreSQL database.
- **Advanced Computer Vision Capabilities:** Real-time multi-camera ingestion, vehicle detection & classification, speed telemetry overlay studio, line-crossing alerts, and health monitoring.
- **Comprehensive Documentation:** Over 10+ detailed docs including Architecture, AI Engine, Database migrations, Deployment scripts, API, and Handover guides.
- **Multi-Platform Support:** Runs as a high-performance Windows desktop application with GPU acceleration (Intel/NVIDIA/DirectML) and a web control portal.
- **Turnkey IP Sale:** Buyer receives 100% full source code ownership, clean git commit history, database schemas, deployment PowerShell scripts, and full documentation.

### What Is Included in the Sale:
1. **Desktop App Repository (`/desktop`):** Electron + React + TypeScript + Vite desktop application with live stream overlays, WGC screen capture, and IPC bridge.
2. **Web Management Portal (`/portal`):** Next.js / React portal for camera configuration, telemetry analytics, real-time alert logs, and user management.
3. **AI Inference Engine (`/server`):** High-performance Python backend supporting OpenCV/YOLO models, WebSocket telemetry stream, GPU backend auto-detection, and virtual camera fallback.
4. **Database & Infrastructure (`/supabase`):** Full Supabase migrations, SQL schemas, camera health tracking, and telemetry database structure.
5. **Deployment Scripts:** Automated PowerShell deployment scripts (`deploy_website.ps1`, `deploy_supabase.ps1`, `deploy_telegram_complete.ps1`).
6. **Complete Technical Documentation:** 13+ markdown files covering setup, deployment, performance tuning, and buyer handover.

---

## 2. Recommended Listing Marketplaces & Platforms

| Platform | Best For | Typical Listing Type | Recommended Asking Price |
| :--- | :--- | :--- | :--- |
| **[Acquire.com](https://acquire.com)** *(Formerly MicroAcquire)* | Serious SaaS / Software Buyers | Verified IP / Software Sale | **$10,000 - $25,000 USD** |
| **[Flippa.com](https://flippa.com)** | Broader Market / Auction | Fixed Price or Auction | **$5,000 - $15,000 USD** |
| **[Microns.io](https://microns.io)** | Micro-SaaS & Micro-Projects | Codebase / Project Sale | **$3,000 - $8,000 USD** |
| **Direct LinkedIn Outreach** | Security OEMs / System Integrators | White-label IP Sale | **₹5,000,000 - ₹15,000,000 INR ($6K - $18K)** |

---

## 3. Pre-Sale Code Sanitation & Security Checklist

Before transferring the codebase or sharing a zip file with potential buyers:

- [ ] **Remove Secrets:** Delete all `.env`, `.env.local`, `.env.production` files containing real API keys, Supabase credentials, or database connection strings.
- [ ] **Reset API Keys:** Ensure Supabase anon/service keys and Telegram bot tokens are reset.
- [ ] **Clean Temp Files:** Delete `node_modules`, `dist`, `.vite`, `__pycache__`, `venv`, and `kernel.errors.txt`.
- [ ] **Verify `README.md` & `HANDOVER.md`:** Ensure local setup instructions work on a fresh machine.
- [ ] **Include `.env.example`:** Provide clean sample environment variable templates for desktop, portal, and server.

---

## 4. Handover Process for the Buyer

1. **Agreement & Escrow Payment:** Use Escrow.com or Acquire.com Escrow to lock buyer funds safely before transferring code.
2. **GitHub Repository Transfer:** Transfer ownership of `sutharprin098/visionguarda` directly to the buyer's GitHub account.
3. **Walkthrough Session:** Offer a 1-2 hour technical handover call to guide the buyer through running `server`, `desktop`, and `portal`.
4. **Escrow Release:** Buyer verifies codebase and approves fund release.
