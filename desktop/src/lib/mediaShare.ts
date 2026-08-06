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
// How long the socket may stay open with NO frame actually sent before the
// capture stream is presumed dead and re-acquired. Declared with the original
// watchdog design but never wired to anything until checkFrameFlow() below —
// see the note in startFrameLoop for what that cost.
const SEND_STALL_TIMEOUT_MS = 25000;
// Ceiling on un-drained WebSocket bytes before frames start being skipped.
//
// This was 512KB, justified as "8-12 frames of slack: enough to ride out a
// brief engine hiccup". That reasoning is right for a file upload and wrong
// for live video, and it is the single largest source of delay in the virtual
// camera path: a queued frame is not resilience, it is a frame that will be
// DISPLAYED LATE. At the 10fps push rate, 8-12 queued frames is roughly a full
// SECOND of latency that the design settles into under any sustained load —
// the operator sees a second-old screen with boxes drawn on it and reports,
// correctly, that it is nowhere near real time.
//
// For live video the rule is the opposite one: never hold a frame you could
// replace with a newer one. This is a loopback socket (127.0.0.1), so
// bufferedAmount returns to zero almost immediately whenever the engine is
// keeping up; a non-trivial reading means it is NOT keeping up, and the right
// response is to drop this frame and offer a fresher one 100ms later.
//
// Sized to roughly one frame, so at most one is ever in flight. Worst-case
// added latency goes from ~1s to ~100-150ms, and a genuine engine stall now
// drops frames (which is invisible) instead of accumulating stale ones (which
// is the complaint).
const MAX_WS_BUFFERED_BYTES = 64 * 1024;
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
  /** Frames skipped because the socket was backed up — surfaced for the debug panel. */
  private droppedFrames = 0;
  /** Frames that actually reached the socket. */
  private sentFrames = 0;
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

  /** Push-side counters for the performance HUD. `buffered` is the socket's
   *  un-drained byte count — a number that climbs and stays high is the engine
   *  failing to keep up, which is invisible from the engine's own telemetry
   *  because those frames never arrived. */
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

      // Socket liveness and video liveness are separate failures and need
      // separate detectors. The ping above covers the socket; this covers the
      // case where the socket answers perfectly and no pixels are moving.
      this.checkFrameFlow();
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

      // ── Backpressure: never queue a frame the socket cannot drain ─────────
      // ws.send() buffers without bound. When the engine is busy (a slow
      // inference cycle, another camera saturating the loop) the encoded
      // frames pile up in bufferedAmount instead of going anywhere — the
      // renderer's memory grows, and every frame that does arrive is already
      // stale by the length of the backlog. Skipping while backed up is the
      // "drop old frames instead of queueing" rule applied at the only place
      // in this path that can actually queue.
      if (this.ws.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
        this.droppedFrames++;
        return;
      }

      if (video && video.readyState >= video.HAVE_CURRENT_DATA && this.ctx && this.canvas) {
        try {
          this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
          const frame = this.canvas.toDataURL("image/jpeg", 0.6);
          this.ws.send(JSON.stringify({ type: "screen_frame", camera_id: this.cameraId, frame }));
          // Only a frame that actually reached the socket counts as progress.
          this.lastSendOkTs = Date.now();
          this.sentFrames++;
        } catch {
          // transient encode/send failure — ignore
        }
      }
      // NOTE: the `else` branch here used to refresh lastSendOkTs whenever the
      // video element was not ready, on the reasoning that a loading stream
      // should not trip the watchdog. That is exactly backwards, and it is the
      // bug behind "No frames are being pushed":
      //
      // A capture track that has ended (screen share revoked, monitor
      // unplugged, laptop lid closed, OS reclaimed the surface) leaves the
      // <video> permanently below HAVE_CURRENT_DATA. That branch then refreshed
      // the freshness timestamp forever, so nothing downstream could ever tell
      // "starting up" from "dead". The socket stays open, ping/pong keeps
      // answering, the heartbeat below is satisfied — and zero frames flow, for
      // as long as the app is left running. The engine correctly reports "No
      // frames are being pushed to this virtual camera" and nothing on this
      // side ever tries to fix it.
      //
      // Now the timestamp only moves on a real send, and checkFrameFlow()
      // below turns a stalled stream into a re-acquire.
    }, FRAME_INTERVAL_MS);
  }

  /**
   * Frame-flow watchdog: detects "socket healthy, but no video".
   *
   * The heartbeat proves the SOCKET is alive; it says nothing about whether the
   * capture is producing pixels. Those two fail independently, and the failure
   * that stranded virtual cameras was the second one — which had no detector at
   * all (lastSendOkTs was written in three places and read in none, so the
   * watchdog it existed for was never actually built).
   *
   * Re-acquiring the stream is the right recovery because the socket is fine:
   * tearing down and reconnecting the WebSocket would not bring the video back.
   */
  private checkFrameFlow(): void {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastSendOkTs <= SEND_STALL_TIMEOUT_MS) return;

    // Check if media stream track is still active
    const hasLiveTrack = this.stream?.getVideoTracks().some((t: MediaStreamTrack) => t.readyState === "live");
    if (hasLiveTrack) {
      // Stream is alive (e.g. paused rendering during tab transition), refresh timestamp
      this.lastSendOkTs = Date.now();
      return;
    }

    this.setStatus("reconnecting", "no frames from capture source");
    // Reset first: acquireStream() is async and this check runs on an
    // interval, so without it the same stall re-fires a re-acquire every tick
    // while the first one is still in flight.
    this.lastSendOkTs = Date.now();
    this.ensureStream();
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
