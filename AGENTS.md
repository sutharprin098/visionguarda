# Project Rules & Guidelines for CamAI

## 1. Zero Mock Detections Rule
- **NEVER** add hardcoded, simulated, or synthetic bounding boxes, track IDs, license plates, or speed tags into the frontend (`telemetryEngine.ts`, `DetectionOverlay.tsx`, `Workspace.tsx`).
- All detections and telemetry MUST come 100% directly from the real computer vision inference pipeline via WebSocket or camera API.

## 2. Editor & Linters
- Custom CSS directives (`@tailwind`, `@apply`, `@layer`) are configured to be ignored by CSS validator in `.vscode/settings.json`.
