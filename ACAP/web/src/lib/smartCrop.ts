// Smart snapshot capture: turn "there is a detection at these normalised
// coordinates" into two real JPEGs — a zoomed crop of the object itself, and
// the full frame it came from.
//
// WHERE THE PIXELS COME FROM
//
// Straight off the element the operator is already watching: the MJPEG <img>
// in the tile, or the local <video> while a screen/webcam share is running.
// Nothing is fetched, nothing is re-decoded, no second stream is opened. That
// last point is not an optimisation, it is a hard constraint — every MJPEG
// <img> pins one connection that never closes and Chromium allows six per
// host, so a capture that opened its own stream would starve the live view it
// was capturing from (see the connection-budget note in Workspace.tsx).
//
// The frame we read is the newest one the browser has decoded at the instant
// the detection telemetry arrived. Video and AI are decoupled by design in this
// product (MJPEG for pixels, WebSocket for telemetry — no frames in the socket),
// so "the exact detection frame" is, at best, the current frame at telemetry
// time: a skew of at most one AI cycle. It is genuinely live pixels of that
// object at that moment. It is not the identical buffer the model ran on, and
// no amount of client code can make it so without pushing frames through the
// socket, which this architecture deliberately does not do.
//
// TAINTED CANVAS
//
// The engine is a different origin (http://127.0.0.1:8000) from the renderer,
// so drawing its <img> into a canvas taints that canvas and toBlob() throws
// unless the image was fetched with CORS. The tile therefore requests the
// stream with crossOrigin="anonymous"; config.py already allowlists the
// renderer's origin, so the engine answers with the matching
// Access-Control-Allow-Origin and nothing is tainted. If that ever fails, the
// capture returns null and the caller degrades to a card without a snapshot —
// it must never take the live view down with it.

export interface CropPadding {
  x: number;
  top: number;
  bottom: number;
  /** Target width/height for the finished crop. Per-class — see CropPad in
   *  alertCatalog for why a single global aspect is what creates background. */
  aspect: number;
}

export interface NormalisedBox {
  x1: number; y1: number; x2: number; y2: number;
}

export interface CaptureResult {
  /** Zoomed JPEG of the detected object, aspect-correct, never stretched. */
  crop: Blob;
  cropWidth: number;
  cropHeight: number;
  /** The whole frame the crop came from, for the "open full frame" path. */
  full: Blob;
  fullWidth: number;
  fullHeight: number;
  /** Source-frame pixel rect the crop was taken from, so the modal can show
   *  exactly where in the scene it came from. */
  region: { x: number; y: number; w: number; h: number };
  /** Upscale factor applied to the crop (1 = native pixels). */
  zoom: number;
  /** Actual width/height of the returned crop. The card sizes its image box to
   *  this, so a portrait person crop is shown in a portrait box and nothing is
   *  letterboxed or padded with background. */
  aspect: number;
}

/** Fallback only — every catalogued class supplies its own. */
const DEFAULT_ASPECT = 4 / 3;
/** Aspect is clamped so one freak bounding box cannot produce a crop the card
 *  layout has no sane way to display (a 12:1 sliver, or a 1:6 column). */
const MIN_ASPECT = 0.5;
const MAX_ASPECT = 3.2;
/** Crop output ceiling on the LONG edge. Above this we are storing pixels no
 *  card or modal will ever show, at real cost in memory and IndexedDB. */
const MAX_CROP_W = 720;
/** Below ~2x, upscaling is sharpening a real image. Above it, it is inventing
 *  detail — the spec's "do not upscale aggressively" line, made a number. */
const MAX_ZOOM = 2;
/** Full-frame evidence ceiling. 1280 keeps a 30-event vault in tens of MB. */
const MAX_FULL_W = 1280;
const JPEG_QUALITY = 0.9;

// One canvas per purpose, reused for the life of the process. Allocating a
// canvas per capture is a GPU-backed allocation per alert; at a busy gate that
// is a visible hitch in the live view.
let cropCanvas: HTMLCanvasElement | null = null;
let fullCanvas: HTMLCanvasElement | null = null;

function canvasFor(which: "crop" | "full"): HTMLCanvasElement {
  if (which === "crop") {
    if (!cropCanvas) cropCanvas = document.createElement("canvas");
    return cropCanvas;
  }
  if (!fullCanvas) fullCanvas = document.createElement("canvas");
  return fullCanvas;
}

export type CaptureMedia = HTMLImageElement | HTMLVideoElement;

/** Intrinsic size of whatever is on screen, or null before the first frame. */
export function sourceSize(el: CaptureMedia | null): { w: number; h: number } | null {
  if (!el) return null;
  const w = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || 0;
  const h = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || 0;
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Grow the detection box into a crop window.
 *
 * Three things happen, in order, and the order matters:
 *   1. class-directional padding (a helmet box becomes head + torso),
 *   2. a floor on the window size so a 20px-tall distant figure is shown with
 *      context rather than blown up into four visible pixels,
 *   3. correction to the card's aspect ratio by GROWING the short axis — never
 *      by stretching, so what the operator sees is geometrically true.
 * Finally the window is clamped inside the frame, sliding rather than shrinking
 * so an object against the edge keeps its full requested area.
 */
function clampAspect(a: number): number {
  if (!isFinite(a) || a <= 0) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a));
}

export function cropWindow(
  box: NormalisedBox,
  pad: CropPadding,
  src: { w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const bx1 = box.x1 * src.w;
  const by1 = box.y1 * src.h;
  const bw = Math.max(1, (box.x2 - box.x1) * src.w);
  const bh = Math.max(1, (box.y2 - box.y1) * src.h);

  const aspect = clampAspect(pad.aspect);

  let x = bx1 - bw * pad.x;
  let y = by1 - bh * pad.top;
  let w = bw * (1 + pad.x * 2);
  let h = bh * (1 + pad.top + pad.bottom);

  // (2) Minimum window: enough real pixels that a 2x zoom still looks like a
  // photograph. Grown around the centre so the object stays centred. Sized on
  // the long edge so a portrait target does not get a landscape floor imposed
  // on it (which would reintroduce exactly the background we are avoiding).
  const minLong = MAX_CROP_W / MAX_ZOOM;
  const minW = aspect >= 1 ? minLong : minLong * aspect;
  const minH = aspect >= 1 ? minLong / aspect : minLong;
  if (w < minW) { x -= (minW - w) / 2; w = minW; }
  if (h < minH) { y -= (minH - h) / 2; h = minH; }

  // (3) Aspect correction by growth only — never by stretching, so what the
  // operator sees stays geometrically true to the scene.
  if (w / h > aspect) {
    const want = w / aspect;
    y -= (want - h) / 2;
    h = want;
  } else {
    const want = h * aspect;
    x -= (want - w) / 2;
    w = want;
  }

  // A window larger than the frame can only be the whole frame.
  if (w > src.w) { const k = src.w / w; w = src.w; h *= k; }
  if (h > src.h) { const k = src.h / h; h = src.h; w *= k; }

  // Slide inside the frame rather than clipping, so an object at the edge keeps
  // the area it asked for instead of a half-window.
  x = Math.max(0, Math.min(x, src.w - w));
  y = Math.max(0, Math.min(y, src.h - h));

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/**
 * Mild unsharp mask, applied only when the crop was actually enlarged.
 *
 * A 3x3 sharpen kernel with the centre weight tapered by how much we zoomed:
 * at 1x it is a no-op, at 2x it is a light edge lift. Deliberately conservative
 * — an over-sharpened plate or face is worse evidence than a soft one, because
 * it looks like detail that was never there.
 */
function sharpen(ctx: CanvasRenderingContext2D, w: number, h: number, zoom: number): void {
  const amount = Math.min(0.6, Math.max(0, (zoom - 1.15) * 0.8));
  if (amount <= 0.01) return;

  let img: ImageData;
  try {
    img = ctx.getImageData(0, 0, w, h);
  } catch {
    return; // tainted — the caller's toBlob will report it properly
  }
  const src = img.data;
  const out = new Uint8ClampedArray(src);
  const centre = 1 + 4 * amount;
  const side = -amount;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const p = i + c;
        const v =
          src[p] * centre +
          src[p - 4] * side +
          src[p + 4] * side +
          src[p - w * 4] * side +
          src[p + w * 4] * side;
        out[p] = v;
      }
    }
  }
  img.data.set(out);
  ctx.putImageData(img, 0, 0);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    } catch {
      // SecurityError: the source image was cross-origin without CORS.
      resolve(null);
    }
  });
}

/**
 * Capture one detection. Returns null if the media has no frame yet, or if the
 * canvas is tainted — both are "no snapshot", never an exception into the
 * telemetry handler.
 *
 * Cost is two drawImage calls and two JPEG encodes off the main video path.
 * The caller (alertEngine) is responsible for making sure this runs rarely:
 * once per new tracked object per cooldown, never per frame.
 */
export async function captureDetection(
  media: CaptureMedia,
  box: NormalisedBox,
  pad: CropPadding,
): Promise<CaptureResult | null> {
  const src = sourceSize(media);
  if (!src) return null;

  const region = cropWindow(box, pad, src);
  if (region.w < 8 || region.h < 8) return null;

  // Budget the LONG edge, not the width: a portrait crop capped on width would
  // be allowed a far larger pixel area than a landscape one for no reason.
  const longEdge = Math.max(region.w, region.h);
  const zoom = Math.min(MAX_ZOOM, Math.max(1, MAX_CROP_W / longEdge));
  const outW = Math.round(region.w * zoom);
  const outH = Math.round(region.h * zoom);

  const cc = canvasFor("crop");
  cc.width = outW;
  cc.height = outH;
  const cctx = cc.getContext("2d", { willReadFrequently: true });
  if (!cctx) return null;
  cctx.imageSmoothingEnabled = true;
  cctx.imageSmoothingQuality = "high";
  try {
    cctx.drawImage(media, region.x, region.y, region.w, region.h, 0, 0, outW, outH);
  } catch {
    return null; // media went away mid-capture (stream dropped, tile unmounted)
  }
  sharpen(cctx, outW, outH, zoom);

  const fc = canvasFor("full");
  const fullScale = Math.min(1, MAX_FULL_W / src.w);
  const fw = Math.round(src.w * fullScale);
  const fh = Math.round(src.h * fullScale);
  fc.width = fw;
  fc.height = fh;
  const fctx = fc.getContext("2d");
  if (!fctx) return null;
  try {
    fctx.drawImage(media, 0, 0, fw, fh);
  } catch {
    return null;
  }

  const [crop, full] = await Promise.all([toBlob(cc), toBlob(fc)]);
  if (!crop || !full) return null;

  return {
    crop, cropWidth: outW, cropHeight: outH,
    full, fullWidth: fw, fullHeight: fh,
    region, zoom,
    aspect: outH > 0 ? outW / outH : DEFAULT_ASPECT,
  };
}

/**
 * Re-encode an existing JPEG blob as PNG for export.
 *
 * Lossless from the JPEG we already hold — it cannot recover what JPEG threw
 * away, and is offered because some evidence workflows require PNG, not because
 * it is a better picture. Runs on demand from a click, never on the alert path.
 */
export async function toPng(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => resolve(null);
      el.src = url;
    });
    if (!img) return null;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob | null>((resolve) => {
      try {
        c.toBlob((b) => resolve(b), "image/png");
      } catch {
        resolve(null);
      }
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Run `fn` when the renderer is not busy painting.
 *
 * Capture is triggered from a WebSocket message handler, which runs on the same
 * thread that composites the live video. Encoding two JPEGs inline there is a
 * few milliseconds of jank exactly when something interesting is happening on
 * screen. requestIdleCallback moves it to the gap after paint; the timeout
 * guarantees it still runs on a saturated frame budget.
 */
export function whenIdle(fn: () => void, timeoutMs = 250): void {
  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;
  if (ric) ric(fn, { timeout: timeoutMs });
  else setTimeout(fn, 0);
}
