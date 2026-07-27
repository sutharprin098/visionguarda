import { memo, useEffect, useRef, useState } from "react";
import {
  Check, Maximize2, X, ImageOff, Loader2, Cpu, Radio, WifiOff, Clock, Hash,
} from "lucide-react";
import clsx from "clsx";
import type { AlertEvent } from "../../lib/alertEngine";
import { SEVERITY_THEME } from "../../lib/alertCatalog";
import { useRelativeTime, confidenceLabel, speedLabel, durationLabel } from "./alertUtils";
import type { CameraLiveStatus } from "./alertUtils";

/**
 * One floating alert.
 *
 * DWELL TIME IS SEVERITY-DEPENDENT, and critical never auto-dismisses. An
 * unacknowledged critical that quietly disappeared after eight seconds is a
 * missed incident with no trace on screen, which is the failure mode operators
 * actually get fired for. Low-severity presence events, by contrast, must clear
 * themselves or the corner fills with cars.
 *
 * Hover truly PAUSES the countdown — it does not restart it. Reaching for a
 * card must not be a race against it, and a card that resets its timer every
 * time the pointer crosses it never leaves the screen at all.
 */
const DWELL_MS: Record<string, number> = {
  critical: 0, // sticky until acknowledged or dismissed
  high: 30_000,
  medium: 18_000,
  low: 11_000,
};

const SEV_CLASS: Record<string, string> = {
  critical: "camai-sev-critical",
  high: "camai-sev-high",
  medium: "camai-sev-medium",
  low: "camai-sev-low",
};

function AlertCard({
  event,
  snapshotsAvailable,
  cameraStatusFor,
  demoMode,
  onAcknowledge,
  onDismiss,
  onOpenLive,
  onOpenDetail,
}: {
  event: AlertEvent;
  snapshotsAvailable: boolean;
  /**
   * Deliberately a stable FUNCTION, not a status object.
   *
   * Camera liveness changes several times a second. Passing it as a prop would
   * hand `memo` a freshly-allocated object on every parent render, which makes
   * the memo comparison fail every single time — the exact "unnecessary
   * re-render" this component is memoised to prevent. The card already
   * re-renders once a second for its own age label, so calling this at render
   * time keeps the indicator at most one second stale for zero extra renders.
   */
  cameraStatusFor: (cameraId: string) => CameraLiveStatus;
  demoMode: boolean;
  onAcknowledge: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpenLive: (cameraId: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  const theme = SEVERITY_THEME[event.severity];
  const Icon = event.def.icon;
  const age = useRelativeTime(event.ts);
  const cameraStatus = cameraStatusFor(event.cameraId);
  const [hovered, setHovered] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // --- dwell with real pause/resume -----------------------------------------
  const baseDwell = DWELL_MS[event.severity] ?? 12_000;
  const dwell = demoMode ? baseDwell * 1.8 : baseDwell;
  const remainingRef = useRef(dwell);
  const startedRef = useRef(0);

  useEffect(() => {
    if (dwell === 0 || event.acknowledged) return;
    if (hovered) return;
    startedRef.current = performance.now();
    const id = setTimeout(() => dismissRef.current(event.id), remainingRef.current);
    return () => {
      clearTimeout(id);
      // Bank what is left so the next run continues rather than restarting.
      const spent = performance.now() - startedRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - spent);
    };
  }, [dwell, hovered, event.id, event.acknowledged]);

  // A capture that never lands (tainted canvas, stream dropped mid-encode)
  // must resolve to a stated "no snapshot", not a spinner that spins forever.
  const [waitedOut, setWaitedOut] = useState(false);
  useEffect(() => {
    if (event.cropUrl) return;
    const id = setTimeout(() => setWaitedOut(true), 4000);
    return () => clearTimeout(id);
  }, [event.cropUrl]);

  const speed = speedLabel(event.meta.speed, event.meta.speedStatus);
  const noSnapshot = !event.cropUrl && (waitedOut || !snapshotsAvailable);
  const confPct = event.confidence != null ? Math.round(event.confidence * 100) : null;
  // Portrait crops get a portrait box. See CropPad.aspect for why this is not
  // cosmetic: a fixed box is what forces background into the picture.
  const aspect = event.meta.aspect && isFinite(event.meta.aspect)
    ? Math.min(2.9, Math.max(0.62, event.meta.aspect))
    : 16 / 9;

  return (
    <div
      role="alert"
      aria-live={event.severity === "critical" ? "assertive" : "polite"}
      aria-label={`${theme.label} alert: ${event.def.title} on ${event.cameraName}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
      className={clsx(
        "camai-alert-card pointer-events-auto w-[358px] overflow-hidden rounded-2xl border backdrop-blur-xl",
        SEV_CLASS[event.severity],
      )}
      style={{
        background: "linear-gradient(180deg, rgba(20,24,30,0.86) 0%, rgba(13,16,20,0.90) 100%)",
        borderColor: "rgba(255,255,255,0.07)",
        boxShadow: `0 20px 45px -15px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px ${theme.ring} inset`,
      }}
    >
      <div className="flex">
        {/* Severity rail — the only saturated element on the card. */}
        <div className="w-[3px] shrink-0" style={{ background: theme.accent }} />
        <div className="min-w-0 flex-1">
          {/* ---- header ---- */}
          <div className="flex items-center gap-2 px-3.5 pt-3 pb-2" style={{ background: theme.wash }}>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: theme.accent, boxShadow: `0 0 8px ${theme.accent}` }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: theme.text }}
            >
              {theme.label}
            </span>
            <span className="text-[10px] text-zinc-600">•</span>
            <span className="truncate text-[10px] uppercase tracking-wider text-zinc-500">
              {event.def.group}
            </span>
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-500">{age}</span>
            <button
              onClick={() => onDismiss(event.id)}
              aria-label="Dismiss alert"
              className="-mr-1 rounded p-1 text-zinc-600 transition hover:bg-white/5 hover:text-zinc-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              <X size={12} />
            </button>
          </div>

          {/* ---- title + camera identity ---- */}
          <div className="flex items-start gap-2.5 px-3.5 pt-2.5">
            <div
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: theme.wash, color: theme.accent, boxShadow: `inset 0 0 0 1px ${theme.ring}` }}
            >
              <Icon size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold leading-tight text-zinc-100">
                {event.def.title}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                <CameraStatusDot status={cameraStatus} />
                <span className="truncate">
                  {event.cameraName} <span className="text-zinc-700">•</span> {event.siteName}
                </span>
              </div>
            </div>
            {/* Camera thumbnail: the wide shot, so the operator can place the
                crop in the scene without opening anything. */}
            {event.fullUrl && (
              <button
                onClick={() => onOpenDetail(event.id)}
                aria-label="Open full frame"
                className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md border border-white/[0.07] bg-black/40 transition hover:border-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              >
                <img src={event.fullUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover opacity-80" />
              </button>
            )}
          </div>

          {/* ---- evidence crop ---- */}
          <button
            onClick={() => onOpenDetail(event.id)}
            aria-label="Open incident detail"
            className="group relative mx-3.5 mt-2.5 block w-[calc(100%-1.75rem)] overflow-hidden rounded-xl border border-white/[0.06] bg-black/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            style={{ aspectRatio: String(aspect) }}
          >
            {event.cropUrl ? (
              <>
                <img
                  // Keying on the URL makes React swap the element on refresh,
                  // which is what re-triggers the cross-fade each second.
                  key={event.cropUrl}
                  src={event.cropUrl}
                  alt={`${event.def.title} snapshot`}
                  loading="lazy"
                  decoding="async"
                  className="camai-crop-swap h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
                <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-300 backdrop-blur-sm">
                  {event.live && (
                    <span className="camai-live-dot mr-0.5 h-1 w-1 rounded-full bg-red-400" aria-hidden />
                  )}
                  {event.live
                    ? "Live"
                    : event.meta.cropKind === "detection"
                      ? `Zoomed${event.meta.zoom && event.meta.zoom > 1.05 ? ` ${event.meta.zoom.toFixed(1)}×` : ""}`
                      : "Scene"}
                </div>
                <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-medium text-zinc-300 opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                  <Maximize2 size={9} /> Full frame
                </div>
              </>
            ) : noSnapshot ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-zinc-600">
                <ImageOff size={18} />
                <span className="text-[10px]">No snapshot for this event</span>
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="camai-alert-shimmer absolute inset-0" />
                <Loader2 size={16} className="animate-spin text-zinc-600" />
              </div>
            )}
          </button>

          {/* ---- confidence bar ---- */}
          <div className="mt-2.5 px-3.5">
            <div className="mb-1 flex items-baseline justify-between text-[10px]">
              <span className="text-zinc-500">Confidence</span>
              <span className="font-semibold tabular-nums text-zinc-200">
                {confidenceLabel(event.confidence)}
              </span>
            </div>
            <div
              className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]"
              role="progressbar"
              aria-valuenow={confPct ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Detection confidence"
            >
              {confPct != null && (
                <div
                  className="camai-confidence-fill h-full rounded-full"
                  style={{ width: `${confPct}%`, background: theme.accent }}
                />
              )}
            </div>
          </div>

          {/* ---- tracking facts ---- */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 text-[10px]">
            {event.trackId != null && (
              <Fact icon={<Hash size={9} />} label="Track" value={String(event.trackId)} mono />
            )}
            <Fact
              icon={<Clock size={9} />}
              label="Duration"
              value={durationLabel(event)}
            />
            {event.meta.direction && event.meta.direction !== "stationary" && (
              <Fact label="Heading" value={event.meta.direction} />
            )}
            {speed && <Fact label="Speed" value={speed} />}
            {event.meta.plate && <Fact label="Plate" value={event.meta.plate} mono />}
          </div>

          {/* ---- provenance strip: what produced this, and which record it is ---- */}
          <div className="mt-2 flex items-center gap-1.5 px-3.5 text-[9px] text-zinc-600">
            <span
              className="flex items-center gap-1 rounded border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 font-medium uppercase tracking-wider text-zinc-400"
              title={`Detected by the local AI engine${event.meta.device ? ` on ${event.meta.device.toUpperCase()}` : ""}`}
            >
              <Cpu size={8} /> AI{event.meta.device ? ` · ${event.meta.device.toUpperCase()}` : ""}
            </span>
            <span className="truncate font-mono" title={`Event ID ${event.id}`}>
              {event.id}
            </span>
            {event.refreshes > 0 && (
              <span className="ml-auto shrink-0 tabular-nums" title="Live crop refreshes">
                ↻{event.refreshes}
              </span>
            )}
          </div>

          {/* ---- actions ---- */}
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-white/[0.05] px-2.5 py-2">
            <button
              onClick={() => onOpenLive(event.cameraId)}
              className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-300 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              Open Live Feed
            </button>
            <button
              onClick={() => onAcknowledge(event.id)}
              disabled={event.acknowledged}
              className={clsx(
                "flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
                event.acknowledged ? "text-ok" : "text-zinc-300 hover:bg-white/[0.07] hover:text-white",
              )}
            >
              <Check size={12} /> {event.acknowledged ? "Acknowledged" : "Acknowledge"}
            </button>
            <button
              onClick={() => onOpenDetail(event.id)}
              className="flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-400 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            >
              Evidence
            </button>
          </div>

          {/* ---- countdown ---- */}
          {dwell > 0 && !event.acknowledged && (
            <div className="h-[2px] w-full bg-white/[0.04]" aria-hidden>
              <div
                className="camai-countdown h-full"
                style={{
                  background: theme.accent,
                  opacity: 0.5,
                  animationDuration: `${dwell}ms`,
                  animationPlayState: hovered ? "paused" : "running",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({
  icon, label, value, mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1">
      {icon && <span className="translate-y-[1px] text-zinc-600">{icon}</span>}
      <span className="text-zinc-600">{label}</span>
      <span className={clsx("font-semibold text-zinc-300", mono && "font-mono")}>{value}</span>
    </span>
  );
}

/** Whether the camera behind this alert is still reporting, right now. */
function CameraStatusDot({ status }: { status: CameraLiveStatus }) {
  if (status.live) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-ok" title={`Streaming${status.fps ? ` · ${status.fps.toFixed(0)} fps` : ""}`}>
        <Radio size={9} />
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-warn"
      title={`No telemetry for ${Math.round(status.ageMs / 1000)}s`}
    >
      <WifiOff size={9} />
    </span>
  );
}

// The stack re-renders whenever ANY event changes; without this every visible
// card would re-render on every alert, next to live video decoding.
export default memo(AlertCard);
