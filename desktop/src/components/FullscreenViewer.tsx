import { useCallback, useEffect, useRef, useState } from "react";
import { Minimize2, ChevronLeft, ChevronRight, Video, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import DetectionOverlay from "./DetectionOverlay";
import { mjpegStreamUrl } from "../lib/localEngine";
import { TelemetrySession, TelemetryDetection, CameraTelemetry } from "../lib/telemetry";
import { filterDetections, loadModules } from "../lib/aiModules";
import { useAlertIngest } from "./alerts/AlertProvider";
import { siteLabel } from "./alerts/alertUtils";

/**
 * Full-window single-camera viewer.
 *
 * WHY THIS IS AN OVERLAY, NOT element.requestFullscreen():
 *
 * The old implementation called tile.requestFullscreen().catch(() => {}). That
 * has two fatal properties: it returns a promise that can reject for reasons the
 * page cannot inspect, and the rejection was swallowed — so a refusal and a
 * success looked identical from the operator's chair ("the button does
 * nothing"). It also fundamentally cannot switch cameras while fullscreen: the
 * fullscreen element IS one tile, so showing a different camera means exiting
 * and re-entering.
 *
 * This component is rendered above everything with plain layout instead. Opening
 * it is a setState, which cannot fail, cannot be refused, and needs no user
 * gesture. The OS-level window fullscreen (window.camai.window.setFullScreen) is
 * layered on top as an enhancement — if it is refused, the camera is still
 * full-window and every control still works.
 *
 * The chrome (sidebar, tabs, camera grid, stats, settings) is hidden by being
 * covered: this is position:fixed inset-0 at a z-index above the app shell, so
 * the previous layout is untouched underneath and returns exactly as it was when
 * the viewer closes — no layout state to save or restore.
 */

const log = (msg: string, ...rest: unknown[]) => console.log(`[Fullscreen] ${msg}`, ...rest);

export interface ViewerCamera {
  id: string;
  name: string;
  source_type?: string;
}

export default function FullscreenViewer({
  cameras,
  cameraId,
  orgName,
  onSelectCamera,
  onExit,
}: {
  /** Every camera the operator may switch to without leaving fullscreen. */
  cameras: ViewerCamera[];
  cameraId: string;
  /** Fallback for the alert card's site line — see siteLabel(). */
  orgName?: string | null;
  onSelectCamera: (id: string) => void;
  onExit: () => void;
}) {
  const [detections, setDetections] = useState<TelemetryDetection[]>([]);
  const [telemetry, setTelemetry] = useState<CameraTelemetry | null>(null);
  const [streamFailed, setStreamFailed] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const imgRef = useRef<HTMLImageElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cam = cameras.find((c) => c.id === cameraId) ?? null;
  const index = cameras.findIndex((c) => c.id === cameraId);
  const modules = loadModules(cameraId);
  const shown = filterDetections(detections, modules);

  // The engine positively reports this camera's capture as not-online. A null
  // health_status means "nothing heard yet", which must not read as a fault.
  const sourceFault =
    telemetry?.health_status === "offline" ||
    telemetry?.health_status === "auth_failed" ||
    telemetry?.health_status === "network_error" ||
    telemetry?.health_status === "error" ||
    telemetry?.health_status === "source_gone";

  // ---- OS-level window fullscreen (enhancement, not a dependency) ----------
  //
  // Every call is guarded. The IPC bridge is injected by the preload script, and
  // a renderer can outlive a preload that predates this API (an older packaged
  // build, or a dev HMR reload where only the renderer refreshed). If this
  // component reached for window.camai.window.* unguarded it would throw during
  // an effect and take the viewer down with it — turning "OS fullscreen isn't
  // available" into "fullscreen is broken again", which is precisely the failure
  // mode this rewrite exists to eliminate. Without the bridge the overlay still
  // fills the app window and every control still works.
  const winApi = (window as any)?.camai?.window as
    | typeof window.camai.window
    | undefined;

  // DELIBERATELY NOT taking the OS window fullscreen.
  //
  // The viewer expands the camera to fill the app window at WHATEVER SIZE THE
  // WINDOW ALREADY IS — it never resizes the window, never covers the taskbar,
  // and never jumps to a different display. If the app is a half-screen window,
  // the camera fills that half-screen window.
  //
  // The BrowserWindow fullscreen IPC still exists (main.ts: window-set-fullscreen)
  // and is one line away if a true kiosk mode is ever wanted; it is not called on
  // purpose. Window size is the operator's choice, not the camera's.
  useEffect(() => {
    log("expanding camera to fill app window (window size unchanged)", { cameraId });
    return () => log("restoring grid layout");
  }, [cameraId]);

  useEffect(() => {
    if (!winApi?.onResized) return;
    return winApi.onResized(({ width, height, fullscreen }) => {
      log("window resized", { width, height, fullscreen });
    });
  }, [winApi]);

  const [retryCount, setRetryCount] = useState(0);
  // Same CORS-with-fallback arrangement as the grid tile: the stream is
  // requested with crossOrigin so the alert system can crop a snapshot out of
  // the canvas, and falls back to a plain request (no snapshots) rather than
  // ever leaving the operator staring at a black window. See Workspace's
  // CameraTile for the full reasoning.
  const [imgCors, setImgCors] = useState(true);
  const corsProvenRef = useRef(false);

  // ---- telemetry: detection keeps running; this only subscribes ------------
  // The engine analyses whatever cameras are registered regardless of who is
  // watching, so opening/closing this viewer never interrupts detection — it
  // only changes which telemetry we listen to.
  // While this viewer is open every tile in the grid drops its telemetry socket
  // (they are covered — see the `paused` note in Workspace), so THIS is the only
  // subscription left alive. Without ingesting here, alerts would go silent for
  // exactly as long as an operator was watching a camera full-window, which is
  // when they are paying the most attention.
  const ingestAlert = useAlertIngest();
  useEffect(() => {
    setDetections([]);
    setTelemetry(null);
    setStreamFailed(false);
    setRetryCount(0);
    const cam = cameras.find((c) => c.id === cameraId);
    const ctx = {
      id: cameraId,
      name: cam?.name ?? cameraId,
      site: siteLabel(cam, orgName),
    };
    const session = new TelemetrySession(cameraId, (t) => {
      setDetections(t.detections ?? []);
      setTelemetry(t);
      ingestAlert(ctx, t, imgCors ? imgRef.current : null);
    });
    session.start();
    log("telemetry subscribed", { cameraId });
    return () => {
      session.stop();
      log("telemetry unsubscribed", { cameraId });
    };
    // `cameras` is intentionally not a dep: it changes identity on every sync
    // tick and re-subscribing the socket for a renamed camera would drop frames
    // of telemetry for no visible gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, orgName, ingestAlert, imgCors]);

  // ---- preview resolution: deliberately NOT raised for fullscreen -----------
  //
  // The engine encodes every preview at TILE_MAX_WIDTH (960), which full-window
  // is upscaled ~2x on a 1080p display, so the obvious idea is to ask for more
  // while this viewer owns the stream. It was tried and MEASURED, and it is the
  // wrong trade for this product:
  //
  //     960px  -> 18.5 preview fps, 63 KB/frame
  //     1280px -> 13.9 preview fps, 97 KB/frame
  //
  // The JPEG encode runs on the decode thread that also feeds the AI stage, and
  // that thread is already the limiter (the camera delivers 30fps; the preview
  // only reaches 18.5 at 960). So a sharper picture is bought directly out of
  // frame rate — 25% of it — and a choppier live view is exactly what operators
  // report as "not real time". Sharpness is cosmetic; smoothness is the job.
  //
  // setCameraDisplay() is wired and available (localEngine.ts) if a per-camera
  // quality control is ever wanted, and the engine's /display endpoint accepts
  // max_width 320..1920. It is simply not applied automatically here, because
  // no operator asked to trade frames for pixels.

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (imgCors && !corsProvenRef.current) {
      log("stream refused CORS — retrying without it (snapshots unavailable)", { cameraId });
      setImgCors(false);
    }
    log("stream image error, retrying...", { cameraId, retryCount });
    const target = e.currentTarget;
    setTimeout(() => {
      if (target && target.src) {
        try {
          const url = new URL(target.src);
          url.searchParams.set("_t", String(Date.now()));
          target.src = url.toString();
        } catch { /* ignore */ }
      }
    }, 1500);
  };

  // ---- camera switching without leaving fullscreen -------------------------
  const step = useCallback((delta: number) => {
    if (cameras.length < 2) return;
    const next = cameras[(index + delta + cameras.length) % cameras.length];
    if (next) {
      log("switching camera in place", { from: cameraId, to: next.id });
      onSelectCamera(next.id);
    }
  }, [cameras, index, cameraId, onSelectCamera]);

  // ---- keyboard ------------------------------------------------------------
  // ESC and F11 both land here. F11 reaches the renderer because Electron's
  // stock View -> Toggle Full Screen menu (accelerator F11) is removed in
  // main.ts; without that it never got this far.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "F11") {
        e.preventDefault();
        log(`${e.key} pressed -> exit`);
        onExit();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, step]);

  // Auto-hide the controls so a wall display isn't permanently branded with a
  // toolbar; any mouse movement brings them back.
  useEffect(() => {
    const wake = () => {
      setShowChrome(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShowChrome(false), 2500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    return () => {
      window.removeEventListener("mousemove", wake);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black"
      onDoubleClick={() => { log("double-click -> exit"); onExit(); }}
    >
      {/* object-contain keeps the source aspect ratio: never stretched. Bars
          appear only when the camera's aspect differs from the window's, which
          is the "unless required" case — cropping instead would hide detections
          that are genuinely there. */}
      {/* Same connection-budget rule as the grid tile: don't hold an MJPEG
          connection open for a source the engine says has no video. The reason
          banner below explains it, and telemetry keeps flowing on the WebSocket
          so recovery re-requests the stream on its own. */}
      {!streamFailed ? (
        <img
          key={`${cameraId}_${retryCount}_${imgCors ? "cors" : "plain"}`}
          ref={imgRef}
          crossOrigin={imgCors ? "anonymous" : undefined}
          src={mjpegStreamUrl(cameraId)}
          alt=""
          className="h-full w-full object-contain"
          onLoad={() => { corsProvenRef.current = imgCors; }}
          onError={handleImageError}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
          <Video size={40} />
          <span className="text-sm">No live stream for {cam?.name ?? cameraId}</span>
          <span className="text-xs">
            {sourceFault ? "The camera's source isn't sending video." : "The engine isn't decoding this camera."}
          </span>
        </div>
      )}

      {/* Boxes / track IDs / confidence / speed. Same overlay component the grid
          uses, so alignment logic exists once. It re-measures itself from the
          <img>'s box via ResizeObserver, so entering fullscreen, resizing, or
          moving to a monitor with a different DPR realigns automatically. */}
      {/* Mounted whenever the stream is, not only while boxes exist — a canvas
          that unmounts on every empty frame has to re-measure itself before it
          can draw the next non-empty one. */}
      {!streamFailed && (
        <DetectionOverlay
          detections={shown}
          mediaRef={imgRef as React.RefObject<HTMLImageElement>}
          fit="contain"
        />
      )}

      {/* Same reason banner as the grid tile. Deliberately NOT tied to
          showChrome: the chrome auto-hides after a few seconds of no mouse
          movement, and "why is this camera black" is exactly the question an
          operator asks while sitting still watching it. Fading the answer out
          would recreate the original bug inside fullscreen. */}
      {!streamFailed && sourceFault && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex items-start gap-2.5 bg-black/85 px-4 py-3">
          <AlertTriangle size={16} className="mt-px shrink-0 text-warn" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">
              No video from this source — AI is not running on it
            </div>
            {telemetry.source_error && (
              <div className="mt-0.5 text-xs leading-snug text-zinc-400">{telemetry.source_error}</div>
            )}
          </div>
        </div>
      )}

      {/* FPS / device. Hidden while faulted — "0 shown · 0.0 fps" is the absence
          of a reading, not a reading, and it would sit on the banner. */}
      {telemetry && !sourceFault && (
        <div className={clsx(
          "absolute bottom-4 left-4 z-20 rounded bg-black/70 px-3 py-1 text-xs font-semibold text-zinc-100 shadow transition-opacity",
          showChrome ? "opacity-100" : "opacity-0",
        )}>
          {shown.length} shown · {(telemetry.fps ?? 0).toFixed(1)} fps
          {telemetry.device ? ` · ${telemetry.device.toUpperCase()}` : ""}
        </div>
      )}

      <div className={clsx(
        "absolute top-4 left-1/2 z-20 -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-sm font-semibold text-zinc-100 shadow transition-opacity",
        showChrome ? "opacity-100" : "opacity-0",
      )}>
        {cam?.name ?? cameraId}
        {cameras.length > 1 && <span className="ml-2 text-xs text-zinc-400">{index + 1}/{cameras.length}</span>}
      </div>

      {/* Switch camera without leaving fullscreen (spec 9).
          pointer-events-none while faded out: an opacity-0 button is still a
          click target, so the hidden arrows and Exit control were silently
          swallowing clicks on the video underneath them. */}
      {cameras.length > 1 && (
        <div className={clsx("transition-opacity", showChrome ? "opacity-100" : "pointer-events-none opacity-0")}>
          <button
            onClick={(e) => { e.stopPropagation(); step(-1); }}
            title="Previous camera (←)"
            className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/70 p-3 text-zinc-200 transition-colors hover:bg-black/90 hover:text-white"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); step(1); }}
            title="Next camera (→)"
            className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/70 p-3 text-zinc-200 transition-colors hover:bg-black/90 hover:text-white"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); log("exit button clicked"); onExit(); }}
        title="Exit full screen (ESC or F11)"
        className={clsx(
          "absolute top-4 right-4 z-20 flex items-center gap-1.5 rounded bg-black/70 px-3 py-2 text-xs font-semibold text-zinc-200 shadow transition-opacity hover:bg-black/90 hover:text-white",
          showChrome ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <Minimize2 size={14} /> Exit Full Screen
      </button>
    </div>
  );
}
