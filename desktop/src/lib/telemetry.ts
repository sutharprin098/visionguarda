// Subscribes to the local AI engine's per-camera telemetry over /ws.
//
// The engine has always produced detections (server/app/ai/pipeline.py builds
// `client_dets` every AI cycle and main.py pushes them to subscribers), but the
// desktop renderer never consumed them — the word "detections" did not appear
// anywhere under desktop/src. Workspace showed the raw MJPEG <img> (or the
// local <video> while sharing) with nothing drawn on top, which is why a live
// stream with zero boxes looked like "AI inference is not working" when
// inference was in fact fine. The overlay stack existed only in the legacy
// client/ web app (client/src/contexts/TelemetryContext.tsx et al).
//
// Same 127.0.0.1 / heartbeat / backoff reasoning as lib/mediaShare.ts — see the
// long note there about localhost resolving to ::1 and stalling every reconnect.

export type TelemetryStatus = "idle" | "connecting" | "live" | "reconnecting";

/** bbox values are NORMALISED to the source frame (0..1), not pixels.
 *  pipeline.py:1364 divides by orig_w/orig_h before sending. Drawing them as
 *  pixels yields a 1px box in the top-left corner — i.e. invisible. */
export interface TelemetryDetection {
  class: string;
  confidence: number;
  track_id?: number | null;
  tracking_status?: string;
  /** km/h, or null when no honest number exists.
   *
   *  Automatic: the engine derives metres-per-pixel from the object's own pixel
   *  height against a real-world prior (analytics.CLASS_HEIGHT_M — a car is
   *  ~1.5m tall), so speed works on a bare camera with nothing drawn. A two-line
   *  gate, when configured, overrides it with a true measurement.
   *
   *  ALWAYS check speed_calibrated before treating this as fact. An estimate is
   *  ~+/-20-30%: the height prior is a class average, and a vehicle driving
   *  straight at the camera reads low because it covers little pixel distance.
   *  The engine will not raise a speeding alert from an estimate, and neither
   *  should any UI present one as a measurement. */
  speed?: number | null;
  /** True only for a gate-measured reading. Never true for the auto estimate. */
  speed_calibrated?: boolean;
  /** Where the number came from:
   *   - "calibrated"  — measured by a two-line gate; act on it
   *   - "estimated"   — auto-derived from object size; indicative only
   *   - "unavailable" — no size prior for this class, or the box is clipped by
   *                     the frame edge so its height would mislead the scale
   *   - "disabled"    — the camera's Speed Estimation toggle is off */
  speed_status?: "calibrated" | "estimated" | "unavailable" | "disabled";
  direction?: string;
  /** Seconds this track has been in frame (analytics sets it from first_seen). */
  dwell_time?: number;
  /** OCR-read plate number, on number_plate detections only. null when the
   *  plate was localised but not read (no OCR model, or OCR failed). */
  plate_text?: string | null;
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

export interface CameraTelemetry {
  people: number;
  vehicles: number;
  items?: number;
  detections: TelemetryDetection[];
  counters?: {
    in?: number; out?: number;
    people_in?: number; people_out?: number;
    vehicles_in?: number; vehicles_out?: number;
  };
  zone_stats?: unknown[];
  line_stats?: unknown[];
  crowd_stats?: unknown;
  /** {alert_type: count} since the camera started, reset on a profile switch.
   *  Alert types come from analytics.py — e.g. zone_intrusion, loitering,
   *  wrong_way, speed_limit, fall_alert, face_detection. */
  alert_counts?: Record<string, number>;
  fps?: number;
  latency?: number;
  inference_latency?: number;
  /** 0 whenever the face module is off — see pipeline.py's face gate. */
  face_latency?: number;
  device?: string;
  backend?: string;
  status?: string;
}

const WS_URL = "ws://127.0.0.1:8000/ws";
// The engine closes any socket that sends nothing for WS_IDLE_TIMEOUT_SECS=30
// (main.py:184-199). A telemetry subscriber is otherwise receive-only, so
// without this ping it would be dropped every 30s and reconnect-loop forever.
// mediaShare never hit this because it pushes a frame every 100ms.
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 12000;
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

export class TelemetrySession {
  private cameraId: string;
  private onData: (t: CameraTelemetry) => void;
  private onStatus?: (s: TelemetryStatus) => void;

  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPongTs = 0;
  private reconnectAttempt = 0;
  private stopped = true;

  constructor(cameraId: string, onData: (t: CameraTelemetry) => void, onStatus?: (s: TelemetryStatus) => void) {
    this.cameraId = cameraId;
    this.onData = onData;
    this.onStatus = onStatus;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* already closing */ }
    }
    this.onStatus?.("idle");
  }

  private connect(): void {
    if (this.stopped || this.ws) return;
    this.onStatus?.(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.lastPongTs = Date.now();
      try {
        ws.send(JSON.stringify({ type: "subscribe", camera_id: this.cameraId }));
      } catch { /* onclose will drive the reconnect */ }
      this.onStatus?.("live");
      this.startHeartbeat();
    };

    ws.onmessage = (evt) => {
      let msg: any;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return; // not JSON — nothing this client understands
      }
      if (msg?.type === "pong") {
        this.lastPongTs = Date.now();
        return;
      }
      // { type: "telemetry", data: { "<camera_id>": {...} } }  — main.py:70-81
      if (msg?.type === "telemetry" && msg.data) {
        const mine = msg.data[this.cameraId];
        if (mine) this.onData(mine as CameraTelemetry);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.clearTimers();
      if (this.stopped) return;
      this.scheduleReconnect();
    };

    // onerror is followed by onclose; reconnect is driven from there only, so a
    // single failure can't schedule two overlapping reconnects.
    ws.onerror = () => { /* handled via onclose */ };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongTs > HEARTBEAT_TIMEOUT_MS) {
        // Socket looks open but the engine stopped answering — force the
        // close path so backoff/reconnect takes over.
        try { ws.close(); } catch { /* already gone */ }
        return;
      }
      try {
        ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      } catch { /* onclose will fire */ }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private clearTimers(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.onStatus?.("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
