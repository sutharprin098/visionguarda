import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, FileDown, ImageOff, Check, Video, Layers, Film, Table,
  FileJson, FileText, Image as ImageIcon, Loader2, ArrowDown, Info,
} from "lucide-react";
import clsx from "clsx";
import type { AlertEvent } from "../../lib/alertEngine";
import type { TimelineEntry, Basis } from "../../lib/trackLedger";
import { SEVERITY_THEME } from "../../lib/alertCatalog";
import {
  clockTime, confidenceLabel, speedLabel, formatAge, drawFrameBoxes, durationLabel,
} from "./alertUtils";
import {
  exportJpeg, exportPngFile, exportCsv, exportJson, exportPdf, exportBundle,
  triggerDownload, stemFor,
} from "../../lib/incidentExport";
import { recordClip, clipSupported, pickMimeType, type ClipMedia } from "../../lib/clipRecorder";

/**
 * The full record behind one card.
 *
 * Seven tabs, and the split between them is by QUESTION rather than by data
 * type: Overview answers "what happened", Evidence "show me", Timeline "in what
 * order", AI Analysis "how sure are we and why", Metadata "give me the raw
 * fields", Downloads "get it out of here", History "has this happened before".
 * An operator under time pressure should never have to guess which tab holds
 * the thing they need.
 */

type Tab = "overview" | "evidence" | "timeline" | "analysis" | "metadata" | "downloads" | "history";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "timeline", label: "Timeline" },
  { id: "analysis", label: "AI Analysis" },
  { id: "metadata", label: "Metadata" },
  { id: "downloads", label: "Downloads" },
  { id: "history", label: "History" },
];

export default function IncidentWindow({
  event,
  allEvents,
  captureMediaFor,
  onClose,
  onAcknowledge,
  onOpenLive,
  onSelectEvent,
}: {
  event: AlertEvent;
  /** Every event still in memory — powers History and cross-camera correlation. */
  allEvents: AlertEvent[];
  /** The live element for a camera, if one is on screen. Needed for clip capture. */
  captureMediaFor: (cameraId: string) => ClipMedia | null;
  onClose: () => void;
  onAcknowledge: (id: string) => void;
  onOpenLive: (cameraId: string) => void;
  onSelectEvent: (id: string) => void;
}) {
  const theme = SEVERITY_THEME[event.severity];
  const Icon = event.def.icon;
  const [tab, setTab] = useState<Tab>("overview");

  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Focus management.
   *
   * A modal that does not move focus is a modal a keyboard operator cannot
   * reach: Tab keeps walking the camera grid behind it, and Escape works only
   * because it is bound globally. On open, focus moves into the panel; on
   * close, it returns to whatever raised it (the card, or the row in the
   * notification center) so the operator is not dumped at the top of the page.
   */
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      // Trap: keep Tab inside the dialog rather than letting it escape into the
      // live grid, which is inert to the operator while this is open.
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const cameraHistory = useMemo(
    () => allEvents.filter((e) => e.cameraId === event.cameraId).sort((a, b) => b.ts - a.ts),
    [allEvents, event.cameraId],
  );

  return createPortal(
    <div
      className="camai-alert-fade fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Incident: ${event.def.title}`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="camai-alert-pop flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/[0.07] shadow-[0_40px_90px_-20px_rgba(0,0,0,0.9)] focus:outline-none"
        style={{ background: "linear-gradient(180deg, rgba(19,23,29,0.97) 0%, rgba(12,15,19,0.98) 100%)" }}
      >
        {/* ---- header ---- */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ background: theme.wash, color: theme.accent, boxShadow: `inset 0 0 0 1px ${theme.ring}` }}
          >
            <Icon size={17} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-zinc-100">{event.def.title}</h2>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]"
                style={{ background: theme.wash, color: theme.text, boxShadow: `inset 0 0 0 1px ${theme.ring}` }}
              >
                {theme.label}
              </span>
              {event.live && (
                <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-red-300">
                  <span className="camai-live-dot h-1 w-1 rounded-full bg-red-400" /> Live
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-zinc-500">
              {event.cameraName} <span className="text-zinc-700">•</span> {event.siteName}
              <span className="text-zinc-700"> • </span>
              {clockTime(event.ts)} ({formatAge(event.ts)})
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => { onOpenLive(event.cameraId); onClose(); }}
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-white/[0.12]"
            >
              <Video size={13} /> Live Feed
            </button>
            <button
              onClick={() => onAcknowledge(event.id)}
              disabled={event.acknowledged}
              className={clsx(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition",
                event.acknowledged ? "text-ok" : "text-zinc-300 hover:bg-white/[0.07]",
              )}
            >
              <Check size={13} /> {event.acknowledged ? "Acknowledged" : "Acknowledge"}
            </button>
            <button
              onClick={onClose}
              aria-label="Close incident"
              className="rounded-lg p-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ---- tabs ---- */}
        <div role="tablist" className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "relative px-3 py-2.5 text-[12px] font-medium transition",
                tab === t.id ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {t.label}
              {tab === t.id && (
                <span
                  className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                  style={{ background: theme.accent }}
                />
              )}
            </button>
          ))}
        </div>

        {/* ---- body ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "overview" && <OverviewTab event={event} />}
          {tab === "evidence" && <EvidenceTab event={event} />}
          {tab === "timeline" && <TimelineTab event={event} />}
          {tab === "analysis" && <AnalysisTab event={event} />}
          {tab === "metadata" && <MetadataTab event={event} />}
          {tab === "downloads" && <DownloadsTab event={event} captureMediaFor={captureMediaFor} />}
          {tab === "history" && (
            <HistoryTab
              event={event}
              cameraHistory={cameraHistory}
              allEvents={allEvents}
              onSelectEvent={onSelectEvent}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// --- Overview ----------------------------------------------------------------

function OverviewTab({ event }: { event: AlertEvent }) {
  const theme = SEVERITY_THEME[event.severity];
  const speed = speedLabel(event.meta.speed, event.meta.speedStatus);
  const aspect = event.meta.aspect && isFinite(event.meta.aspect) ? event.meta.aspect : 16 / 9;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5 p-5">
      <div>
        <div
          className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/40"
          style={{ aspectRatio: String(Math.min(2.9, Math.max(0.62, aspect))), maxHeight: "46vh" }}
        >
          {event.cropUrl ? (
            <img
              key={event.cropUrl}
              src={event.cropUrl}
              alt={`${event.def.title} evidence crop`}
              className="camai-crop-swap h-full w-full object-cover"
            />
          ) : (
            <NoImage />
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
          Cropped from the live frame on this node at {clockTime(event.ts)}
          {event.meta.zoom && event.meta.zoom > 1.02 ? `, enlarged ${event.meta.zoom.toFixed(2)}×` : ""}
          {event.refreshes > 0
            ? `, and refreshed ${event.refreshes} time${event.refreshes === 1 ? "" : "s"} while the subject stayed in view.`
            : "."}
        </p>
      </div>

      <div className="space-y-4">
        <BigStat label="Confidence" value={confidenceLabel(event.confidence)} accent={theme.accent} />
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Track" value={event.trackId != null ? `#${event.trackId}` : "untracked"} />
          <MiniStat label="Duration" value={durationLabel(event)} />
          <MiniStat label="Category" value={event.def.group} />
          <MiniStat label="Objects in frame" value={String(event.frameDetections.length)} />
          {speed && <MiniStat label="Speed" value={speed} />}
          {event.meta.direction && <MiniStat label="Heading" value={event.meta.direction} />}
        </div>
        {event.meta.plate && (
          <div className="rounded-lg border border-white/[0.07] bg-black/30 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-600">Plate read</div>
            <div className="mt-1 font-mono text-lg font-semibold tracking-wide text-zinc-100">
              {event.meta.plate}
            </div>
            {event.meta.plateConfidence != null && (
              <div className="mt-1 text-[10px] text-zinc-500">
                OCR confidence {(event.meta.plateConfidence * 100).toFixed(1)}% — separate from the
                detector's {confidenceLabel(event.confidence)} score for the plate box itself.
              </div>
            )}
          </div>
        )}
        {event.meta.plateFailure && (
          <Callout>Plate visible but unread: {event.meta.plateFailure}.</Callout>
        )}
      </div>
    </div>
  );
}

// --- Evidence ----------------------------------------------------------------

function EvidenceTab({ event }: { event: AlertEvent }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [view, setView] = useState<"frame" | "crop">("frame");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    if (!showBoxes || view !== "frame") {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawFrameBoxes(canvas, img, event.frameDetections, event.bbox);
  }, [event.frameDetections, event.bbox, showBoxes, view]);

  useEffect(() => {
    redraw();
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(redraw);
    ro.observe(img);
    img.addEventListener("load", redraw);
    return () => {
      ro.disconnect();
      img.removeEventListener("load", redraw);
    };
  }, [redraw]);

  const shown = view === "frame" ? event.fullUrl : event.cropUrl;

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg bg-black/40 p-0.5">
          {(["frame", "crop"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              disabled={v === "crop" ? !event.cropUrl : !event.fullUrl}
              className={clsx(
                "rounded-[7px] px-3 py-1 text-[11px] font-medium transition disabled:opacity-30",
                view === v ? "bg-white/[0.10] text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {v === "frame" ? "Full frame" : "Crop"}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowBoxes((v) => !v)}
          disabled={view !== "frame"}
          className={clsx(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-30",
            showBoxes ? "bg-white/[0.08] text-zinc-100" : "text-zinc-400 hover:bg-white/[0.06]",
          )}
        >
          <Layers size={12} /> AI boxes
        </button>
        {event.meta.region && (
          <span className="ml-auto font-mono text-[10px] text-zinc-600">
            crop region {event.meta.region.w}×{event.meta.region.h}px @ {event.meta.region.x},{event.meta.region.y}
          </span>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center rounded-xl bg-black/50 p-3">
        {shown ? (
          <div className="relative flex h-full w-full items-center justify-center">
            <img
              ref={imgRef}
              src={shown}
              alt={`${event.def.title} evidence`}
              className="max-h-full max-w-full object-contain"
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>
        ) : (
          <NoImage detailed />
        )}
      </div>
    </div>
  );
}

// --- Timeline ----------------------------------------------------------------

const BASIS_STYLE: Record<Basis, { label: string; cls: string; help: string }> = {
  reported: {
    label: "reported",
    cls: "bg-emerald-500/10 text-emerald-300/90",
    help: "Stated directly by the AI engine in its telemetry.",
  },
  observed: {
    label: "observed",
    cls: "bg-sky-500/10 text-sky-300/90",
    help: "Derived by watching consecutive telemetry payloads — a fact about the stream.",
  },
  correlated: {
    label: "correlated",
    cls: "bg-amber-500/10 text-amber-300/90",
    help: "A camera-wide counter moved while this object was in frame. Attribution is inferred, not stated by the engine.",
  },
};

function TimelineTab({ event }: { event: AlertEvent }) {
  const rows = useMemo(() => [...event.timeline].sort((a, b) => a.ts - b.ts), [event.timeline]);

  return (
    <div className="p-5">
      {rows.length === 0 ? (
        <Empty>
          No lifecycle rows for this event. Scene alerts with no tracked subject have
          nothing to follow through the frame.
        </Empty>
      ) : (
        <>
          <ol className="relative space-y-3 border-l border-white/[0.08] pl-5">
            {rows.map((e, i) => (
              <TimelineRow key={`${e.ts}_${e.kind}_${i}`} entry={e} eventTs={event.ts} />
            ))}
          </ol>
          <div className="mt-5 flex flex-wrap gap-3 border-t border-white/[0.06] pt-3">
            {(Object.keys(BASIS_STYLE) as Basis[]).map((b) => (
              <div key={b} className="flex items-start gap-1.5 text-[10px] text-zinc-600">
                <span className={clsx("rounded px-1.5 py-0.5 font-medium", BASIS_STYLE[b].cls)}>
                  {BASIS_STYLE[b].label}
                </span>
                <span className="max-w-[240px] leading-relaxed">{BASIS_STYLE[b].help}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TimelineRow({ entry, eventTs }: { entry: TimelineEntry; eventTs: number }) {
  const style = BASIS_STYLE[entry.basis] ?? BASIS_STYLE.observed;
  const isAlertMoment = Math.abs(entry.ts - eventTs) < 900;
  return (
    <li className="relative">
      <span
        className={clsx(
          "absolute -left-[23px] top-1.5 h-1.5 w-1.5 rounded-full",
          isAlertMoment ? "bg-zinc-100 ring-2 ring-zinc-100/25" : "bg-zinc-600",
        )}
      />
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] tabular-nums text-zinc-600">{clockTime(entry.ts)}</span>
        <span className="text-[12px] font-medium text-zinc-200">{entry.label}</span>
        <span className={clsx("rounded px-1.5 py-0.5 text-[9px] font-medium", style.cls)}>
          {style.label}
        </span>
      </div>
      {entry.detail && <div className="mt-0.5 text-[10px] text-zinc-600">{entry.detail}</div>}
    </li>
  );
}

// --- AI Analysis -------------------------------------------------------------

function AnalysisTab({ event }: { event: AlertEvent }) {
  const conf = event.confidence;
  const speedMeasured = event.meta.speedStatus === "calibrated";

  return (
    <div className="space-y-4 p-5">
      <Section title="Classification">
        <Row label="Reported class" value={event.sourceKey} mono />
        <Row label="Mapped to" value={`${event.def.title} (${event.def.group})`} />
        <Row label="Severity" value={`${event.severity} — assigned by the alert catalogue, not the model`} />
        <Row label="Detector confidence" value={confidenceLabel(conf)} />
        <Row label="Inference device" value={event.meta.device ? event.meta.device.toUpperCase() : "not reported"} />
        <Row label="Pipeline rate" value={event.meta.fps != null ? `${event.meta.fps.toFixed(1)} fps` : "not reported"} />
      </Section>

      <Section title="Tracking">
        <Row label="Track ID" value={event.trackId != null ? `#${event.trackId}` : "not tracked"} mono />
        <Row label="Tracker state" value={event.meta.trackStatus ?? "not reported"} />
        <Row label="Time in view" value={durationLabel(event)} />
        <Row label="Direction" value={event.meta.direction ?? "not reported"} />
        <Row
          label="Crop lock"
          value={event.live
            ? "following the tracked object — crop re-cut each second"
            : "released (subject left frame or refresh window ended)"}
        />
      </Section>

      {(event.meta.speed != null || event.meta.plate) && (
        <Section title="Measurement provenance">
          {event.meta.speed != null && (
            <>
              <Row label="Speed" value={`${Math.round(event.meta.speed)} km/h`} />
              <Row
                label="Basis"
                value={speedMeasured
                  ? "Calibrated — measured across a two-line gate of known separation. Act on it."
                  : `${event.meta.speedStatus ?? "unknown"} — derived from the object's pixel height against a class-average real-world height. Indicative only, typically ±20–30%.`}
              />
            </>
          )}
          {event.meta.plate && (
            <>
              <Row label="Plate text" value={event.meta.plate} mono />
              <Row
                label="OCR confidence"
                value={event.meta.plateConfidence != null
                  ? `${(event.meta.plateConfidence * 100).toFixed(1)}% — the reading. Distinct from the ${confidenceLabel(conf)} score for the plate box.`
                  : "not reported"}
              />
            </>
          )}
        </Section>
      )}

      <Callout icon={<Info size={13} />}>
        Everything on this tab is either a value the engine sent or a label this
        client mapped it to. No score here is computed, smoothed or estimated by
        the interface — where a number is an estimate, the engine said so and it
        is printed as such.
      </Callout>
    </div>
  );
}

// --- Metadata ----------------------------------------------------------------

function MetadataTab({ event }: { event: AlertEvent }) {
  return (
    <div className="space-y-4 p-5">
      <Section title="Incident">
        <Row label="Event ID" value={event.id} mono />
        <Row label="Detected at" value={new Date(event.ts).toISOString()} mono small />
        <Row label="Acknowledged" value={event.acknowledged ? "yes" : "no"} />
      </Section>
      <Section title="Camera">
        <Row label="Name" value={event.cameraName} />
        <Row label="Site" value={event.siteName} />
        <Row label="Camera ID" value={event.cameraId} mono small />
      </Section>
      <Section title="Snapshot">
        <Row label="Kind" value={event.meta.cropKind === "detection" ? "Object crop" : "Scene (no single subject)"} />
        {event.meta.region && (
          <Row
            label="Source region"
            value={`${event.meta.region.w}×${event.meta.region.h} px @ ${event.meta.region.x},${event.meta.region.y}`}
            small
          />
        )}
        {event.meta.zoom != null && <Row label="Zoom" value={`${event.meta.zoom.toFixed(2)}×`} />}
        {event.meta.aspect != null && <Row label="Aspect" value={event.meta.aspect.toFixed(2)} />}
        <Row label="Live refreshes" value={String(event.refreshes)} />
        {event.bbox && (
          <Row
            label="Bounding box"
            value={`${event.bbox.x1.toFixed(4)}, ${event.bbox.y1.toFixed(4)} → ${event.bbox.x2.toFixed(4)}, ${event.bbox.y2.toFixed(4)}`}
            mono small
          />
        )}
      </Section>
      <Section title={`Objects in frame (${event.frameDetections.length})`}>
        <div className="overflow-hidden rounded-lg border border-white/[0.06]">
          <table className="w-full text-[11px]">
            <thead className="bg-white/[0.03] text-zinc-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Class</th>
                <th className="px-2 py-1.5 text-left font-medium">Track</th>
                <th className="px-2 py-1.5 text-right font-medium">Conf.</th>
                <th className="px-2 py-1.5 text-right font-medium">Box</th>
              </tr>
            </thead>
            <tbody>
              {(event.frameDetections as any[]).slice(0, 40).map((d, i) => (
                <tr key={i} className="border-t border-white/[0.04] text-zinc-400">
                  <td className="px-2 py-1">{d.class}</td>
                  <td className="px-2 py-1 font-mono text-zinc-600">
                    {d.track_id != null ? `#${d.track_id}` : "—"}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {Math.round((d.confidence ?? 0) * 100)}%
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[9px] text-zinc-600">
                    {d.bbox ? `${d.bbox.x1.toFixed(2)},${d.bbox.y1.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// --- Downloads ---------------------------------------------------------------

function DownloadsTab({
  event, captureMediaFor,
}: {
  event: AlertEvent;
  captureMediaFor: (cameraId: string) => ClipMedia | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [clipProgress, setClipProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [clipSeconds, setClipSeconds] = useState(8);

  const run = async (key: string, fn: () => Promise<unknown> | unknown, failMsg: string) => {
    setBusy(key);
    setNote(null);
    try {
      const ok = await fn();
      if (ok === false) setNote(failMsg);
    } catch {
      setNote(failMsg);
    } finally {
      setBusy(null);
    }
  };

  const media = captureMediaFor(event.cameraId);
  const clipOk = clipSupported();
  const mime = pickMimeType();

  const recordAndSave = async () => {
    if (!media) return;
    setClipProgress(0);
    try {
      const res = await recordClip(media, clipSeconds, setClipProgress);
      if (!res) { setNote("Clip recording failed — the stream may have dropped."); return; }
      triggerDownload(res.blob, `${stemFor(event)}_clip.${res.extension}`);
    } finally {
      setClipProgress(null);
    }
  };

  return (
    <div className="space-y-5 p-5">
      <Section title="Images">
        <div className="flex flex-wrap gap-2">
          <DlButton icon={<ImageIcon size={13} />} busy={busy === "jpg"} disabled={!event.cropUrl}
            onClick={() => run("jpg", () => exportJpeg(event, "crop"), "No crop to export.")}>
            Crop · JPEG
          </DlButton>
          <DlButton icon={<ImageIcon size={13} />} busy={busy === "png"} disabled={!event.cropUrl}
            onClick={() => run("png", () => exportPngFile(event, "crop"), "PNG conversion failed.")}>
            Crop · PNG
          </DlButton>
          <DlButton icon={<ImageIcon size={13} />} busy={busy === "fjpg"} disabled={!event.fullUrl}
            onClick={() => run("fjpg", () => exportJpeg(event, "full"), "No full frame to export.")}>
            Full frame · JPEG
          </DlButton>
          <DlButton icon={<ImageIcon size={13} />} busy={busy === "fpng"} disabled={!event.fullUrl}
            onClick={() => run("fpng", () => exportPngFile(event, "full"), "PNG conversion failed.")}>
            Full frame · PNG
          </DlButton>
        </div>
      </Section>

      <Section title="Documents">
        <div className="flex flex-wrap gap-2">
          <DlButton icon={<FileText size={13} />} busy={busy === "pdf"}
            onClick={() => run("pdf", () => exportPdf(event, event.timeline), "PDF generation failed.")}>
            PDF incident report
          </DlButton>
          <DlButton icon={<Table size={13} />} busy={busy === "csv"}
            onClick={() => run("csv", () => exportCsv(event, event.timeline), "CSV export failed.")}>
            CSV metadata
          </DlButton>
          <DlButton icon={<FileJson size={13} />} busy={busy === "json"}
            onClick={() => run("json", () => exportJson(event, event.timeline), "JSON export failed.")}>
            JSON metadata
          </DlButton>
          <DlButton icon={<FileDown size={13} />} busy={busy === "all"}
            onClick={() => run("all", () => exportBundle(event, event.timeline), "Bundle export failed.")}>
            Everything
          </DlButton>
        </div>
      </Section>

      <Section title="Video clip">
        {!clipOk ? (
          <Callout>
            This build of Chromium exposes no usable MediaRecorder codec, so clip
            capture is unavailable. Images and documents above are unaffected.
          </Callout>
        ) : !media ? (
          <Callout>
            Clip capture records the camera as it is playing, so the camera has to be
            on screen. Open this camera's tile or live feed, then come back.
          </Callout>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-zinc-500">Length</span>
              {[5, 8, 15, 30].map((s) => (
                <button
                  key={s}
                  onClick={() => setClipSeconds(s)}
                  disabled={clipProgress != null}
                  className={clsx(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition disabled:opacity-40",
                    clipSeconds === s ? "bg-white/[0.10] text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  {s}s
                </button>
              ))}
              <DlButton
                icon={<Film size={13} />}
                busy={clipProgress != null}
                onClick={recordAndSave}
              >
                {clipProgress != null
                  ? `Recording ${Math.round(clipProgress * clipSeconds)}/${clipSeconds}s`
                  : `Record ${clipSeconds}s clip`}
              </DlButton>
            </div>
            {clipProgress != null && (
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-zinc-300 transition-[width] duration-200"
                  style={{ width: `${clipProgress * 100}%` }}
                />
              </div>
            )}
            <p className="text-[10px] leading-relaxed text-zinc-600">
              Records forward from now as {mime?.startsWith("video/mp4") ? "MP4 (H.264)" : "WebM"} —
              whichever this Chromium can actually mux, so the file extension always matches
              the contents. This does <span className="text-zinc-400">not</span> include the
              seconds before the alert: buffering every camera continuously to make that
              possible would cost live frame rate on every camera, all the time, for a
              rarely-used export. Pre-event footage comes from the engine's own recorder
              (<span className="font-mono">GET /api/recordings</span>), which has already
              encoded it server-side at no cost to this view.
            </p>
          </div>
        )}
      </Section>

      {note && <Callout>{note}</Callout>}
    </div>
  );
}

function DlButton({
  icon, children, onClick, busy, disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-white/[0.03]"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// --- History + cross-camera --------------------------------------------------

/** Events on OTHER cameras this close in time are shown as possibly-related. */
const CORRELATION_WINDOW_MS = 90_000;

function HistoryTab({
  event, cameraHistory, allEvents, onSelectEvent,
}: {
  event: AlertEvent;
  cameraHistory: AlertEvent[];
  allEvents: AlertEvent[];
  onSelectEvent: (id: string) => void;
}) {
  // Same class, other cameras, near in time. Ordered by time so the sequence
  // reads as a path across the site.
  const correlated = useMemo(() => {
    return allEvents
      .filter((e) =>
        e.cameraId !== event.cameraId &&
        e.sourceKey === event.sourceKey &&
        Math.abs(e.ts - event.ts) <= CORRELATION_WINDOW_MS)
      .sort((a, b) => a.ts - b.ts);
  }, [allEvents, event]);

  const chain = useMemo(() => {
    const all = [...correlated, event].sort((a, b) => a.ts - b.ts);
    // Collapse consecutive events from the same camera into one hop.
    const hops: AlertEvent[] = [];
    for (const e of all) {
      if (!hops.length || hops[hops.length - 1].cameraId !== e.cameraId) hops.push(e);
    }
    return hops;
  }, [correlated, event]);

  return (
    <div className="space-y-5 p-5">
      <Section title={`Movement across cameras`}>
        {chain.length < 2 ? (
          <Empty>
            No {event.def.title.toLowerCase()} events on other cameras within
            {" "}{CORRELATION_WINDOW_MS / 1000}s of this one.
          </Empty>
        ) : (
          <>
            <ol className="space-y-1">
              {chain.map((e, i) => (
                <li key={e.id}>
                  <button
                    onClick={() => onSelectEvent(e.id)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
                      e.id === event.id
                        ? "border-white/[0.14] bg-white/[0.06]"
                        : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]",
                    )}
                  >
                    {e.cropUrl ? (
                      <img src={e.cropUrl} alt="" loading="lazy" decoding="async"
                        className="h-9 w-14 shrink-0 rounded object-cover" />
                    ) : (
                      <div className="flex h-9 w-14 shrink-0 items-center justify-center rounded bg-black/40 text-zinc-700">
                        <ImageOff size={12} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-zinc-200">{e.cameraName}</div>
                      <div className="text-[10px] text-zinc-600">
                        {clockTime(e.ts)}
                        {i > 0 && ` · +${Math.round((e.ts - chain[i - 1].ts) / 1000)}s`}
                      </div>
                    </div>
                    {e.id === event.id && (
                      <span className="shrink-0 text-[9px] uppercase tracking-wider text-zinc-500">this event</span>
                    )}
                  </button>
                  {i < chain.length - 1 && (
                    <div className="flex justify-center py-0.5 text-zinc-700">
                      <ArrowDown size={12} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <Callout icon={<Info size={13} />}>
              <span className="font-medium text-zinc-300">This is temporal correlation, not
              re-identification.</span>{" "}
              Each camera runs its own tracker, so track&nbsp;#{event.trackId ?? "n"} on one camera
              and the same number on another are unrelated identifiers — the engine has no
              cross-camera appearance model, and this client will not invent one. What is shown
              is: the same event type occurred on these cameras, in this order, this far apart.
              Whether it was one subject moving is the operator's call.
            </Callout>
          </>
        )}
      </Section>

      <Section title={`Earlier on ${event.cameraName}`}>
        {cameraHistory.length <= 1 ? (
          <Empty>No other events from this camera yet.</Empty>
        ) : (
          <ol className="space-y-1">
            {cameraHistory.slice(0, 30).map((e) => {
              const t = SEVERITY_THEME[e.severity];
              const current = e.id === event.id;
              const EIcon = e.def.icon;
              return (
                <li key={e.id}>
                  <button
                    onClick={() => onSelectEvent(e.id)}
                    className={clsx(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition",
                      current ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.accent }} />
                    <EIcon size={12} className="shrink-0 text-zinc-500" />
                    <span className="truncate text-[12px] text-zinc-300">{e.def.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">
                      {clockTime(e.ts)}
                    </span>
                    {e.acknowledged && <Check size={11} className="shrink-0 text-ok" />}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}

// --- shared bits -------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label, value, mono, small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-[132px] shrink-0 text-[11px] text-zinc-600">{label}</span>
      <span
        className={clsx(
          "min-w-0 flex-1 break-words leading-relaxed text-zinc-300",
          mono && "font-mono",
          small ? "text-[10px]" : "text-[11px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/30 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-0.5 truncate text-[12px] font-medium text-zinc-200">{value}</div>
    </div>
  );
}

function Callout({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-zinc-500">
      {icon && <span className="mt-0.5 shrink-0 text-zinc-600">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-[11px] leading-relaxed text-zinc-600">{children}</div>;
}

function NoImage({ detailed }: { detailed?: boolean }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-600">
      <ImageOff size={detailed ? 26 : 18} />
      <span className="text-xs">No image was captured for this event.</span>
      {detailed && (
        <span className="max-w-sm text-center text-[11px] leading-relaxed text-zinc-700">
          The alert is real — it came from the engine's telemetry — but the live frame
          could not be read at the moment it fired (the tile was covered, or the stream
          had just dropped).
        </span>
      )}
    </div>
  );
}
