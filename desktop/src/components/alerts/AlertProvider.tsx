import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { createPortal } from "react-dom";
import { Bell, Sparkles } from "lucide-react";
import clsx from "clsx";
import { AlertEngine, type AlertEvent, type CameraContext } from "../../lib/alertEngine";
import { SEVERITY_RANK, SEVERITY_THEME, type Severity } from "../../lib/alertCatalog";
import type { CameraTelemetry } from "../../lib/telemetry";
import type { CaptureMedia } from "../../lib/smartCrop";
import { criticalChime, primeAudio } from "../../lib/alertSound";
import AlertCard from "./AlertCard";
import IncidentWindow from "./IncidentWindow";
import NotificationCenter from "./NotificationCenter";
import { UNKNOWN_CAMERA_STATUS, type CameraLiveStatus } from "./alertUtils";

/**
 * Owns the whole live-alert surface: derivation, the floating stack, the
 * notification center and the incident window.
 *
 * WHY TWO CONTEXTS. Camera tiles need exactly one thing from this provider — a
 * function to push telemetry into. If they subscribed to the same context that
 * carries the event list, every tile in the grid would re-render on every alert,
 * which is a full React pass over N live video tiles several times a minute.
 * The ingest context's value is created once and never changes; the state lives
 * in the component itself and only the alert UI reads it.
 */

export type IngestFn = (cam: CameraContext, t: CameraTelemetry, media: CaptureMedia | null) => void;

const IngestContext = createContext<IngestFn>(() => {});

/** Stable across the life of the app — safe to call from a WS message handler. */
export function useAlertIngest(): IngestFn {
  return useContext(IngestContext);
}

/** Events kept in memory with their object URLs. Older ones stay in the
 *  IndexedDB vault; holding blob URLs for thousands of events would pin their
 *  blobs in memory for the life of the process. */
const MEMORY_LIMIT = 80;
/** The spec's five. Anything beyond it is not lost — it is in the center. */
const MAX_VISIBLE = 5;
/** No telemetry for this long and the camera is not "live" any more. */
const CAMERA_STALE_MS = 6000;

const SETTINGS_KEY = "camai.alerts.settings";

interface Settings {
  floor: Severity;
  muted: boolean;
  sound: boolean;
  demo: boolean;
}

function loadSettings(): Settings {
  const fallback: Settings = { floor: "low", muted: false, sound: true, demo: false };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return {
      floor: (["low", "medium", "high", "critical"] as Severity[]).includes(p.floor) ? p.floor : "low",
      muted: !!p.muted,
      sound: p.sound !== false,
      demo: !!p.demo,
    };
  } catch {
    return fallback; // private mode
  }
}

export default function AlertProvider({
  children,
  onOpenLiveFeed,
  renderUI = true,
}: {
  children: React.ReactNode;
  /** Opens the camera full-window. Provided by whoever owns that state. */
  onOpenLiveFeed?: (cameraId: string) => void;
  /** Whether to render the floating stack / bell / notification center /
   *  incident window. Ingestion (and therefore alert generation) keeps
   *  running either way — this only controls the visible surface, so
   *  whoever mounts this provider decides where alerts are SEEN without
   *  ever stopping them from being derived from live telemetry. Alerts are
   *  a Full-Admin/Admin-Studio concern; the live camera Workspace still has
   *  to feed telemetry into this provider (that's where the camera tiles
   *  and their ingest calls live), it just doesn't render the UI itself. */
  renderUI?: boolean;
}) {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [stackIds, setStackIds] = useState<string[]>([]);
  const [centerOpen, setCenterOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [suppressed, setSuppressed] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [snapshotsAvailable, setSnapshotsAvailable] = useState(true);
  const [glowKey, setGlowKey] = useState(0);

  // Read inside engine callbacks, which are created once and must not close
  // over a stale threshold.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Same reason: the critical chime/glow are part of the visible surface
  // too (an audible cue is still "showing" an alert), so they must not fire
  // while this provider is only ingesting for a screen that isn't rendering
  // its UI (see renderUI).
  const renderUIRef = useRef(renderUI);
  renderUIRef.current = renderUI;

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);

  /**
   * Per-camera liveness and the element each camera is being watched through.
   *
   * Both are written on every telemetry payload — several times a second, per
   * camera — so they live in a ref, NOT in state. Putting them in state would
   * re-render the entire alert surface at telemetry rate, which is precisely
   * the cost this provider is structured to avoid. The cards read them at their
   * own render time, and they already re-render once a second for the age
   * label, so the status they show is never more than a second stale.
   */
  const cameraSeenRef = useRef(
    new Map<string, { at: number; fps: number | null; media: CaptureMedia | null }>(),
  );

  const cameraStatusFor = useCallback((cameraId: string): CameraLiveStatus => {
    const seen = cameraSeenRef.current.get(cameraId);
    if (!seen) return UNKNOWN_CAMERA_STATUS;
    const ageMs = Date.now() - seen.at;
    return { live: ageMs < CAMERA_STALE_MS, ageMs, fps: seen.fps };
  }, []);

  /**
   * The element a camera is being watched through, for clip capture.
   *
   * Returns null once the camera has gone quiet, and the entry is swept
   * entirely soon after. Holding an <img> from a tile that has since unmounted
   * keeps a detached DOM node — and its decoded frame buffer — alive for the
   * life of the process, which on a wall display is a leak that grows every
   * time the operator changes layout.
   */
  const captureMediaFor = useCallback((cameraId: string): CaptureMedia | null => {
    const seen = cameraSeenRef.current.get(cameraId);
    if (!seen || Date.now() - seen.at > CAMERA_STALE_MS) return null;
    return seen.media;
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - 60_000;
      for (const [camId, seen] of cameraSeenRef.current) {
        if (seen.at < cutoff) cameraSeenRef.current.delete(camId);
      }
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Evicted events' object URLs must be released or their blobs live forever.
  const revoke = useCallback((e: AlertEvent) => {
    if (e.cropUrl) URL.revokeObjectURL(e.cropUrl);
    if (e.fullUrl) URL.revokeObjectURL(e.fullUrl);
  }, []);

  /**
   * NOTE ON STRICTMODE. Several updaters below perform side effects — revoking
   * object URLs and telling the engine to stop refreshing an evicted event.
   * StrictMode double-invokes updaters in development, so those run twice. Both
   * are idempotent by construction: revokeObjectURL on an already-revoked URL
   * is a no-op per spec, and endLive is a Map.delete guarded on its own return
   * value. Doing this work in an effect instead would mean diffing the previous
   * event list on every render to discover what was evicted, which is more code
   * and more work per alert to buy purity we do not need here.
   */
  const engineRef = useRef<AlertEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new AlertEngine({
      onEvent: (e) => {
        setEvents((prev) => {
          const next = [e, ...prev];
          if (next.length > MEMORY_LIMIT) {
            for (const dead of next.splice(MEMORY_LIMIT)) {
              engineRef.current?.endLive(dead.id);
              revoke(dead);
            }
          }
          return next;
        });
        const { floor, muted, sound } = settingsRef.current;
        if (renderUIRef.current && !muted && SEVERITY_RANK[e.severity] >= SEVERITY_RANK[floor]) {
          setStackIds((prev) => [e.id, ...prev].slice(0, MAX_VISIBLE));
          if (e.severity === "critical") {
            setGlowKey((k) => k + 1);
            if (sound) criticalChime();
          }
        }
      },

      onCapture: (id, cropUrl, fullUrl, aspect) => {
        setEvents((prev) => {
          const idx = prev.findIndex((e) => e.id === id);
          if (idx === -1) {
            // Evicted before its capture landed — release immediately rather
            // than leaking the blob.
            URL.revokeObjectURL(cropUrl);
            URL.revokeObjectURL(fullUrl);
            return prev;
          }
          const next = prev.slice();
          const old = prev[idx];
          // A refresh may have already installed a newer crop while the initial
          // capture was still encoding. Keep the newer one and drop this.
          if (old.cropUrl) {
            URL.revokeObjectURL(cropUrl);
            if (old.fullUrl) URL.revokeObjectURL(fullUrl);
            next[idx] = { ...old, fullUrl: old.fullUrl ?? fullUrl };
            return next;
          }
          next[idx] = { ...old, cropUrl, fullUrl, meta: { ...old.meta, aspect } };
          return next;
        });
      },

      onCropRefresh: (id, cropUrl, aspect, refreshes) => {
        setEvents((prev) => {
          const idx = prev.findIndex((e) => e.id === id);
          if (idx === -1) {
            URL.revokeObjectURL(cropUrl);
            return prev;
          }
          const old = prev[idx];
          const next = prev.slice();
          next[idx] = { ...old, cropUrl, refreshes, meta: { ...old.meta, aspect, refreshes } };
          // Release the crop we just replaced. Deferred one frame so the <img>
          // swap has committed — revoking a URL still assigned to a live
          // element paints a broken image for a frame in Chromium.
          if (old.cropUrl) {
            const dead = old.cropUrl;
            setTimeout(() => URL.revokeObjectURL(dead), 1000);
          }
          return next;
        });
      },

      onLiveEnded: (id) => {
        setEvents((prev) => {
          const idx = prev.findIndex((e) => e.id === id);
          if (idx === -1 || !prev[idx].live) return prev;
          const next = prev.slice();
          next[idx] = { ...prev[idx], live: false };
          return next;
        });
      },

      onTimeline: (id, timeline) => {
        setEvents((prev) => {
          const idx = prev.findIndex((e) => e.id === id);
          // Reference equality is enough: the ledger mutates the same array in
          // place and only hands over a new one when rows were actually added.
          if (idx === -1 || prev[idx].timeline.length === timeline.length) return prev;
          const next = prev.slice();
          next[idx] = { ...prev[idx], timeline: [...timeline] };
          return next;
        });
      },

      onSuppressed: () => {
        setSuppressed((n) => n + 1);
        setSnapshotsAvailable(engineRef.current?.snapshotsAvailable ?? true);
      },
    });
  }

  // The engine flips this off permanently the first time it proves the canvas
  // is tainted; the cards then say "no snapshot" instead of spinning.
  useEffect(() => {
    const id = setInterval(() => {
      const ok = engineRef.current?.snapshotsAvailable ?? true;
      setSnapshotsAvailable((prev) => (prev === ok ? prev : ok));
      // Also age out live crops here, so a total telemetry outage still clears
      // the "Live" badges instead of freezing them on screen.
      engineRef.current?.sweep();
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Only cards actually on screen get live crop refreshes. The incident window
  // counts as on-screen: it is showing the crop at a larger size than the card.
  useEffect(() => {
    const visible = new Set(stackIds);
    if (detailId) visible.add(detailId);
    engineRef.current?.setVisible(visible);
  }, [stackIds, detailId]);

  // Release every outstanding object URL on unmount. This has to go through a
  // ref: an empty-dep cleanup closes over `events` as it was on the FIRST
  // render — the empty array — and would free nothing at all.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  useEffect(() => {
    return () => { eventsRef.current.forEach(revoke); };
  }, [revoke]);

  // Audio cannot start until the user has interacted with the page; priming on
  // the first click means the first real critical is audible.
  useEffect(() => {
    const prime = () => primeAudio();
    window.addEventListener("pointerdown", prime, { once: true });
    return () => window.removeEventListener("pointerdown", prime);
  }, []);

  const ingest = useCallback<IngestFn>((cam, t, media) => {
    cameraSeenRef.current.set(cam.id, { at: Date.now(), fps: t.fps ?? null, media });
    engineRef.current?.ingest(cam, t, media);
  }, []);

  const acknowledge = useCallback((id: string) => {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, acknowledged: true } : e)));
    // Mirror into the vault so an acknowledged incident stays acknowledged
    // across a restart. Fire-and-forget: nothing in the UI waits on disk.
    void import("../../lib/evidenceStore").then(({ updateEvidence }) =>
      updateEvidence(id, { acknowledgedAt: Date.now() }),
    );
    setStackIds((prev) => prev.filter((s) => s !== id));
  }, []);

  const dismiss = useCallback((id: string) => {
    setStackIds((prev) => prev.filter((s) => s !== id));
  }, []);

  const openLive = useCallback((cameraId: string) => {
    onOpenLiveFeed?.(cameraId);
    setCenterOpen(false);
  }, [onOpenLiveFeed]);

  const acknowledgeAll = useCallback(() => {
    setEvents((prev) => prev.map((e) => (e.acknowledged ? e : { ...e, acknowledged: true })));
    setStackIds([]);
  }, []);

  const clearList = useCallback(() => {
    setEvents((prev) => {
      for (const e of prev) {
        engineRef.current?.endLive(e.id);
        revoke(e);
      }
      return [];
    });
    setStackIds([]);
    setDetailId(null);
  }, [revoke]);

  const stack = useMemo(
    () => stackIds.map((id) => events.find((e) => e.id === id)).filter(Boolean) as AlertEvent[],
    [stackIds, events],
  );
  const detail = useMemo(
    () => (detailId ? events.find((e) => e.id === detailId) ?? null : null),
    [detailId, events],
  );
  const unacked = useMemo(() => events.filter((e) => !e.acknowledged).length, [events]);
  const worstUnacked = useMemo<Severity | null>(() => {
    let worst: Severity | null = null;
    for (const e of events) {
      if (e.acknowledged) continue;
      if (!worst || SEVERITY_RANK[e.severity] > SEVERITY_RANK[worst]) worst = e.severity;
    }
    return worst;
  }, [events]);

  return (
    <IngestContext.Provider value={ingest}>
      {children}
      {renderUI && <>

      {/* Screen-edge glow: one shot per critical, keyed so a second critical
          restarts it rather than being swallowed by the running animation. */}
      {glowKey > 0 && createPortal(
        <div key={glowKey} className="camai-edge-glow" aria-hidden />,
        document.body,
      )}

      {createPortal(
        <div
          className={clsx(
            "camai-alert-stack pointer-events-none fixed right-4 top-4 z-[120] flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2",
            settings.demo ? "camai-demo w-[400px]" : "w-[358px]",
          )}
        >
          <StackHeader
            count={events.length}
            unacked={unacked}
            worst={worstUnacked}
            muted={settings.muted}
            demo={settings.demo}
            hidden={events.length === 0}
            onOpen={() => setCenterOpen(true)}
          />
          {stack.map((e) => (
            <AlertCard
              key={e.id}
              event={e}
              snapshotsAvailable={snapshotsAvailable}
              cameraStatusFor={cameraStatusFor}
              demoMode={settings.demo}
              onAcknowledge={acknowledge}
              onDismiss={dismiss}
              onOpenLive={openLive}
              onOpenDetail={setDetailId}
            />
          ))}
          {events.length > stack.length && (
            <button
              onClick={() => setCenterOpen(true)}
              className="pointer-events-auto rounded-full border border-white/[0.07] bg-black/60 px-3 py-1.5 text-[10px] font-medium text-zinc-400 backdrop-blur-xl transition hover:text-zinc-100"
            >
              {events.length - stack.length} more in Notification Center
            </button>
          )}
        </div>,
        document.body,
      )}

      {centerOpen && (
        <NotificationCenter
          events={events}
          suppressed={suppressed}
          floor={settings.floor}
          onFloorChange={(floor) => setSettings((s) => ({ ...s, floor }))}
          muted={settings.muted}
          onMutedChange={(muted) => setSettings((s) => ({ ...s, muted }))}
          sound={settings.sound}
          onSoundChange={(sound) => { setSettings((s) => ({ ...s, sound })); if (sound) primeAudio(); }}
          demo={settings.demo}
          onDemoChange={(demo) => setSettings((s) => ({ ...s, demo }))}
          onOpenDetail={(id) => { setDetailId(id); setCenterOpen(false); }}
          onAcknowledgeAll={acknowledgeAll}
          onClear={clearList}
          onClose={() => setCenterOpen(false)}
        />
      )}

      {detail && (
        <IncidentWindow
          event={detail}
          allEvents={events}
          captureMediaFor={captureMediaFor}
          onClose={() => setDetailId(null)}
          onAcknowledge={acknowledge}
          onOpenLive={openLive}
          onSelectEvent={setDetailId}
        />
      )}
      </>}
    </IngestContext.Provider>
  );
}

/** The always-available way back to everything — including when the stack is
 *  empty because five cards timed out while the operator was looking away. */
function StackHeader({
  count, unacked, worst, muted, demo, hidden, onOpen,
}: {
  count: number;
  unacked: number;
  worst: Severity | null;
  muted: boolean;
  demo: boolean;
  hidden: boolean;
  onOpen: () => void;
}) {
  if (hidden) return null;
  const theme = worst ? SEVERITY_THEME[worst] : null;
  return (
    <button
      onClick={onOpen}
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/[0.07] bg-black/55 px-3 py-1.5 text-[11px] font-medium text-zinc-300 shadow-lg backdrop-blur-xl transition hover:bg-black/75 hover:text-white"
    >
      <span className="relative flex items-center">
        <Bell size={12} className={clsx(muted && "text-zinc-600")} />
        {unacked > 0 && theme && (
          <span
            className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full"
            style={{ background: theme.accent, boxShadow: `0 0 6px ${theme.accent}` }}
          />
        )}
      </span>
      {unacked > 0 ? `${unacked} unacknowledged` : `${count} events`}
      {muted && <span className="text-zinc-600">· paused</span>}
      {demo && (
        <span className="flex items-center gap-1 text-zinc-500">
          <Sparkles size={10} /> demo
        </span>
      )}
    </button>
  );
}
