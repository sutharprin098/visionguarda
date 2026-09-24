// Video clip export from the live view.
//
// WHAT THIS DOES AND, IMPORTANTLY, WHAT IT DOES NOT
//
// It records the camera the incident came from, from the moment the operator
// asks, for a fixed number of seconds, by pumping the element they are already
// watching into a canvas and running MediaRecorder over its captureStream. That
// is a real clip of real footage, produced with no extra network connection and
// no second decode of the stream.
//
// It is a POST-EVENT clip. It does not contain the seconds before the click,
// and this file is not going to pretend otherwise. Pre-roll would mean encoding
// every camera continuously on the off-chance an alert fires, which is exactly
// the "snapshot generation must not reduce live FPS" line being crossed — a
// permanent, per-camera encoder running so that an occasional export can look
// two seconds further back.
//
// The system already has the right answer for pre-event footage: the ENGINE
// records (pipeline.py -> RECORDINGS_DIR) and exposes GET /api/recordings. That
// is the source to pull from for "what happened before the alert", and it costs
// the renderer nothing because the encoding already happened server-side.
//
// CONTAINER. Chromium gained MediaRecorder MP4 support relatively recently; on
// a build without it the only option is WebM. Rather than mislabel a WebM file
// as .mp4 — which some evidence workflows will reject and every video tool will
// notice — we ask the browser what it can actually mux and name the file after
// what came out.

export interface ClipResult {
  blob: Blob;
  mimeType: string;
  extension: "mp4" | "webm";
  durationMs: number;
  width: number;
  height: number;
}

export type ClipMedia = HTMLImageElement | HTMLVideoElement;

/** Preference order: MP4 first because it is what an evidence recipient expects. */
const CANDIDATES = [
  'video/mp4;codecs="avc1.42E01E"',
  "video/mp4",
  'video/webm;codecs="vp9"',
  'video/webm;codecs="vp8"',
  "video/webm",
];

export function pickMimeType(): string | null {
  const MR = (window as any).MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== "function") return null;
  for (const c of CANDIDATES) {
    try {
      if (MR.isTypeSupported(c)) return c;
    } catch { /* keep looking */ }
  }
  return null;
}

export function clipSupported(): boolean {
  return pickMimeType() != null && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

function sizeOf(el: ClipMedia): { w: number; h: number } | null {
  const w = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || 0;
  const h = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Encoded height ceiling. 720p is plenty for evidence and keeps the encode off
 *  the critical path on the modest hardware this product targets. */
const MAX_H = 720;
const FPS = 15;

/**
 * Record `seconds` of the given element.
 *
 * `onProgress` receives 0..1 so the UI can show a real countdown rather than a
 * spinner — the operator is waiting in real time and needs to know how long.
 * The returned promise resolves when the muxer has flushed; it rejects only if
 * recording could not start at all.
 */
export async function recordClip(
  media: ClipMedia,
  seconds: number,
  onProgress?: (fraction: number) => void,
): Promise<ClipResult | null> {
  const mimeType = pickMimeType();
  const src = sizeOf(media);
  if (!mimeType || !src) return null;

  const scale = Math.min(1, MAX_H / src.h);
  const w = Math.max(2, Math.round((src.w * scale) / 2) * 2); // even dims: H.264 requires it
  const h = Math.max(2, Math.round((src.h * scale) / 2) * 2);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let stream: MediaStream;
  try {
    stream = canvas.captureStream(FPS);
  } catch {
    return null;
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }

  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };

  const startedAt = performance.now();
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // Draw on a rAF loop rather than setInterval: it is already synchronised to
  // the compositor, so frames are pulled at paint time instead of contending
  // with it. A dropped draw is a dropped frame in the clip and nothing worse —
  // the live view must never stall for the recorder.
  const draw = () => {
    if (stopped) return;
    try {
      ctx.drawImage(media, 0, 0, w, h);
    } catch {
      // Element went away mid-record (stream dropped, tile unmounted). Keep
      // what we have rather than throwing away the whole clip.
      finish();
      return;
    }
    onProgress?.(Math.min(1, (performance.now() - startedAt) / (seconds * 1000)));
    raf = requestAnimationFrame(draw);
  };

  const cleanup = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
  };

  function finish(): void {
    if (recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* already stopping */ }
    }
  }

  return new Promise<ClipResult | null>((resolve) => {
    recorder.onstop = () => {
      cleanup();
      const durationMs = performance.now() - startedAt;
      if (!parts.length) return resolve(null);
      const blob = new Blob(parts, { type: mimeType });
      resolve({
        blob,
        mimeType,
        extension: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
        durationMs,
        width: w,
        height: h,
      });
    };
    recorder.onerror = () => { cleanup(); resolve(null); };

    try {
      recorder.start(250); // periodic chunks so a crash still leaves usable data
    } catch {
      cleanup();
      resolve(null);
      return;
    }
    raf = requestAnimationFrame(draw);
    timer = setTimeout(finish, seconds * 1000);
  });
}
