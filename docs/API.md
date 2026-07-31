# API Reference

The local AI engine (`server/`) exposes a REST + WebSocket API on `127.0.0.1:8000` by design — it binds loopback and has no built-in network auth. It is meant to be fronted by `desktop/`, which is on the same machine. Interactive OpenAPI docs are always available at `/docs` while the engine is running. See [`SECURITY.md`](SECURITY.md) for the implications of this design choice.

## Authentication

Mutating endpoints (marked **control** below) require an `X-CamAI-Token` header, checked by `require_control_token` in `server/app/main.py`. Read-only endpoints (status, telemetry, cameras list, streams) do not require it.

## REST endpoints

All routes are defined in `server/app/main.py`.

| Method | Path | Control token | Purpose |
|---|---|:---:|---|
| GET | `/api/status` | | Per-camera engine status snapshot |
| POST | `/api/model/select` | ✓ | Switch the active detector tier (Fast/Balanced/Accurate) |
| GET / POST | `/api/detection/confidence` | POST ✓ | Read/set the detection confidence threshold |
| GET / POST | `/api/detection/tiling` | POST ✓ | Read/set tiling configuration |
| GET | `/api/cameras` | | List registered cameras |
| POST | `/api/cameras/test` | ✓ | Probe a camera source before registering it |
| POST | `/api/cameras/upload` | ✓ | Register a camera from an uploaded video file |
| POST | `/api/cameras` | ✓ | Register/start a camera |
| DELETE | `/api/cameras/{camera_id}` | ✓ | Remove a camera |
| POST | `/api/cameras/{camera_id}/config` | ✓ | Update zones/lines/rules/zone_profile for a camera |
| POST | `/api/cameras/{camera_id}/display` | ✓ | Set MJPEG max width / JPEG quality for a camera |
| POST | `/api/cameras/{camera_id}/recording` | ✓ | Enable/disable recording for a camera |
| GET | `/api/cameras/{camera_id}/telemetry` | | Latest telemetry snapshot for one camera |
| GET | `/api/cameras/{camera_id}/stream` | | MJPEG live stream (`multipart/x-mixed-replace`) |
| GET | `/api/alerts` | | List alerts |
| DELETE | `/api/alerts` | ✓ | Clear all alerts |
| DELETE | `/api/alerts/{alert_id}` | ✓ | Clear one alert |
| GET | `/api/history` | | Detection history |
| DELETE | `/api/history` | ✓ | Clear detection history |
| GET | `/api/recordings` | | List recorded clips |
| GET | `/api/history/logs` | | Structured event log |
| DELETE | `/api/history/logs` | ✓ | Clear event log |
| GET | `/api/traffic/speed-dashboard` | | Aggregated speed-violation stats |
| GET | `/api/traffic/speed-logs` | | Raw speed-event log |
| POST | `/api/traffic/speed-config` | ✓ | Set per-camera speed limit / calibration |
| GET | `/api/traffic/export` | | Export traffic data |
| GET | `/api/debug/gc` | ✓ | Force a GC pass / memory diagnostics |

`GET /api/cameras/{camera_id}/display` (or `/display` update) controls how large a frame the engine encodes for that camera's MJPEG stream — the desktop must call this to size a fullscreen viewer correctly, otherwise the camera stays pinned at a default resolution and gets upscaled client-side.

## WebSocket: `/ws`

A single WebSocket endpoint multiplexes telemetry for every subscribed camera. The engine validates the `Origin` header on connect and closes with code `1008` if it isn't allowlisted.

**Client → server messages** (JSON, `type` field selects the handler):

| `type` | Fields | Effect |
|---|---|---|
| `subscribe` | `camera_id` | Subscribe to a camera's telemetry; the server immediately replies with the camera's current state (not just future updates) so a newly-opened tile isn't blank until the next natural update |
| `unsubscribe` | `camera_id` | Stop receiving telemetry for a camera |
| `ping` | `ts` | Server replies `{"type": "pong", "ts": <echoed>}` |
| `screen_frame` | `camera_id`, `frame` (base64 JPEG) | Pushes a frame into a **virtual camera** (e.g. screen-share source); decoded off the event loop via a thread pool so it can't stall other cameras' telemetry |

**Server → client messages:**

| `type` | Shape | When |
|---|---|---|
| `telemetry` | `{"type": "telemetry", "data": {"<camera_id>": <telemetry object>}}` | Per-camera analytics/tracking result, pushed as the pipeline produces it and immediately on `subscribe` |
| `pong` | `{"type": "pong", "ts": <echoed>}` | Reply to `ping` |

The connection has an idle timeout (`WS_IDLE_TIMEOUT_SECS`) — a client that sends nothing for that long is closed server-side.

**No frame is ever sent over the WebSocket.** Video is the separate MJPEG stream at `/api/cameras/{camera_id}/stream`; the WebSocket is telemetry-only. This split is intentional — see [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Cloud API (Supabase Edge Functions)

`portal/` and `desktop/` talk to `supabase/functions/*` over HTTPS, not to the local engine directly (except `desktop/`, which also talks to its own local engine for live preview). See [`DATABASE.md`](DATABASE.md) for the Edge Function inventory and what each one does.
