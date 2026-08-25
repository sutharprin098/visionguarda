# Upwork Proposal — Computer Vision Developer Required (NZ Security Monitoring)

> 🎯 **Job Target:** New Zealand Remote Video Monitoring Centre — Windows Desktop App for Screen/Chrome Motion & Object Highlight.
> 💰 **Estimated Budget:** Phase 1 PoC: $750 | Phase 2 Production: $3,000

---

## 📩 Copy-Paste Upwork Proposal

```text
Hi there,

I read your job post carefully regarding your remote video monitoring centre in New Zealand. You need a lightweight Windows desktop application that runs alongside/over Google Chrome to visually highlight subtle movements (rodents, insects, birds, distant human movement, night footage) with bounding boxes for your operators.

I have already built an enterprise Windows desktop application (built with Electron, Python PyTorch/OpenCV, and Windows Graphics Capture API) designed for real-time CCTV stream/screen region monitoring and motion telemetry overlays.

Here is how our solution solves your exact problem:

1. Screen Region Monitoring (WGC API):
The Windows app lets operators select or snap to the Google Chrome video player window. It captures the region at 30+ FPS using high-performance hardware-accelerated Windows Graphics Capture (zero CPU lag).

2. Motion Amplification & Bounding Boxes:
It runs a dual-layer Computer Vision engine:
• Frame-Differencing & Motion Heatmaps: Highlights subtle pixel movement (even small rodents, insects, or distant movement in low-light/night conditions) with high-contrast glowing overlays.
• Object Detection & Tracking (YOLO/PyTorch): Draws real-time bounding boxes around detected moving objects to immediately draw the operator’s eye.

3. Lightweight & Non-Intrusive:
Runs as a sleek desktop overlay window or side panel next to Chrome without interfering with your web player controls.

---

📋 Cost & Timeline Estimates:

• Phase 1: Proof of Concept (PoC)
- Deliverable: A working Windows desktop application that monitors the Chrome screen area, detects movement, and overlays bounding boxes/motion highlights in real-time.
- Timeline: 3 Days
- Cost Estimate: $750 USD

• Phase 2: Finished Production Application
- Deliverable: Full-featured, reliable desktop application with custom sensitivity sliders, vegetation/false-positive AI suppression, multi-monitor support, and offline installer.
- Timeline: 7 to 10 Days
- Cost Estimate: $3,000 USD

📁 Demonstration & Technical Overview:
• System Architecture & Telemetry Overview: https://camai-enterprise-overview.vercel.app
• Live Web Portal: https://camai.princesite.in

I am ready to share my screen on a short Zoom call to show you a live working demonstration of our Windows screen-capture AI overlay engine.

Best regards,
Prince
Lead AI Computer Vision Engineer
```
