// Persistent screen/webcam sharing session pushed to the local AI engine's
// /ws endpoint (see server/app/main.py "screen_frame" handling).
//
// Keeps the MediaStream and the WebSocket independently recoverable:
// - A dropped socket reconnects with bounded exponential backoff without touching the stream.
// - A stream torn down by OS (sleep, display change, device unplug) gets re-acquired via Electron IPC.
// - Diagnostics are logged for all lifecycle transitions.

export type ShareStatus = "idle" | "acquiring" | "connecting" | "live" | "reconnecting" | "error" | "source_gone";

export interface ShareCallbacks {
  onStatus?: (status: ShareStatus, detail?: string) => void;
  onStream?: (stream: MediaStream | null) => void;
}

const WS_URL = "ws://127.0.0.1:8000/ws";
const FRAME_INTERVAL_MS = 33;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 12000;
const SEND_STALL_TIMEOUT_MS = 12000;
const MAX_WS_BUFFERED_BYTES = 128 * 1024;
const STREAM_REACQUIRE_DELAY_MS = 1500;

// Bounded reconnect strategy
const MAX_RECONNECT_ATTEMPTS = 6;
const RECONNECT_BACKOFF_MS = [1000, 2000, 3000, 5000, 8000, 10000];

export class MediaShareSession {
  private cameraId: string;
  private kind: "screen" | "webcam";
  private cb: ShareCallbacks;

  private stream: MediaStream | null = null;
  private ws: WebSocket | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private streamReacquireTimer: ReturnType<typeof setTimeout> | null = null;

  private lastPongTs = 0;
  private lastSendOkTs = 0;
  private droppedFrames = 0;
  private sentFrames = 0;
  private reconnectAttempt = 0;
  private stopped = true;
  private status: ShareStatus = "idle";
  private sourceId: string | null = null;
  private unsubPower: (() => void) | null = null;

  private readonly onOnline = () => {
    this.logDiag("info", "Network online event received");
    if (!this.stopped) this.ensureConnected();
  };

  private readonly onOffline = () => {
    this.logDiag("warn", "Network offline event received");
    if (!this.stopped) this.setStatus("reconnecting", "Network offline");
  };

  constructor(cameraId: string, kind: "screen" | "webcam", cb: ShareCallbacks = {}, sourceId?: string) {
    this.cameraId = cameraId;
    this.kind = kind;
    this.cb = cb;
    this.sourceId = sourceId ?? null;
    this.logDiag("info", `Created session instance (kind=${kind}, sourceId=${sourceId ?? "none"})`);
  }

  private logDiag(level: "info" | "warn" | "error", message: string, details?: unknown): void {
    const prefix = `[MediaShare Session:${this.cameraId}]`;
    if (level === "error") {
      console.error(prefix, message, details ?? "");
    } else if (level === "warn") {
      console.warn(prefix, message, details ?? "");
    } else {
      console.log(prefix, message, details ?? "");
    }
  }

  getStream(): MediaStream | null { return this.stream; }
  getStatus(): ShareStatus { return this.status; }

  getPushStats(): { sent: number; dropped: number; buffered: number; stalledMs: number } {
    return {
      sent: this.sentFrames,
      dropped: this.droppedFrames,
      buffered: this.ws?.bufferedAmount ?? 0,
      stalledMs: this.lastSendOkTs ? Date.now() - this.lastSendOkTs : 0,
    };
  }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.logDiag("info", "Starting media share session");
    this.stopped = false;
    this.reconnectAttempt = 0;

    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);

    this.unsubPower = window.camai?.onPowerEvent?.((evt) => {
      if (this.stopped) return;
      this.logDiag("info", `Power event received: ${evt}`);
      if (evt === "resume" || evt === "unlock-screen") {
        this.ensureStream();
        this.ensureConnected();
      }
    });

    await this.acquireStream();
    this.connectWs();
  }

  stop(): void {
    if (this.stopped) return;
    this.logDiag("info", "Stopping media share session");
    this.stopped = true;

    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.unsubPower?.();
    this.unsubPower = null;

    this.clearTimers();
    this.closeWs();
    this.releaseStream();
    this.setStatus("idle");
  }

  private setStatus(s: ShareStatus, detail?: string): void {
    if (this.status !== s) {
      this.logDiag("info", `Status transition: ${this.status} -> ${s}` + (detail ? ` (${detail})` : ""));
    }
    this.status = s;
    this.cb.onStatus?.(s, detail);
  }

  // ---- MediaStream Acquisition ----

  private async acquireStream(): Promise<void> {
    if (this.stopped) return;
    this.setStatus("acquiring");
    this.logDiag("info", `Acquiring stream (kind=${this.kind}, sourceId=${this.sourceId})`);

    try {
      const constraints: MediaStreamConstraints = { video: { width: 960, height: 540, frameRate: 30 } };
      let stream: MediaStream;

      if (this.kind === "screen") {
        if (!this.sourceId) {
          throw new Error("No capture source selected for screen share");
        }
        if (window.camai?.capture?.setSource) {
          this.logDiag("info", `Setting IPC capture source: ${this.sourceId}`);
          await window.camai.capture.setSource(this.sourceId);
        }
        stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      } else {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      if (this.stopped) {
        this.logDiag("info", "Session stopped during stream acquisition, releasing tracks");
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.stream = stream;
      this.cb.onStream?.(stream);

      const track = stream.getVideoTracks()[0];
      if (track) {
        this.logDiag("info", `MediaStream track acquired (label=${track.label}, readyState=${track.readyState})`);

        track.onended = () => {
          this.logDiag("warn", `MediaStream track ended (label=${track.label})`);
          if (this.stopped) return;
          this.stream = null;
          this.cb.onStream?.(null);
          void this.sourceIsGone().then((gone) => {
            if (this.stopped) return;
            if (gone) {
              this.setStatus("source_gone", "Selected source is no longer available.");
            } else {
              this.scheduleStreamReacquire();
            }
          });
        };

        track.onmute = () => this.logDiag("warn", `MediaStream track muted by OS (label=${track.label})`);
        track.onunmute = () => this.logDiag("info", `MediaStream track unmuted by OS (label=${track.label})`);
      }

      if (!this.video) {
        this.video = document.createElement("video");
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.autoplay = true;
      }
      this.video.srcObject = stream;
      this.video.play().catch((err) => this.logDiag("warn", "Video play catch:", err));

      if (!this.canvas) {
        this.canvas = document.createElement("canvas");
        this.canvas.width = 1280;
        this.canvas.height = 720;
        this.ctx = this.canvas.getContext("2d");
      }

      if (this.status === "acquiring") {
        this.setStatus(this.ws?.readyState === WebSocket.OPEN ? "live" : "connecting");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logDiag("error", `Failed to acquire stream: ${errMsg}`);

      if (await this.sourceIsGone()) {
        this.setStatus("source_gone", "Selected source is no longer available.");
        return;
      }
      this.setStatus("error", errMsg);
      this.scheduleStreamReacquire();
    }
  }

  private async sourceIsGone(): Promise<boolean> {
    if (this.kind !== "screen" || !this.sourceId) return false;
    try {
      if (window.camai?.capture?.sourceExists) {
        const { exists } = await window.camai.capture.sourceExists(this.sourceId);
        return !exists;
      }
      return false;
    } catch {
      return false;
    }
  }

  private ensureStream(): void {
    if (this.stopped) return;
    const track = this.stream?.getVideoTracks()[0];
    if (!this.stream || !track || track.readyState !== "live") {
      this.logDiag("info", "ensureStream: track not live, re-acquiring");
      void this.acquireStream();
    }
  }

  private releaseStream(): void {
    if (this.stream) {
      this.logDiag("info", "Releasing stream tracks");
      this.stream.getTracks().forEach((t) => {
        t.onended = null;
        t.onmute = null;
        t.onunmute = null;
        t.stop();
      });
      this.stream = null;
    }
    this.cb.onStream?.(null);
    if (this.video) this.video.srcObject = null;
  }

  private scheduleStreamReacquire(): void {
    if (this.stopped || this.streamReacquireTimer) return;
    this.logDiag("info", `Scheduling stream re-acquisition in ${STREAM_REACQUIRE_DELAY_MS}ms`);
    this.streamReacquireTimer = setTimeout(() => {
      this.streamReacquireTimer = null;
      if (!this.stopped) void this.acquireStream();
    }, STREAM_REACQUIRE_DELAY_MS);
  }

  // ---- WebSocket Push & Bounded Reconnect ----

  private connectWs(): void {
    if (this.stopped) return;
    if (this.ws) {
      this.logDiag("info", "connectWs called while socket exists, cleaning old socket first");
      this.closeWs();
    }

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.logDiag("error", `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Stopping reconnect loop.`);
      this.setStatus("error", "Local AI engine connection failed after maximum retries.");
      return;
    }

    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    this.logDiag("info", `Connecting WebSocket to ${WS_URL} (attempt ${this.reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS})`);

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      this.logDiag("error", "WebSocket constructor threw error:", err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.logDiag("info", `WebSocket connected (OPEN) on ${WS_URL}`);
      this.reconnectAttempt = 0;
      this.lastPongTs = Date.now();
      this.setStatus("live");
      this.startFrameLoop();
      this.startHeartbeat();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === "pong") {
          this.lastPongTs = Date.now();
        }
      } catch {
        /* not a JSON control message */
      }
    };

    ws.onerror = (evt) => {
      this.logDiag("warn", "WebSocket error event triggered:", evt);
    };

    ws.onclose = (evt) => {
      this.logDiag("warn", `WebSocket closed (code=${evt.code}, reason='${evt.reason}', wasClean=${evt.wasClean})`);
      this.ws = null;
      this.stopFrameLoop();
      this.stopHeartbeat();

      if (this.stopped) return;

      if (evt.code === 1008) {
        this.logDiag("error", "WebSocket closed with code 1008 (Disallowed Origin). Halting reconnect.");
        this.setStatus("error", "Engine rejected connection origin.");
        return;
      }

      this.scheduleReconnect();
    };
  }

  private closeWs(): void {
    this.stopFrameLoop();
    this.stopHeartbeat();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private ensureConnected(): void {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.connectWs();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      this.logDiag("error", `Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Terminating retry loop.`);
      this.setStatus("error", "Local AI engine connection failed after maximum retries.");
      return;
    }

    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.logDiag("info", `Scheduling reconnect attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connectWs();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (Date.now() - this.lastPongTs > HEARTBEAT_TIMEOUT_MS) {
        this.logDiag("warn", `Heartbeat timeout (> ${HEARTBEAT_TIMEOUT_MS}ms since last pong). Forcing reconnect.`);
        this.forceReconnect();
        return;
      }

      try {
        this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      } catch {
        /* onclose handles cleanup */
      }

      this.checkFrameFlow();
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private forceReconnect(): void {
    this.logDiag("info", "Force reconnecting WebSocket");
    this.closeWs();
    this.scheduleReconnect();
  }

  // ---- Frame Push ----

  private startFrameLoop(): void {
    this.stopFrameLoop();
    this.lastSendOkTs = Date.now();

    this.frameTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      const video = this.video;
      const track = this.stream?.getVideoTracks()[0];
      const isTrackLive = track && track.readyState === "live";

      if (isTrackLive) {
        this.lastSendOkTs = Date.now();
      }

      if (video && (video.readyState >= video.HAVE_CURRENT_DATA || (video.videoWidth > 0 && video.videoHeight > 0))) {
        if (this.ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
          this.droppedFrames++;
          return;
        }

        if (this.ctx && this.canvas) {
          try {
            if (video.videoWidth > 0 && (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight)) {
              this.canvas.width = video.videoWidth;
              this.canvas.height = video.videoHeight;
            }
            this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
            const frame = this.canvas.toDataURL("image/jpeg", 0.85);
            this.ws.send(JSON.stringify({ type: "screen_frame", camera_id: this.cameraId, frame }));
            this.sentFrames++;
          } catch (err) {
            this.logDiag("warn", "Frame encode/send exception:", err);
          }
        }
      }
    }, FRAME_INTERVAL_MS);
  }

  private checkFrameFlow(): void {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const track = this.stream?.getVideoTracks()[0];
    if (track && track.readyState === "live") {
      return;
    }

    if (Date.now() - this.lastSendOkTs <= SEND_STALL_TIMEOUT_MS) return;

    this.logDiag("warn", `Frame flow stalled (> ${SEND_STALL_TIMEOUT_MS}ms). Re-acquiring stream.`);
    this.setStatus("reconnecting", "No frames from capture source");
    this.lastSendOkTs = Date.now();
    this.releaseStream();
    this.scheduleStreamReacquire();
  }

  private stopFrameLoop(): void {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  clearTimers(): void {
    this.stopFrameLoop();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.streamReacquireTimer) {
      clearTimeout(this.streamReacquireTimer);
      this.streamReacquireTimer = null;
    }
  }
}
