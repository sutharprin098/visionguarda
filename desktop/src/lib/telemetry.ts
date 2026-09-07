// Per-camera telemetry subscription and normalized coordinate protocol over WebSocket (/ws).

export type TelemetryStatus = "idle" | "connecting" | "live" | "reconnecting";

/** Normalized bounding box (0..1) relative to original source frame */
export interface TelemetryDetection {
  class: string;
  confidence: number;
  track_id?: number | null;
  tracking_status?: string;
  speed?: number | null;
  speed_calibrated?: boolean;
  speed_status?: "calibrated" | "estimated" | "unavailable" | "disabled";
  direction?: string;
  dwell_time?: number;
  track_label?: string;
  speed_limit?: number;
  overspeed?: boolean;
  plate_text?: string | null;
  custom_match?: boolean;
  label?: string;
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

  // ── Performance overlay fields (see pipeline.py _telemetry_loop_iteration) ──
  /** Rate the capture thread is pulling frames off the source, before any AI.
   *  Diverging from `fps` is the clearest signal that the AI stage — not the
   *  camera — is the constraint. */
  camera_fps?: number;
  decode_fps?: number;
  inference_fps?: number;
  tracking_fps?: number;
  capture_latency?: number;
  preprocess_latency?: number;
  postprocess_latency?: number;
  tracking_latency?: number;
  total_latency?: number;
  /** Slowest stage this cycle, preformatted as "stage (12.3ms)". */
  bottleneck?: string;
  /** Frames discarded at each size-1 stage boundary since camera start.
   *  Latest-wins slots drop by design, so this is a rate indicator, not an
   *  error count — but WHICH boundary drops identifies the bottleneck. */
  dropped_frames?: Record<string, number>;
  dropped_total?: number;
  detection_count?: number;
  tracker_count?: number;
  cpu?: number;
  memory?: number;
  gpu?: number;
  gpu_memory?: number;
  gpu_temp?: number | null;
  imgsz?: number;
  /** Adaptive tile engine diagnostics, incl. the deadline-derived budget. */
  zoom_engine?: Record<string, unknown>;
  /** Capture-side connection state: online | connecting | offline |
   *  network_error | auth_failed. Anything other than "online" means the
   *  detector was never handed a frame, so `detections` being empty says
   *  nothing about the scene. */
  health_status?: string;
  /** Operator-readable reason the source has no video, null while healthy.
   *  Built by pipeline.PipelineCoordinator.source_error_text(). */
  source_error?: string | null;
  /** Real-time Zero-DCE night-vision low-light enhancement telemetry. */
  night_vision?: {
    zero_dce_applied: boolean;
    mean_luminance: number;
    method: string;
    latency_ms: number;
  };
}

/**
 * True when two detection payloads would draw an identical overlay.
 *
 * Detections arrive at AI FPS (~10-15Hz per camera) and every payload is a
 * fresh array, so committing each one to React state re-rendered the tile and
 * repainted the canvas at that rate whether or not anything had moved. Two
 * cases made that pure waste:
 *
 *   - A camera with no video sends an empty array forever. Every tick still
 *     produced a new `[]`, a new state identity, a re-render and a canvas
 *     clear. Seven idle cameras on a grid did this continuously.
 *   - A parked scene sends the same boxes at the same coordinates.
 *
 * Compares exactly the fields DetectionOverlay reads — bbox, class, track_id,
 * confidence, speed, overspeed, speed_limit and plate_text — and nothing else,
 * so a payload that differs only in a field nobody draws does not force a
 * repaint. bbox is compared at 1e-4 of the frame, which is sub-pixel at any
 * realistic display size.
 *
 * Deliberately NOT a deep equality helper: it must stay cheap enough to run on
 * every message, and it must fail towards "changed" so a missed repaint is
 * impossible.
 */
export function detectionsRenderEqual(
  a: TelemetryDetection[] | undefined,
  b: TelemetryDetection[] | undefined,
): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x === y) return true;
  if (x.length !== y.length) return false;
  const EPS = 1e-4;
  for (let i = 0; i < x.length; i++) {
    const p = x[i];
    const q = y[i];
    if (
      p.class !== q.class ||
      p.track_id !== q.track_id ||
      p.confidence !== q.confidence ||
      p.speed !== q.speed ||
      p.overspeed !== q.overspeed ||
      p.speed_limit !== q.speed_limit ||
      p.plate_text !== q.plate_text ||
      p.custom_match !== q.custom_match ||
      p.label !== q.label
    ) return false;
    if (
      Math.abs(p.bbox.x1 - q.bbox.x1) > EPS ||
      Math.abs(p.bbox.y1 - q.bbox.y1) > EPS ||
      Math.abs(p.bbox.x2 - q.bbox.x2) > EPS ||
      Math.abs(p.bbox.y2 - q.bbox.y2) > EPS
    ) return false;
  }
  return true;
}

const WS_URL = "ws://127.0.0.1:8000/ws";

class MultiTelemetryHub {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(t: CameraTelemetry) => void>>();
  private statusListeners = new Set<(s: TelemetryStatus) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private lastPongTs = 0;
  private lastPingTs = 0;

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  subscribe(cameraId: string, callback: (t: CameraTelemetry) => void): () => void {
    if (!this.listeners.has(cameraId)) {
      this.listeners.set(cameraId, new Set());
    }
    this.listeners.get(cameraId)!.add(callback);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "subscribe", camera_id: cameraId }));
      } catch { /* ignore */ }
    } else {
      this.connect();
    }

    return () => {
      const set = this.listeners.get(cameraId);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.listeners.delete(cameraId);
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ type: "unsubscribe", camera_id: cameraId }));
            } catch { /* ignore */ }
          }
        }
      }
    };
  }

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      this.ws = new WebSocket(WS_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.lastPongTs = Date.now();
      // Subscribe to all active camera IDs on connection
      this.listeners.forEach((_, cameraId) => {
        try {
          this.ws?.send(JSON.stringify({ type: "subscribe", camera_id: cameraId }));
        } catch { /* ignore */ }
      });
      this.startHeartbeat();
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === "pong") {
          this.lastPongTs = Date.now();
          return;
        }
        if (msg?.type === "telemetry" && msg.data) {
          Object.entries(msg.data).forEach(([camId, data]) => {
            const callbacks = this.listeners.get(camId);
            if (callbacks && callbacks.size > 0) {
              callbacks.forEach((fn) => fn(data as CameraTelemetry));
            }
          });
        }
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.stopHeartbeat();
      if (this.listeners.size > 0) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => { /* handled in onclose */ };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongTs > 15000) {
        try { this.ws.close(); } catch { /* ignore */ }
        return;
      }
      try {
        this.lastPingTs = Date.now();
        this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      } catch { /* ignore */ }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 10000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

export const telemetryHub = new MultiTelemetryHub();

export class TelemetrySession {
  private cameraId: string;
  private onData: (t: CameraTelemetry) => void;
  private onStatus?: (s: TelemetryStatus) => void;
  private unsubscribeFn: (() => void) | null = null;
  private stats = { rttMs: 0, gapMs: 0, parseMs: 0, received: 0 };

  constructor(cameraId: string, onData: (t: CameraTelemetry) => void, onStatus?: (s: TelemetryStatus) => void) {
    this.cameraId = cameraId;
    this.onData = onData;
    this.onStatus = onStatus;
  }

  getStats(): { rttMs: number; gapMs: number; parseMs: number; received: number } {
    return { ...this.stats };
  }

  start(): void {
    if (this.unsubscribeFn) return;
    this.onStatus?.("live");
    this.unsubscribeFn = telemetryHub.subscribe(this.cameraId, (data) => {
      this.stats.received++;
      this.onData(data);
    });
  }

  stop(): void {
    if (this.unsubscribeFn) {
      this.unsubscribeFn();
      this.unsubscribeFn = null;
    }
    this.onStatus?.("idle");
  }
}
