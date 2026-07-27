import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, CheckCheck, Trash2, ImageOff, BellOff, Volume2, VolumeX, Sparkles } from "lucide-react";
import clsx from "clsx";
import type { AlertEvent } from "../../lib/alertEngine";
import { SEVERITY_THEME, SEVERITY_RANK, type Severity } from "../../lib/alertCatalog";
import { formatAge, clockTime, confidenceLabel } from "./alertUtils";

/**
 * Where alerts go once they stop floating.
 *
 * The stack holds five. Everything else — dismissed, aged out, or below the pop
 * threshold — lives here, in order, with its snapshot. Nothing is thrown away
 * silently: an alert that never got a card is still in this list, and the
 * suppressed counter at the top says how many were dropped by flood control
 * rather than pretending the quiet period was quiet.
 */

/** Fixed row height, in px, including the gap beneath it. The list is
 *  virtualized and windowing needs a known row height; every row here is the
 *  same shape by construction, so this is exact rather than estimated. */
const ROW_H = 62;
/** Rows rendered above and below the viewport so a fast scroll never shows a
 *  blank band before React catches up. */
const OVERSCAN = 4;
/** Below this many rows, windowing costs more than it saves. */
const VIRTUALIZE_ABOVE = 40;

export default function NotificationCenter({
  events,
  suppressed,
  floor,
  onFloorChange,
  muted,
  onMutedChange,
  sound,
  onSoundChange,
  demo,
  onDemoChange,
  onOpenDetail,
  onAcknowledgeAll,
  onClear,
  onClose,
}: {
  events: AlertEvent[];
  suppressed: number;
  floor: Severity;
  onFloorChange: (s: Severity) => void;
  muted: boolean;
  onMutedChange: (v: boolean) => void;
  sound: boolean;
  onSoundChange: (v: boolean) => void;
  demo: boolean;
  onDemoChange: (v: boolean) => void;
  onOpenDetail: (id: string) => void;
  onAcknowledgeAll: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"all" | "unacked">("all");
  const list = useMemo(
    () => (tab === "unacked" ? events.filter((e) => !e.acknowledged) : events),
    [events, tab],
  );
  const unackedCount = useMemo(() => events.filter((e) => !e.acknowledged).length, [events]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[130] flex justify-end" onClick={onClose}>
      <div className="camai-alert-fade absolute inset-0 bg-black/45 backdrop-blur-[2px]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Notification Center"
        className="camai-drawer-in relative flex h-full w-[404px] flex-col border-l border-white/[0.07] shadow-[-30px_0_60px_-20px_rgba(0,0,0,0.8)]"
        style={{ background: "linear-gradient(180deg, rgba(18,21,27,0.97) 0%, rgba(11,14,18,0.99) 100%)" }}
      >
        <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Notification Center</h2>
            <p className="text-[10px] text-zinc-500">
              {events.length} event{events.length === 1 ? "" : "s"} on this node
              {suppressed > 0 && ` · ${suppressed} suppressed by flood control`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close notification center"
            className="ml-auto rounded-lg p-2 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
          <Tab active={tab === "all"} onClick={() => setTab("all")}>All</Tab>
          <Tab active={tab === "unacked"} onClick={() => setTab("unacked")}>
            Unacknowledged
            {unackedCount > 0 && <span className="ml-1 text-[9px] text-zinc-500">{unackedCount}</span>}
          </Tab>
          <div className="ml-auto flex items-center gap-1">
            <IconBtn onClick={onAcknowledgeAll} label="Acknowledge all"><CheckCheck size={14} /></IconBtn>
            <IconBtn onClick={onClear} label="Clear this list (the evidence vault keeps every event)">
              <Trash2 size={14} />
            </IconBtn>
          </div>
        </div>

        {/* Pop threshold. Not a mute for the system — everything below the
            threshold still lands in this list and in the vault; it just stops
            taking over the corner of the screen. */}
        <div className="space-y-2 border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-600">
              Pop cards for
            </span>
            <div className="flex items-center gap-1">
              <Toggle on={!muted} onClick={() => onMutedChange(!muted)} onIcon={<BellOff size={10} />}>
                {muted ? "Cards paused" : "Pause cards"}
              </Toggle>
              <Toggle
                on={sound}
                onClick={() => onSoundChange(!sound)}
                onIcon={sound ? <Volume2 size={10} /> : <VolumeX size={10} />}
              >
                {sound ? "Sound on" : "Sound off"}
              </Toggle>
            </div>
          </div>
          <div className="flex rounded-lg bg-black/40 p-0.5">
            {(["low", "medium", "high", "critical"] as Severity[]).map((s) => (
              <button
                key={s}
                onClick={() => onFloorChange(s)}
                className={clsx(
                  "flex-1 rounded-[7px] px-2 py-1 text-[10px] font-medium capitalize transition",
                  floor === s ? "bg-white/[0.10] text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                {s === "low" ? "All" : `${s}+`}
              </button>
            ))}
          </div>

          {/* Demo mode. Presentation only — see the note in index.css. */}
          <button
            onClick={() => onDemoChange(!demo)}
            className={clsx(
              "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition",
              demo
                ? "border-white/[0.14] bg-white/[0.06]"
                : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04]",
            )}
          >
            <Sparkles size={12} className={demo ? "text-zinc-200" : "text-zinc-600"} />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-zinc-200">Demo presentation</div>
              <div className="text-[9px] leading-relaxed text-zinc-600">
                Larger cards, slower motion, longer dwell. Shows the same real detections —
                it never generates an event.
              </div>
            </div>
            <span
              className={clsx(
                "h-4 w-7 shrink-0 rounded-full p-0.5 transition",
                demo ? "bg-zinc-300" : "bg-white/10",
              )}
            >
              <span
                className={clsx(
                  "block h-3 w-3 rounded-full bg-zinc-900 transition-transform",
                  demo && "translate-x-3",
                )}
              />
            </span>
          </button>
        </div>

        <EventList list={list} onOpenDetail={onOpenDetail} />

        <footer className="border-t border-white/[0.06] px-4 py-2.5 text-[10px] leading-relaxed text-zinc-600">
          This list holds the most recent events in memory. Every event, including
          the ones cleared from here, is auto-saved with its snapshot to the local
          evidence vault.
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * The event list, windowed.
 *
 * A control room node that has been up for a shift can hold the full in-memory
 * cap here. Rendering eighty rows — each with a decoded <img> — inside a
 * scroll container next to live video is a measurable frame-rate cost for rows
 * nobody is looking at. Only what fits on screen is mounted; the rest is spacer
 * height, so the scrollbar still behaves exactly as if all of it were there.
 */
function EventList({
  list, onOpenDetail,
}: {
  list: AlertEvent[];
  onOpenDetail: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Scroll fires at input rate; rAF-coalescing keeps it to one state write per
  // painted frame instead of one per event.
  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScrollTop(ref.current?.scrollTop ?? 0);
    });
  }, []);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const virtual = list.length > VIRTUALIZE_ABOVE;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const end = virtual
    ? Math.min(list.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN)
    : list.length;
  const slice = list.slice(start, end);

  if (list.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col items-center gap-2 py-16 text-zinc-600">
          <span className="text-xs">Nothing here yet.</span>
          <span className="max-w-[240px] text-center text-[11px] leading-relaxed text-zinc-700">
            Events appear the moment a camera you are watching reports one.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div style={{ height: list.length * ROW_H, position: "relative" }}>
        {slice.map((e, i) => (
          <div
            key={e.id}
            style={{
              position: "absolute",
              top: (start + i) * ROW_H,
              left: 0,
              right: 0,
              height: ROW_H - 6,
            }}
          >
            <EventRow event={e} onOpen={onOpenDetail} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EventRow({ event: e, onOpen }: { event: AlertEvent; onOpen: (id: string) => void }) {
  const theme = SEVERITY_THEME[e.severity];
  const Icon = e.def.icon;
  return (
    <button
      onClick={() => onOpen(e.id)}
      className="flex h-full w-full items-center gap-2.5 rounded-xl border border-white/[0.05] bg-white/[0.02] p-2 text-left transition hover:border-white/[0.10] hover:bg-white/[0.05]"
    >
      <div className="relative h-[42px] w-[74px] shrink-0 overflow-hidden rounded-lg bg-black/50">
        {e.cropUrl ? (
          <img src={e.cropUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-700">
            <ImageOff size={13} />
          </div>
        )}
        <span className="absolute inset-y-0 left-0 w-[2px]" style={{ background: theme.accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Icon size={11} style={{ color: theme.accent }} className="shrink-0" />
          <span className="truncate text-[12px] font-medium text-zinc-200">{e.def.title}</span>
          {e.live && <span className="camai-live-dot h-1 w-1 shrink-0 rounded-full bg-red-400" />}
          {!e.acknowledged && (
            <span
              className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: theme.accent }}
            />
          )}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-zinc-500">
          {e.cameraName} · {confidenceLabel(e.confidence)}
        </div>
        <div className="text-[10px] text-zinc-600">
          {formatAge(e.ts)} · {clockTime(e.ts)}
        </div>
      </div>
    </button>
  );
}

function Tab({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "rounded-lg px-2.5 py-1 text-[11px] font-medium transition",
        active ? "bg-white/[0.08] text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

function IconBtn({
  onClick, label, children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded-md p-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
    >
      {children}
    </button>
  );
}

function Toggle({
  on, onClick, onIcon, children,
}: {
  on: boolean;
  onClick: () => void;
  onIcon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition",
        on ? "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200" : "bg-warn/15 text-warn",
      )}
    >
      {onIcon} {children}
    </button>
  );
}

export function severityFloorRank(s: Severity): number {
  return SEVERITY_RANK[s];
}
