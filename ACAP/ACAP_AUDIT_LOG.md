# CamAI ACAP Engineering Audit & Error Log
================================================================================

## Incident & Error Analysis Record

### Incident 1: `ReferenceError: isHttps is not defined`
- **Error Trace**:
  ```
  localEngine.js:1 [localEngine] camera sync failed: ReferenceError: isHttps is not defined
      at ft (session.js:29:56643)
      at Ti (session.js:29:56336)
      at J (localEngine.js:1:3063)
  ```
- **Root Cause**: In `session.ts`, the boolean check `isHttps` was used inside `getSupabaseSync()` without being defined as a `const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";`. When `localEngine.ts` invoked `getSupabase()`, it crashed synchronous execution.
- **Resolution**: Added explicit `isHttps` definition in `session.ts` and guarded `doSyncCamerasToLocalEngine` with `if (isAcapMode()) return;` to avoid invoking Supabase on standalone Axis camera hardware.

---

### Incident 2: Video Freeze on Fullscreen Exit (`ERR_CONNECTION_CLOSED`)
- **Error Trace**:
  ```
  Workspace.js:212 [Fullscreen] expanding camera to fill app window
  Workspace.js:212 [Fullscreen] telemetry subscribed
  Workspace.js:212 [Fullscreen] exit button clicked
  Workspace.js:212 [Fullscreen] restoring grid layout
  Workspace.js:212 [Fullscreen] telemetry unsubscribed
  video.cgi?resolution=800x450&fps=25:1 Failed to load resource: net::ERR_CONNECTION_CLOSED
  ```
- **Root Cause**:
  1. When Fullscreen opened, `Workspace.tsx` set `imgRef.current.src = ""` imperatively to pause the tile stream.
  2. When exiting fullscreen, React's virtual DOM reconciliation saw that the JSX prop `src` had not changed from `/axis-cgi/mjpg/video.cgi?resolution=800x450&fps=25`.
  3. Because React did not detect a prop change, it did NOT reassign `img.src` on the DOM node. The image element remained stuck at `src=""` (black/frozen).
  4. Concurrent teardown of the fullscreen connection and grid connection triggered transient `ERR_CONNECTION_CLOSED` from Axis VDO session cleanup.
- **Resolution**:
  - Implemented `useEffect([paused, c.id])` in `Workspace.tsx` that explicitly reattaches `imgRef.current.src = mjpegStreamUrl(c.id) + "?_t=" + Date.now()` whenever `paused` becomes `false`.
  - Added smooth reconnection backoff.

---

### Incident 3: 10-Second Video Drop (`ERR_HTTP2_PROTOCOL_ERROR`)
- **Error Trace**:
  ```
  video.cgi?resolution=800x450&fps=25:1 Failed to load resource: net::ERR_HTTP2_PROTOCOL_ERROR
  video.cgi?resolution=800x450&fps=25:1 Failed to load resource: net::ERR_CONNECTION_CLOSED
  ```
- **Root Cause**:
  1. Frontend was polling `/local/camai_acap/frame.cgi` 25 times per second.
  2. Axis OS Apache has a strict `CGIScriptTimeout` (10-15s) and limits process forks.
  3. 50+ process forks per second exhausted the ARM CPU and PID slots, causing Apache to kill the worker after 10 seconds.
- **Resolution**:
  - Replaced CGI polling with native Axis hardware MJPEG stream `/axis-cgi/mjpg/video.cgi?resolution=800x450&fps=25` (zero CPU overhead, continuous 25-30 FPS, infinite timeout).
  - Decoupled AWS AI worker into an in-memory pure Python daemon at 4-5 FPS.

---

### Incident 4: Clarification of Video FPS vs AI Inference FPS
- **Display Ambiguity**: When AWS returned AI detections at 5 FPS, the tile header showed "5.0 fps", causing confusion with the 25 FPS native video stream.
- **Resolution**: Updated HUD to clearly delineate:
  - `25 FPS (Video)` — Real-time native camera hardware stream.
  - `4.8 AI FPS` — Real-time AWS Cloud AI inference engine processing rate.
