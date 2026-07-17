// Persistent screen/webcam sharing session pushed to the local AI engine's
// /ws endpoint (see server/app/main.py "screen_frame" handling). Replaces
// the previous fire-and-forget WebSocket + MediaStream wiring in
// Workspace.tsx, which tore the whole share down (including stopping the
// user's MediaStream tracks) on any transient disconnect — a network blip,
// display sleep, or the engine restarting meant the operator had to notice
// and manually click "Share" again.
//
// This module keeps the MediaStream and the WebSocket as independently
// recoverable: a dropped socket reconnects with backoff without touching
// the stream; a stream the OS tears down (sleep, permission change, device
// unplug) gets silently re-acquired — Electron's main process auto-grants
// both getDisplayMedia and getUserMedia in this app (see electron/main.ts),
// so re-acquisition never needs a user gesture.

export type ShareStatus = "idle" | "acquiring" | "connecting" | "live" | "reconnecting" | "error" | "source_gone";

export interface ShareCallbacks {
  onStatus?: (status: ShareStatus, detail?: string) => void;
  onStream?: (stream: MediaStream | null) => void;
}

// "127.0.0.1", not "localhost" — deliberately matches ENGINE_BASE in
// localEngine.ts. Measured directly on a real machine: "localhost" resolves
// to ::1 (IPv6) *first* here (Windows getaddrinfo ordering), and the engine
// only binds the IPv4 loopback (see server/app/config.py HOST) — connecting
// via "localhost" cost 2.3s of failed-then-fallback connection setup per
// attempt vs 0.02s for "127.0.0.1" in direct measurement, and some clients
// don't even complete the IPv4 fallback at all, so every reconnect attempt
// fails the same way forever. This was very likely the actual root cause of
// screen/webcam shares getting stuck "reconnecting" indefinitely.
const WS_URL = "ws://127.0.0.1:8000/ws";
const FRAME_INTERVAL_MS = 100;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 12000;
const SEND_STALL_TIMEOUT_MS = 8000;
const STREAM_REACQUIRE_DELAY_MS = 1500;
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

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
  private reconnectAttempt = 0;
  private stopped = true;
  private status: ShareStatus = "idle";
  /** desktopCapturer id of the exact surface to capture ("screen" kind only). */
  private sourceId: string | null = null;
  private unsubPower: (() => void) | null = null;

  private readonly onOnline = () => { if (!this.stopped) this.ensureConnected(); };
  private readonly onOffline = () => { if (!this.stopped) this.setStatus("reconnecting", "network offline"); };

  constructor(cameraId: string, kind: "screen" | "webcam", cb: ShareCallbacks = {}, sourceId?: string) {
    this.cameraId = cameraId;
    this.kind = kind;
    this.cb = cb;
    this.sourceId = sourceId ?? null;
  }

  getStream(): MediaStream | null { return this.stream; }
  getStatus(): ShareStatus { return this.status; }

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.reconnectAttempt = 0;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    this.unsubPower = window.camai.onPowerEvent((evt) => {
      if (this.stopped) return;
      if (evt === "resume" || evt === "unlock-screen") {
        // The capture source may have been silently torn down while
        // suspended (screen share ends, webcam device resets) — verify and
        // recover both halves instead of waiting for their own timeouts.
        this.ensureStream();
        this.ensureConnected();
      }
    });
    await this.acquireStream();
    this.connectWs();
  }

  stop(): void {
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
    this.status = s;
    this.cb.onStatus?.(s, detail);
  }

  // ---- MediaStream acquisition ----

  private async acquireStream(): Promise<void> {
    if (this.stopped) return;
    this.setStatus("acquiring");
    try {
      const constraints: MediaStreamConstraints = { video: { width: 960, height: 540, frameRate: 10 } };
      let stream: MediaStream;
      if (this.kind === "screen") {
        if (!this.sourceId) {
          // Refuse rather than let the main process fall back to a surface the
          // operator never chose. A share with no pick is a bug, not a default.
          throw new Error("no capture source selected");
        }
        // Tell main which source this very next getDisplayMedia call means.
        // The two are ordered, not raced: setSource resolves over IPC before
        // getDisplayMedia is issued, and the main handler reads it synchronously.
        await window.camai.capture.setSource(this.sourceId);
        stream = await navigator.mediaDevices.getDisplayMedia(constraints);
      } else {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      if (this.stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.stream = stream;
      this.cb.onStream?.(stream);

      const track = stream.getVideoTracks()[0];
      // Fires when the shared window closes, or the operator hits Chromium's
      // own "Stop sharing". The former is unrecoverable for this source.
      track.onended = () => {
        if (this.stopped) return;
        this.stream = null;
        this.cb.onStream?.(null);
        void this.sourceIsGone().then((gone) => {
          if (this.stopped) return;
          if (gone) this.setStatus("source_gone", "Selected source is no longer available.");
          else this.scheduleStreamReacquire();
        });
      };

      if (!this.video) {
        this.video = document.createElement("video");
        this.video.muted = true;
      }
      this.video.srcObject = stream;
      this.video.play().catch(() => {});

      if (!this.canvas) {
        this.canvas = document.createElement("canvas");
        this.canvas.width = 960;
        this.canvas.height = 540;
        this.ctx = this.canvas.getContext("2d");
      }

      if (this.status === "acquiring") {
        this.setStatus(this.ws?.readyState === WebSocket.OPEN ? "live" : "connecting");
      }
    } catch (err) {
      // A window that has been closed can never be re-acquired, so retrying it
      // on a timer forever just burns CPU and leaves the operator staring at
      // "reconnecting". Distinguish "gone for good" from a transient failure
      // and make the dead case terminal + nameable.
      if (await this.sourceIsGone()) {
        this.setStatus("source_gone", "Selected source is no longer available.");
        return;
      }
      this.setStatus("error", err instanceof Error ? err.message : "failed to acquire media");
      this.scheduleStreamReacquire();
    }
  }

  /** True only when we're capturing a specific surface and it has vanished. */
  private async sourceIsGone(): Promise<boolean> {
    if (this.kind !== "screen" || !this.sourceId) return false;
    try {
      const { exists } = await window.camai.capture.sourceExists(this.sourceId);
      return !exists;
    } catch {
      return false; // can't prove it's gone — treat as transient
    }
  }

  /** Re-check the current stream is still live; re-acquire only if it isn't. Safe to call often — never spams getDisplayMedia/getUserMedia while a good stream exists. */
  private ensureStream(): void {
    if (this.stopped) return;
    const track = this.stream?.getVideoTracks()[0];
    if (!this.stream || !track || track.readyState !== "live") {
      void this.acquireStream();
    }
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.stream = null;
    this.cb.onStream?.(null);
    if (this.video) this.video.srcObject = null;
  }

  private scheduleStreamReacquire(): void {
    if (this.stopped || this.streamReacquireTimer) return;
    this.streamReacquireTimer = setTimeout(() => {
      this.streamReacquireTimer = null;
      if (!this.stopped) void this.acquireStream();
    }, STREAM_REACQUIRE_DELAY_MS);
  }

  // ---- WebSocket push, with heartbeat + reconnect independent of the stream ----

  private connectWs(): void {
    if (this.stopped || this.ws) return;
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

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
      this.setStatus("live");
      this.startFrameLoop();
      this.startHeartbeat();
    };

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg?.type === "pong") this.lastPongTs = Date.now();
      } catch { /* not a JSON control message */ }
    };

    ws.onclose = () => {
      this.ws = null;
      this.stopFrameLoop();
      this.stopHeartbeat();
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private closeWs(): void {
    this.stopFrameLoop();
    this.stopHeartbeat();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      try { ws.close(); } catch { /* already closing */ }
    }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private ensureConnected(): void {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.connectWs();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWs();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastPongTs > HEARTBEAT_TIMEOUT_MS) {
        // The socket object still reports OPEN but the server hasn't
        // answered a ping in far longer than one round trip should ever
        // take — a half-open connection (sleep, dead peer) that will never
        // fire its own onclose. Force it closed and reconnect.
        this.forceReconnect();
        return;
      }
      try {
        this.ws.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      } catch { /* onclose will follow and trigger reconnect */ }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private forceReconnect(): void {
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      try { ws.close(); } catch { /* ignore */ }
    }
    this.stopFrameLoop();
    this.stopHeartbeat();
    this.scheduleReconnect();
  }

  // ---- Frame push ----

  private startFrameLoop(): void {
    this.stopFrameLoop();
    this.lastSendOkTs = Date.now();
    this.frameTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const video = this.video;
      if (video && video.readyState >= video.HAVE_CURRENT_DATA && this.ctx && this.canvas) {
        try {
          this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
          const frame = this.canvas.toDataURL("image/jpeg", 0.6);
          this.ws.send(JSON.stringify({ type: "screen_frame", camera_id: this.cameraId, frame }));
          this.lastSendOkTs = Date.now();
        } catch {
          // transient encode/send failure — the stall watchdog below covers
          // the case where this keeps failing instead of self-healing.
        }
      }
      if (Date.now() - this.lastSendOkTs > SEND_STALL_TIMEOUT_MS) {
        this.forceReconnect();
      }
    }, FRAME_INTERVAL_MS);
  }

  private stopFrameLoop(): void {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
  }

  private clearTimers(): void {
    this.stopFrameLoop();
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.streamReacquireTimer) { clearTimeout(this.streamReacquireTimer); this.streamReacquireTimer = null; }
  }
}
