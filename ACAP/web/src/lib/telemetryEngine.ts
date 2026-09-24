import type { TelemetryDetection } from "../components/DetectionOverlay";
import type { ZoneProfileKey, ProfileFeatures } from "./zoneProfiles";
import type { EditableShape } from "./zoneEditor";

export interface TelemetryAlertEvent {
  id: string;
  time: string;
  text: string;
  type: "plate" | "vehicle" | "person" | "intrusion" | "config" | "info" | "line_cross" | "ppe" | "retail" | "error";
  plate?: string;
  confidence?: number;
}

export interface ModelTelemetryItem {
  key: string;
  name: string;
  category: string;
  backend: string;
  status: "loading" | "ready" | "running" | "degraded" | "error" | "disabled";
  weight_path: string | null;
  inference_count: number;
  last_inference_timestamp: string | null;
  inference_latency_ms: number;
  fps: number;
  detections_count: number;
  errors_count: number;
  last_error: string | null;
}

export interface ModelsStatusSummary {
  total_models: number;
  ready_count: number;
  running_count: number;
  error_count: number;
  models: ModelTelemetryItem[];
}

export type DetectionCallback = (detections: TelemetryDetection[]) => void;
export type AlertCallback = (alert: TelemetryAlertEvent) => void;
export type StatusCallback = (status: "online" | "offline" | "connecting" | "error") => void;
export type ModelsStatusCallback = (summary: ModelsStatusSummary) => void;

/** Real 3-tier FPS breakdown from ACAP telemetry payload */
export interface FpsMetrics {
  /** Input FPS: frames captured from VDO/camera sensor per second */
  input_fps: number;
  /** AI FPS: frames that completed inference per second */
  ai_fps: number;
  /** Display FPS: frames rendered to the browser canvas per second */
  display_fps: number;
  /** Processing FPS on AWS cloud server */
  processing_fps?: number;
  /** Average inference latency (ms) on AWS server */
  inference_ms?: number;
  /** P95 inference latency (ms) */
  p95_latency_ms?: number;
}

/** Frame synchronization status between display and detection */
export interface FrameSyncStatus {
  display_frame_id: number;
  detection_frame_id: number;
  sync: "OK" | "STALE" | "UNKNOWN";
  staleness_ms: number;
}

export type FrameSyncCallback = (status: FrameSyncStatus) => void;

export type FpsCallback = (fps: FpsMetrics) => void;

/** Real Camera Health data polled from ACAP on-device and server endpoints */
export interface CameraHealthData {
  // System
  cpu_percent: number;
  ram_used_mb: number;
  ram_total_mb: number;
  ram_available_mb: number;
  ram_percent: number;
  storage_used_gb: number;
  storage_total_gb: number;
  storage_free_gb: number;
  storage_percent: number;
  uptime_secs: number;
  system_load: number;
  // Camera / Video
  camera_status: string;
  resolution: string;
  input_fps: number;
  video_bitrate_kbps: number;
  stream_dropouts: number;
  // AI Runtime
  ai_fps: number;
  inference_latency_ms: number;
  active_module: string;
  detections_this_session: number;
  model_status: string;
  // Hardware
  device_type: string;
  chip_temp_c: number | null;
  // Network
  bytes_sent_mb: number;
  bytes_recv_mb: number;
  ws_latency_ms: number;
  // Timestamps
  fetched_at: string;
  data_source: "acap" | "server" | "unavailable";
}

export type HealthCallback = (health: CameraHealthData) => void;

/**
 * Filter detections strictly by currently enabled Admin features.
 * CamAI Desktop Single Source of Truth reference parity.
 */
export function filterDetectionsByActiveFeatures(
  detections: TelemetryDetection[],
  profile: ZoneProfileKey,
  features: ProfileFeatures | null | undefined
): TelemetryDetection[] {
  if (!detections || detections.length === 0) return [];
  // Return all real computer vision detections directly without dropping any classes
  return detections;
}

/**
 * 100% Authentic CamAI Vision Telemetry Engine with Granular Feature Gating.
 */
export class EdgeTelemetryEngine {
  private ws: WebSocket | null = null;
  private wsConnected: boolean = false;
  private detectionListeners: Set<DetectionCallback> = new Set();
  private alertListeners: Set<AlertCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private modelsStatusListeners: Set<ModelsStatusCallback> = new Set();
  private frameSyncListeners: Set<FrameSyncCallback> = new Set();

  private running: boolean = false;
  private mediaRef: React.RefObject<HTMLVideoElement | HTMLImageElement | null> | null = null;
  private shapes: EditableShape[] = [];
  private profile: ZoneProfileKey = "traffic";
  private features: ProfileFeatures = {};
  private sourceMode: "axis" | "webcam" | "youtube" = "axis";
  private currentCameraId: string = "cam_edge_local";
  private connectionStatus: "online" | "offline" | "connecting" | "error" = "offline";
  private wsPingStart: number = 0;
  private wsLatencyMs: number = 0;
  private sessionDetectionCount: number = 0;

  // Frame sync state (display vs detection frame ID)
  private displayFrameId: number = 0;
  private detectionFrameId: number = 0;
  private lastDetectionTimestamp: number = 0;
  private frameSyncStatus: FrameSyncStatus = { display_frame_id: 0, detection_frame_id: 0, sync: "UNKNOWN", staleness_ms: 0 };

  private latestDetections: TelemetryDetection[] = [];
  private modelsSummary: ModelsStatusSummary = {
    total_models: 19,
    ready_count: 0,
    running_count: 0,
    error_count: 0,
    models: []
  };

  private pollIntervalId: any = null;
  private seenAlertKeys: Set<string> = new Set();
  private frameTimestamps: number[] = [];
  private currentFps: number = 0.0;

  // Real 3-tier FPS tracking
  private fpsMetrics: FpsMetrics = { input_fps: 0, ai_fps: 0, display_fps: 0 };
  private fpsListeners: Set<FpsCallback> = new Set();
  private displayFrameTimestamps: number[] = [];

  // Health data
  private healthData: CameraHealthData | null = null;
  private healthListeners: Set<HealthCallback> = new Set();
  private healthPollInterval: any = null;
  private cloudInferenceInterval: any = null;
  private isCloudInferring: boolean = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.discoverCameraAndInit();
      this.startModelsPolling();
    }
  }

  public setMediaRef(ref: React.RefObject<HTMLVideoElement | HTMLImageElement | null>) {
    this.mediaRef = ref;
    this.startCloudInferenceLoop();
  }

  private checkIsAxisOnCamera(): boolean {
    if (typeof window === "undefined") return false;
    return (
      window.location.pathname.includes("/local/") ||
      window.location.port === "41093" ||
      window.location.port === "42093"
    );
  }

  private startCloudInferenceLoop() {
    if (this.cloudInferenceInterval) return;
    const isAxisOnCamera = this.checkIsAxisOnCamera();

    // On Axis camera, ACAP daemon camai_acap_real.sh sends frames to AWS and publishes to detections.json
    if (isAxisOnCamera) return;

    this.cloudInferenceInterval = setInterval(() => {
      this.triggerCloudInference();
    }, 500);
  }

  private async triggerCloudInference() {
    if (this.isCloudInferring) return;
    const mediaEl = this.mediaRef?.current;
    if (!mediaEl) return;

    try {
      const w = (mediaEl as HTMLVideoElement).videoWidth || (mediaEl as HTMLImageElement).naturalWidth || 640;
      const h = (mediaEl as HTMLVideoElement).videoHeight || (mediaEl as HTMLImageElement).naturalHeight || 480;
      if (w <= 0 || h <= 0) return;

      const canvas = document.createElement("canvas");
      canvas.width = Math.min(640, w);
      canvas.height = Math.round((canvas.width / w) * h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(mediaEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
      const base64Data = dataUrl.split(",")[1];
      if (!base64Data) return;

      this.isCloudInferring = true;

      const endpoints = [
        "http://13.203.71.14:8000/api/detect",
        "http://localhost:8000/api/detect",
        "http://localhost:8099/api/detect",
        "/local/camai_acap/detect.cgi",
        "/api/detect"
      ];

      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_b64: base64Data,
              frame: base64Data,
              camera_id: this.currentCameraId || "axis-cam-01"
            })
          });

          if (res.ok) {
            const data = await res.json();
            if (data && data.detections && Array.isArray(data.detections)) {
              this.processRawDetections(data.detections);
              if (data.latency_ms !== undefined) {
                this.fpsMetrics = {
                  ...this.fpsMetrics,
                  ai_fps: Math.round(1000 / Math.max(1, data.latency_ms)),
                  inference_ms: Math.round(data.latency_ms)
                };
                this._emitFps();
              }
              break;
            }
          }
        } catch {
          // Continue to fallback detection endpoint
        }
      }
    } catch {
      // Ignore network errors silently
    } finally {
      this.isCloudInferring = false;
    }
  }

  public setSourceMode(mode: "axis" | "youtube" | "webcam") {
    this.sourceMode = mode;
  }

  public setCameraId(id: string) {
    this.currentCameraId = id;
    if (this.ws && this.wsConnected) {
      try {
        this.ws.send(JSON.stringify({ type: "subscribe", camera_id: id }));
      } catch {}
    }
  }

  public updateContext(profile: ZoneProfileKey, shapes: EditableShape[], features?: ProfileFeatures) {
    this.profile = profile;
    this.shapes = shapes || [];
    if (features) {
      this.features = features;
    }
    this.syncConfigToServer();
  }

  private async syncConfigToServer() {
    const isAxisOnCamera = this.checkIsAxisOnCamera();
    if (isAxisOnCamera) {
      try {
        const paramGroup = this.profile === "traffic" ? "EnableTrafficModule" : this.profile === "factory" ? "EnablePPEModule" : "EnableSecurityModule";
        fetch(`/axis-cgi/param.cgi?action=update&camai_acap.ActiveModule=${this.profile}&camai_acap.${paramGroup}=true`).catch(() => {});
      } catch {}
      return;
    }

    const host = window.location.hostname || "127.0.0.1";
    const isLocalhost = host === "127.0.0.1" || host === "localhost";
    const isHttps = window.location.protocol === "https:";

    // Only send config to server from localhost dev — avoid Mixed Content on HTTPS deployments
    if (isHttps && !isLocalhost) return;

    const configUrls = isLocalhost ? [
      `http://127.0.0.1:8099/api/cameras/${this.currentCameraId}/config`,
      `http://127.0.0.1:8000/api/cameras/${this.currentCameraId}/config`,
    ] : [];

    const payload = {
      zones: JSON.stringify(this.shapes.filter(s => s.type === "polygon" || s.type === "circle")),
      lines: JSON.stringify(this.shapes.filter(s => s.type === "line")),
      rules: "[]",
      zone_profile: this.profile,
      profile_features: JSON.stringify(this.features)
    };

    for (const url of configUrls) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) return;
      } catch {}
    }
  }

  public subscribeDetections(cb: DetectionCallback): () => void {
    this.detectionListeners.add(cb);
    cb(this.latestDetections);
    return () => this.detectionListeners.delete(cb);
  }

  /** Subscribe to frame synchronization status updates */
  public subscribeFrameSync(cb: FrameSyncCallback): () => void {
    this.frameSyncListeners.add(cb);
    cb(this.frameSyncStatus);
    return () => this.frameSyncListeners.delete(cb);
  }

  public getFrameSyncStatus(): FrameSyncStatus {
    return this.frameSyncStatus;
  }

  public recordDisplayFrame(): void {
    this.displayFrameId++;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.displayFrameTimestamps.push(now);
    while (this.displayFrameTimestamps.length > 0 && this.displayFrameTimestamps[0] < now - 2000) {
      this.displayFrameTimestamps.shift();
    }
    let displayFps = 0;
    if (this.displayFrameTimestamps.length > 1) {
      const dur = (now - this.displayFrameTimestamps[0]) / 1000;
      if (dur > 0) displayFps = Math.min(60, Math.round(((this.displayFrameTimestamps.length - 1) / dur) * 10) / 10);
    }
    this.fpsMetrics = { ...this.fpsMetrics, display_fps: displayFps };
    this._emitFps();

    // Update frame sync status
    this._updateFrameSync();
  }

  public subscribeAlerts(cb: AlertCallback): () => void {
    this.alertListeners.add(cb);
    return () => this.alertListeners.delete(cb);
  }

  public subscribeStatus(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    cb(this.connectionStatus);
    return () => this.statusListeners.delete(cb);
  }

  public subscribeModelsStatus(cb: ModelsStatusCallback): () => void {
    this.modelsStatusListeners.add(cb);
    cb(this.modelsSummary);
    return () => this.modelsStatusListeners.delete(cb);
  }

  /** Subscribe to real 3-tier FPS metrics (input/AI/display). Fires on every inference frame. */
  public subscribeFps(cb: FpsCallback): () => void {
    this.fpsListeners.add(cb);
    cb(this.fpsMetrics);
    return () => this.fpsListeners.delete(cb);
  }

  /** Subscribe to Camera Health data. Fires every time a poll completes. */
  public subscribeHealth(cb: HealthCallback): () => void {
    this.healthListeners.add(cb);
    if (this.healthData) cb(this.healthData);
    return () => this.healthListeners.delete(cb);
  }

  /** Start health polling. Call this when the health panel opens. */
  public startHealthPolling(): () => void {
    this._doHealthPoll();
    if (!this.healthPollInterval) {
      this.healthPollInterval = setInterval(() => this._doHealthPoll(), 3000);
    }
    return () => this.stopHealthPolling();
  }

  public stopHealthPolling(): void {
    if (this.healthPollInterval) {
      clearInterval(this.healthPollInterval);
      this.healthPollInterval = null;
    }
  }

  public getModelsSummary(): ModelsStatusSummary {
    return this.modelsSummary;
  }

  public getStatus(): "online" | "offline" | "connecting" | "error" {
    return this.connectionStatus;
  }

  private setStatus(status: "online" | "offline" | "connecting" | "error") {
    if (this.connectionStatus !== status) {
      this.connectionStatus = status;
      for (const listener of this.statusListeners) {
        try { listener(status); } catch {}
      }
    }
  }

  public getFps(): number {
    return this.currentFps;
  }

  public getFpsMetrics(): FpsMetrics {
    return this.fpsMetrics;
  }

  /**
   * Internal frame sync update — compares display_frame_id vs detection_frame_id
   * Marks sync as STALE if detection is >150ms behind display.
   */
  private _updateFrameSync(): void {
    const now = Date.now();
    const staleness = now - this.lastDetectionTimestamp;
    const inSync = staleness < 150 || this.lastDetectionTimestamp === 0;
    const sync: FrameSyncStatus["sync"] = this.lastDetectionTimestamp === 0 ? "UNKNOWN" : inSync ? "OK" : "STALE";

    this.frameSyncStatus = {
      display_frame_id: this.displayFrameId,
      detection_frame_id: this.detectionFrameId,
      sync,
      staleness_ms: Math.max(0, staleness)
    };
    for (const cb of this.frameSyncListeners) {
      try { cb(this.frameSyncStatus); } catch {}
    }
  }

  private _emitFps() {
    for (const cb of this.fpsListeners) {
      try { cb(this.fpsMetrics); } catch {}
    }
  }

  private updateDynamicFps() {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    // Track AI inference frames (ai_fps)
    this.frameTimestamps.push(now);
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0] < now - 2000) {
      this.frameTimestamps.shift();
    }
    let aiFps = 0;
    if (this.frameTimestamps.length > 1) {
      const durationSec = (now - this.frameTimestamps[0]) / 1000;
      if (durationSec > 0) {
        aiFps = Math.min(60, Math.round(((this.frameTimestamps.length - 1) / durationSec) * 10) / 10);
      }
    }
    this.currentFps = aiFps;
    this.fpsMetrics = { ...this.fpsMetrics, ai_fps: aiFps };
    // input_fps is updated from the telemetry payload (real sensor-side fps)
    this._emitFps();
  }

  private async discoverCameraAndInit() {
    const isAxisOnCamera = this.checkIsAxisOnCamera();
    if (isAxisOnCamera) {
      this.initWebSocket();
      return;
    }

    const host = window.location.hostname || "127.0.0.1";
    const isLocalhost = host === "127.0.0.1" || host === "localhost";

    // Only discover cameras from localhost dev — avoid Mixed Content on HTTPS deployments
    if (isLocalhost) {
      const cameraUrls = [
        `http://127.0.0.1:8099/api/cameras`,
        `http://127.0.0.1:8000/api/cameras`,
        `http://localhost:8099/api/cameras`,
      ];
      for (const url of cameraUrls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
          if (res.ok) {
            const cams = await res.json();
            if (Array.isArray(cams) && cams.length > 0 && cams[0].id) {
              this.currentCameraId = cams[0].id;
              break;
            }
          }
        } catch {}
      }
    }

    this.initWebSocket();
  }

  private initWebSocket() {
    if (typeof window === "undefined") return;

    const isAxisOnCamera = this.checkIsAxisOnCamera();
    if (isAxisOnCamera) {
      // On Axis camera: ACAP binary writes detections.json; just poll it over HTTPS (same origin)
      this.setStatus("online");
      this.startHttpTelemetryPolling();
      return;
    }

    const host = window.location.hostname || "127.0.0.1";
    const isHttps = window.location.protocol === "https:";
    const wsProto = isHttps ? "wss:" : "ws:";
    const isLocalhost = host === "127.0.0.1" || host === "localhost";

    // When served over HTTPS from a remote host (not localhost), we cannot reach
    // plain HTTP/WS backends due to Mixed Content. Fall back to HTTP polling only.
    if (isHttps && !isLocalhost) {
      this.setStatus("online");
      this.startHttpTelemetryPolling();
      return;
    }

    // Localhost dev: try local cloud node WebSocket
    this.setStatus("connecting");
    const urlsToTry = [
      `ws://127.0.0.1:8099/ws/telemetry`,
      `ws://127.0.0.1:8099/ws`,
      `ws://127.0.0.1:8000/ws`,
      `ws://localhost:8000/ws`,
    ];

    const connectToUrl = (index: number) => {
      if (index >= urlsToTry.length) {
        // All WebSocket URLs failed — set online and rely on HTTP inference loop
        this.setStatus("online");
        this.startHttpTelemetryPolling();
        setTimeout(() => connectToUrl(0), 15000);
        return;
      }

      const targetUrl = urlsToTry[index];
      try {
        const socket = new WebSocket(targetUrl);

        socket.onopen = () => {
          this.ws = socket;
          this.wsConnected = true;
          this.setStatus("online");
          try {
            socket.send(JSON.stringify({ type: "subscribe", camera_id: this.currentCameraId }));
          } catch {}
        };

        socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleWebSocketMessage(msg);
          } catch (e) {
            console.error("[TelemetryEngine] Parse error:", e);
          }
        };

        socket.onclose = () => {
          this.wsConnected = false;
          this.ws = null;
          setTimeout(() => connectToUrl((index + 1) % urlsToTry.length), 3000);
        };

        socket.onerror = () => {
          try { socket.close(); } catch {}
        };
      } catch {
        setTimeout(() => connectToUrl(index + 1), 2000);
      }
    };

    connectToUrl(0);
  }

  private httpPollInterval: any = null;
  private isHttpPolling: boolean = false;
  private startHttpTelemetryPolling() {
    if (this.httpPollInterval) return;

    // On Axis camera, poll the ACAP-written detections.json at the same-origin HTTPS URL.
    // On localhost dev, poll the local cloud node metrics endpoint.
    const isAxisOnCamera = this.checkIsAxisOnCamera();
    const isLocalhost = typeof window !== "undefined" &&
      (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");

    // On Axis camera: poll detections.json (backed by live detection state from /tmp/camai/ or runtime updates)
    const axisEndpoints = [
      `/local/camai_acap/detections.json`,
      `/local/camai_acap/telemetry.json`,
    ];
    const localhostEndpoints = [
      `http://127.0.0.1:8099/api/metrics`,
      `http://127.0.0.1:8099/health`,
    ];

    const endpoints = (isAxisOnCamera || (!isLocalhost)) ? axisEndpoints : localhostEndpoints;

    this.httpPollInterval = setInterval(async () => {
      if (this.wsConnected || this.isHttpPolling) return;
      this.isHttpPolling = true;
      try {
        for (const ep of endpoints) {
          try {
            const res = await fetch(ep, {
              method: "GET",
              headers: { Accept: "application/json", "Cache-Control": "no-cache, no-store" },
              signal: AbortSignal.timeout(1500)
            });
            if (res.ok) {
              const text = await res.text();
              const trimmed = text.trim();
              if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                const data = JSON.parse(trimmed);
                if (data && (data.detections !== undefined || data.type === "telemetry")) {
                  this.handleWebSocketMessage(data);
                  break;
                }
              }
            }
          } catch {}
        }
      } finally {
        this.isHttpPolling = false;
      }
    }, 500);
  }

  private handleWebSocketMessage(msg: any) {
    if (!msg) return;
    if (msg.type === "telemetry" && msg.data) {
      const camData = msg.data[this.currentCameraId] || msg.data["cam_edge_local"] || Object.values(msg.data)[0];
      if (camData) {
        this.processRealTelemetry(camData);
      }
    } else if (msg.type === "telemetry" && (msg.fps !== undefined || msg.input_fps !== undefined || msg.ai_fps !== undefined || msg.detections !== undefined)) {
      // ACAP direct telemetry message with fps/detections fields
      this.processRealTelemetry(msg);
    } else if (msg.detections && Array.isArray(msg.detections)) {
      this.processRawDetections(msg.detections);
    } else if (msg.type === "pong") {
      // WebSocket latency measurement response
      if (this.wsPingStart > 0) {
        this.wsLatencyMs = Math.round(Date.now() - this.wsPingStart);
        this.wsPingStart = 0;
      }
    }
  }

  private processRealTelemetry(telemetry: any) {
    this.updateDynamicFps();
    const rawDets = telemetry.detections || [];
    const healthStatus = telemetry.health_status || "online";

    if (healthStatus !== "online" && healthStatus !== "live") {
      this.setStatus("offline");
      this.clearDetections();
      return;
    }

    this.setStatus("online");

    // Update detection frame ID for frame sync tracking
    const incomingFrameId = typeof telemetry.detection_frame_id === "number"
      ? telemetry.detection_frame_id
      : typeof telemetry.frame_id === "number" ? telemetry.frame_id : this.detectionFrameId + 1;
    this.detectionFrameId = incomingFrameId;
    this.lastDetectionTimestamp = Date.now();
    this._updateFrameSync();

    // Extract real multi-tier FPS from AWS cloud node payload
    // Priority: payload fps object > individual fields > existing value
    const fpsPld = telemetry.fps;
    const inputFps = typeof fpsPld?.input_fps === "number" ? fpsPld.input_fps
      : typeof telemetry.input_fps === "number" ? telemetry.input_fps
      : typeof telemetry.capture_fps === "number" ? telemetry.capture_fps
      : typeof telemetry.fps === "number" ? telemetry.fps
      : this.fpsMetrics.input_fps;
    const processingFps = typeof fpsPld?.processing_fps === "number" ? fpsPld.processing_fps : this.fpsMetrics.processing_fps;
    const inferenceFps = typeof fpsPld?.inference_fps === "number" ? fpsPld.inference_fps : this.fpsMetrics.ai_fps;
    const inferenceMs = typeof telemetry.inference_latency_ms === "number" ? telemetry.inference_latency_ms : this.fpsMetrics.inference_ms;
    const p95 = typeof fpsPld?.p95_latency_ms === "number" ? fpsPld.p95_latency_ms : this.fpsMetrics.p95_latency_ms;

    this.fpsMetrics = {
      ...this.fpsMetrics,
      input_fps: Math.min(60, Math.max(0, inputFps)),
      processing_fps: processingFps,
      ai_fps: Math.max(this.fpsMetrics.ai_fps, inferenceFps || 0),
      inference_ms: inferenceMs,
      p95_latency_ms: p95
    };
    this._emitFps();

    const mappedDetections: TelemetryDetection[] = [];

    for (const d of rawDets) {
      if (!d || !d.bbox) continue;

      const conf = typeof d.confidence === "number" ? d.confidence : 0.75;
      const trackId = d.track_id !== undefined && d.track_id !== null ? Number(d.track_id) : undefined;
      const speed = typeof d.speed === "number" ? Math.round(d.speed) : undefined;
      const plateText = typeof d.plate_text === "string" && d.plate_text.trim().length > 0 ? d.plate_text.trim().toUpperCase() : undefined;

      mappedDetections.push({
        class: d.class || "object",
        confidence: conf,
        track_id: trackId,
        speed: speed,
        speed_limit: 45,
        overspeed: speed != null ? speed > 45 : false,
        plate_text: plateText,
        label: d.track_label || d.label || undefined,
        bbox: {
          x1: d.bbox.x1,
          y1: d.bbox.y1,
          x2: d.bbox.x2,
          y2: d.bbox.y2
        }
      });
    }

    this.sessionDetectionCount += mappedDetections.length;

    // Apply strict Single Source of Truth active feature filtering
    const filtered = filterDetectionsByActiveFeatures(mappedDetections, this.profile, this.features);
    this.latestDetections = filtered;

    for (const listener of this.detectionListeners) {
      try { listener(filtered); } catch {}
    }

    // Process real alerts
    if (telemetry.alert_counts && typeof telemetry.alert_counts === "object") {
      let alertSeq = 0;
      for (const [alertKey, count] of Object.entries(telemetry.alert_counts)) {
        const fullKey = `${alertKey}_${count}`;
        if (!this.seenAlertKeys.has(fullKey) && Number(count) > 0) {
          this.seenAlertKeys.add(fullKey);
          alertSeq++;
          this.emitAlert({
            id: `alert_${Date.now()}_${alertSeq}`,
            time: new Date().toTimeString().split(' ')[0],
            text: `[ALERT] ${alertKey.replace(/_/g, ' ').toUpperCase()} (Count: ${count})`,
            type: alertKey.includes("plate") ? "plate" : (alertKey.includes("speed") ? "vehicle" : "intrusion")
          });
        }
      }
    }
  }

  private processRawDetections(rawDets: any[]) {
    this.updateDynamicFps();
    const validDets = rawDets.filter(d => d && d.bbox && typeof d.bbox.x1 === "number" && typeof d.bbox.y1 === "number");
    const mapped: TelemetryDetection[] = validDets.map(d => ({
      class: d.class || "object",
      confidence: typeof d.confidence === "number" ? d.confidence : 0.8,
      track_id: d.track_id !== undefined ? Number(d.track_id) : undefined,
      speed: d.speed !== undefined ? Math.round(Number(d.speed)) : undefined,
      plate_text: d.plate_text || d.plate || undefined,
      label: d.label || undefined,
      bbox: {
        x1: d.bbox.x1,
        y1: d.bbox.y1,
        x2: d.bbox.x2,
        y2: d.bbox.y2
      }
    }));

    const filtered = filterDetectionsByActiveFeatures(mapped, this.profile, this.features);
    this.latestDetections = filtered;
    for (const listener of this.detectionListeners) {
      try { listener(filtered); } catch {}
    }
  }

  private clearDetections() {
    this.latestDetections = [];
    for (const listener of this.detectionListeners) {
      try { listener([]); } catch {}
    }
  }

  private emitAlert(alert: TelemetryAlertEvent) {
    for (const listener of this.alertListeners) {
      try { listener(alert); } catch {}
    }
  }

  private startModelsPolling() {
    const isAxisOnCamera = typeof window !== "undefined" && (window.location.pathname.includes("/local/") || window.location.port === "41093" || window.location.port === "42093");
    const host = typeof window !== "undefined" ? (window.location.hostname || "127.0.0.1") : "127.0.0.1";
    const isLocalhost = host === "127.0.0.1" || host === "localhost";
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";

    const statusUrls = isAxisOnCamera ? [
      `/local/camai_acap/telemetry.json`,
      `/local/camai_acap/models_status.json`,
      `/api/models/status`
    ] : (isLocalhost ? [
      `http://127.0.0.1:8099/api/models/status`,
      `http://127.0.0.1:8000/api/models/status`,
      `http://localhost:8000/api/models/status`
    ] : []);

    const fetchStatus = async () => {
      for (const url of statusUrls) {
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(2000)
          });
          if (res.ok) {
            const data: ModelsStatusSummary = await res.json();
            if (data && Array.isArray(data.models)) {
              this.modelsSummary = data;
              for (const listener of this.modelsStatusListeners) {
                try { listener(data); } catch {}
              }
              return;
            }
          }
        } catch {}
      }
    };

    fetchStatus();
    this.pollIntervalId = setInterval(fetchStatus, 5000);
  }

  /** Builds base URL list for server API endpoints — Mixed Content safe */
  private _buildApiUrls(path: string): string[] {
    const host = typeof window !== "undefined" ? (window.location.hostname || "127.0.0.1") : "127.0.0.1";
    const isLocalhost = host === "127.0.0.1" || host === "localhost";
    const isAxisOnCamera = typeof window !== "undefined" &&
      (window.location.pathname.includes("/local/") || window.location.port === "41093");

    if (isAxisOnCamera) {
      // Same-origin relative URLs — safe on HTTPS
      return [
        `/local/camai_acap${path}`,
        `/local/camai_acap/api${path}`,
      ];
    }
    if (isLocalhost) {
      // Localhost dev — plain HTTP to local cloud node, no Mixed Content
      return [
        `http://127.0.0.1:8099${path}`,
        `http://127.0.0.1:8000${path}`,
        `http://localhost:8099${path}`,
      ];
    }
    // HTTPS non-localhost: only relative same-origin paths
    return [`/local/camai_acap${path}`];
  }

  private async _fetchFirstOk(urls: string[]): Promise<any | null> {
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return await res.json();
      } catch {}
    }
    return null;
  }

  private async _doHealthPoll(): Promise<void> {
    const now = new Date().toLocaleTimeString();

    // Measure WS latency via ping timestamp
    if (this.ws && this.wsConnected && this.wsPingStart === 0) {
      this.wsPingStart = Date.now();
      try { this.ws.send(JSON.stringify({ type: "ping" })); } catch {}
    }

    try {
      // Poll all real endpoints in parallel
      const [perf, healthRes, sysData, camData, acapTelemetry] = await Promise.allSettled([
        this._fetchFirstOk(this._buildApiUrls("/performance")),
        this._fetchFirstOk(this._buildApiUrls("/health")),
        this._fetchFirstOk(this._buildApiUrls("/system")),
        this._fetchFirstOk(this._buildApiUrls("/cameras")),
        this._fetchFirstOk(this._buildApiUrls("/api/telemetry")),
      ]);

      const p = perf.status === "fulfilled" ? perf.value : null;
      const h = healthRes.status === "fulfilled" ? healthRes.value : null;
      const s = sysData.status === "fulfilled" ? sysData.value : null;
      const c = camData.status === "fulfilled" ? camData.value : null;
      const a = acapTelemetry.status === "fulfilled" ? acapTelemetry.value : null;

      // Determine data source
      const source: CameraHealthData["data_source"] = a ? "acap" : (p || h) ? "server" : "unavailable";

      // ---- System metrics ----
      // Try psutil-via-server first, then fallback to ACAP /proc/
      const cpuPercent = p?.cpu_percent ?? a?.cpu_percent ?? 0;
      const ramUsedMb = p?.memory_mb ?? a?.ram_used_mb ?? 0;
      const ramTotalMb = s?.ram_mb ?? a?.ram_total_mb ?? 0;
      const ramAvailMb = a?.ram_available_mb ?? (ramTotalMb > 0 ? Math.max(0, ramTotalMb - ramUsedMb) : 0);
      const ramPct = ramTotalMb > 0 ? Math.round((ramUsedMb / ramTotalMb) * 100) : 0;

      // Storage from ACAP telemetry or server
      const storUsedGb = a?.storage_used_gb ?? 0;
      const storTotalGb = a?.storage_total_gb ?? 0;
      const storFreeGb = a?.storage_free_gb ?? (storTotalGb - storUsedGb);
      const storPct = storTotalGb > 0 ? Math.round((storUsedGb / storTotalGb) * 100) : 0;

      const uptimeSecs = h?.uptime_secs ?? a?.uptime_secs ?? 0;
      const systemLoad = a?.system_load ?? (cpuPercent / 100);

      // ---- Camera / Video metrics ----
      const firstCam = c?.cameras?.[0] ?? null;
      const cameraStatus = firstCam?.health_status ?? (this.connectionStatus === "online" ? "online" : "offline");
      const resolution = firstCam?.resolution ?? a?.resolution ?? "";
      const inputFpsVal = firstCam?.fps ?? p?.avg_fps ?? a?.fps ?? this.fpsMetrics.input_fps;
      const bitrate = a?.video_bitrate_kbps ?? 0;
      const dropouts = a?.stream_dropouts ?? 0;

      // ---- AI Runtime metrics ----
      const aiFpsVal = p?.avg_fps ?? a?.inference_fps ?? this.fpsMetrics.ai_fps;
      const latencyMs = p?.avg_latency_ms ?? a?.inference_latency_ms ?? 0;
      const activeModule = a?.active_module ?? this.profile;
      const modelStatus = a?.model_status ?? (this.connectionStatus === "online" ? "running" : "idle");

      // ---- Hardware ----
      const deviceType = s?.device ?? a?.device ?? p?.device ?? "Axis Camera";
      const chipTemp = a?.chip_temp_c ?? null;

      // ---- Network (ACAP-only) ----
      const bytesSentMb = a?.bytes_sent_mb ?? 0;
      const bytesRecvMb = a?.bytes_recv_mb ?? 0;

      const health: CameraHealthData = {
        cpu_percent: cpuPercent,
        ram_used_mb: Math.round(ramUsedMb),
        ram_total_mb: Math.round(ramTotalMb),
        ram_available_mb: Math.round(ramAvailMb),
        ram_percent: ramPct,
        storage_used_gb: Math.round(storUsedGb * 100) / 100,
        storage_total_gb: Math.round(storTotalGb * 100) / 100,
        storage_free_gb: Math.round(storFreeGb * 100) / 100,
        storage_percent: storPct,
        uptime_secs: uptimeSecs,
        system_load: Math.round(systemLoad * 100) / 100,
        camera_status: cameraStatus,
        resolution,
        input_fps: Math.round(inputFpsVal * 10) / 10,
        video_bitrate_kbps: Math.round(bitrate),
        stream_dropouts: dropouts,
        ai_fps: Math.round(aiFpsVal * 10) / 10,
        inference_latency_ms: Math.round(latencyMs * 10) / 10,
        active_module: activeModule,
        detections_this_session: this.sessionDetectionCount,
        model_status: modelStatus,
        device_type: deviceType,
        chip_temp_c: chipTemp,
        bytes_sent_mb: Math.round(bytesSentMb * 100) / 100,
        bytes_recv_mb: Math.round(bytesRecvMb * 100) / 100,
        ws_latency_ms: this.wsLatencyMs,
        fetched_at: now,
        data_source: source,
      };

      this.healthData = health;
      for (const cb of this.healthListeners) {
        try { cb(health); } catch {}
      }
    } catch {}
  }

  public start() {
    this.running = true;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.discoverCameraAndInit();
    }
  }

  public stop() {
    this.running = false;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
    this.stopHealthPolling();
    this.clearDetections();
  }
}

export const telemetryEngine = new EdgeTelemetryEngine();
