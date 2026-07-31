# User Guide (Desktop App)

This covers the Windows desktop client (`desktop/`) — the primary interface for day-to-day monitoring.

## Getting started

1. Launch **CamAI Desktop** (or the Admin Studio build, if that's what was installed).
2. **First run**: enter your license key. The app fingerprints the machine, activates the license via Supabase, and stores the session locally (DPAPI-encrypted) — you won't be asked for the license key again on that machine. See [`SECURITY.md`](SECURITY.md) for what the fingerprint covers.
3. After activation, the app syncs your organization's assigned cameras and AI settings and opens the main workspace.

## Main workspace tabs

The workspace (`Workspace.tsx`) has four tabs, shown or hidden based on your role's permissions:

- **Cameras** — the live multi-camera grid. This is the default tab.
- **Alerts** — incident cards, notification center, and the incident detail window (evidence snapshots, track history).
- **Settings** — org, camera, and AI configuration (zone profile / "AI Mode" per camera lives here, not on the camera tile itself).
- **Engine** — local AI engine health: whether `server/` is running, which hardware backend it selected, per-camera pipeline status.

## Live monitoring

- Each camera tile shows the live MJPEG stream with a canvas overlay drawn from WebSocket telemetry (bounding boxes, track IDs, analytics events) — see [`ARCHITECTURE.md`](ARCHITECTURE.md) for why these are two separate feeds.
- Click into fullscreen (`FullscreenViewer.tsx`) for a single camera's detail view, including a performance HUD (`PerformanceOverlay.tsx`) showing pipeline FPS and latency.
- If the local engine isn't running on this machine, the app shows an explicit "engine isn't running" state rather than a frozen or blank tile.

## Alerts and incidents

- Alerts fire from any active detector (person/vehicle detection, zone rules, speed, ANPR, helmet, etc.) and appear as cards (`AlertCard.tsx`) with a live count in the notification center (`NotificationCenter.tsx`).
- Opening an alert shows the **Incident Window** (`IncidentWindow.tsx`): the triggering snapshot, track history, and — if recording is enabled for that camera — the associated clip.
- The same alert row that appears here is what gets sent to Telegram if your org has Telegram notifications enabled (Settings → Telegram) — there's no separate configuration for what Telegram receives versus what's shown here.

## Camera and AI configuration

- Add/manage cameras, zones, lines, and rules from **Settings**. A camera's active AI capabilities (which detectors run — helmet, ANPR, face, etc.) are set per-camera as a **zone profile / "AI Mode"**, applied by the engine live via realtime sync — no restart needed.
- Model tier (Fast / Balanced / Accurate — the YOLOX tiny/s/m tiers, see [`AI_ENGINE.md`](AI_ENGINE.md)) and detection confidence are configured in **Settings** and take effect immediately.
- **Engine health** (`EngineHealthPanel.tsx`) and **model management** (`ModelManagerUI.tsx`) are separate tools for diagnosing the local engine and switching detector tiers, respectively.

## Admin Studio

Organizations running the Admin Studio build get an additional administrative surface (`AdminStudio.tsx`) for org-wide configuration that mirrors what's available in the cloud portal (`portal/`), for environments that manage everything from the desktop rather than a browser.

## If something looks wrong

- **Tile shows no video**: check the Engine tab — the desktop does not start or manage the local AI engine process; `server/` must already be running.
- **Boxes are late or don't match the video**: this is expected under load — video and AI are decoupled by design (see [`ARCHITECTURE.md`](ARCHITECTURE.md)), so a slow AI pass delays the overlay, never the picture.
- **A device stopped syncing**: an admin may have deactivated it from the portal — reactivation requires entering the license key again.
