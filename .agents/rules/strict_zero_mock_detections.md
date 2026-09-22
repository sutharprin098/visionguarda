# Strict Zero Mock Detections Rule

## Critical Mandate: NO SYNTHETIC / MOCK DETECTIONS IN FRONTEND

1. **Strict Zero-Mock Guarantee**:
   - Under NO circumstances should mock, hardcoded, simulated, or synthetic bounding boxes, track IDs, license plates, or speed tags be added to `telemetryEngine.ts` or any frontend UI code.
   - All bounding boxes, tracking markers, confidences, speeds, and labels must come **100% EXCLUSIVELY** from the authentic backend computer vision pipeline (`WebSocket` / backend API).

2. **Offline Behavior**:
   - If the WebSocket or backend vision engine is offline or disconnected, set `connectionStatus` to `"offline"` or `"connecting"` and clear detections.
   - DO NOT inject synthetic or hardcoded coordinates into `telemetryEngine.ts`.
