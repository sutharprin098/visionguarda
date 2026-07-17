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
  bbox: { x1: number; y1: number; x2: number; y2: number };
}

export interface CameraTelemetry {
  people: number;
  vehicles: number;
  detections: TelemetryDetection[];
  fps?: number;
  latency?: number;
  inference_latency?: number;
  device?: string;
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
