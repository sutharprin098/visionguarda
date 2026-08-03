import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import { AlertEngine, type AlertEvent, type CameraContext } from "../../lib/alertEngine";
import { SEVERITY_RANK, type Severity } from "../../lib/alertCatalog";
import type { CameraTelemetry } from "../../lib/telemetry";
import type { CaptureMedia } from "../../lib/smartCrop";
import { criticalChime, primeAudio } from "../../lib/alertSound";
import { deleteEvidence, updateEvidence } from "../../lib/evidenceStore";
import { UNKNOWN_CAMERA_STATUS, type CameraLiveStatus } from "./alertUtils";

/**
 * Owns the whole live-alert surface: derivation, ingestion and the shared
 * state every consumer of alerts reads from.
 *
 * WHY TWO CONTEXTS. Camera tiles need exactly one thing from this provider — a
 * function to push telemetry into. If they subscribed to the same context that
 * carries the event list, every tile in the grid would re-render on every alert,
 * which is a full React pass over N live video tiles several times a minute.
 * The ingest context's value is created once and never changes; the state lives
 * in the component itself and only the Alerts page reads it.
 *
 * THIS PROVIDER RENDERS NOTHING. There used to be a floating card stack, a
 * screen-edge glow and a notification-center drawer mounted here via
 * createPortal, shown over whichever screen happened to be active. Alerts are
 * a single-destination concern now — the Alerts page (see AlertsPage.tsx) is
 * the only place any of this is ever drawn. Ingestion and event derivation run
 * exactly as before; nothing here decides what gets SHOWN, only what gets fed
 * into the store the Alerts page reads.
 */

export type IngestFn = (cam: CameraContext, t: CameraTelemetry, media: CaptureMedia | null) => void;

const IngestContext = createContext<IngestFn>(() => {});

/** Stable across the life of the app — safe to call from a WS message handler. */
export function useAlertIngest(): IngestFn {
  return useContext(IngestContext);
}

/** Events kept in memory with their object URLs. Older ones stay in the
 *  IndexedDB vault; holding blob URLs for thousands of events would pin their
 *  blobs in memory for the life of the process. The Alerts page pages further
 *  history in from the vault on demand (see AlertsPage's "load more"). */
const MEMORY_LIMIT = 300;
/** No telemetry for this long and the camera is not "live" any more. */
const CAMERA_STALE_MS = 6000;

const SETTINGS_KEY = "camai.alerts.settings";

interface Settings {
  sound: boolean;
}

function loadSettings(): Settings {
  const fallback: Settings = { sound: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    return { sound: p.sound !== false };
  } catch {
    return fallback; // private mode
  }
}

export interface AlertState {
  events: AlertEvent[];
  unacked: number;
  worstUnacked: Severity | null;
  suppressed: number;
  snapshotsAvailable: boolean;
  sound: boolean;
  setSound: (v: boolean) => void;
  cameraStatusFor: (cameraId: string) => CameraLiveStatus;
  captureMediaFor: (cameraId: string) => CaptureMedia | null;
  acknowledge: (id: string) => void;
  acknowledgeMany: (ids: string[]) => void;
  acknowledgeAll: () => void;
  deleteEvent: (id: string) => void;
  deleteEvents: (ids: string[]) => void;
  openLive: (cameraId: string) => void;
  /** Tells the engine which events are actually on screen right now, so only
   *  those keep getting live crop refreshes. Call with the current
   *  virtualization window (plus the open detail id, if any). */
  setVisibleIds: (ids: Iterable<string>) => void;
}

const AlertStateContext = createContext<AlertState | null>(null);

export function useAlertState(): AlertState {
  const ctx = useContext(AlertStateContext);
  if (!ctx) throw new Error("useAlertState() must be used within AlertProvider");
  return ctx;
}

export default function AlertProvider({
  children,
  onOpenLiveFeed,
}: {
  children: React.ReactNode;
  /** Opens the camera full-window. Provided by whoever owns that state. */
  onOpenLiveFeed?: (cameraId: string) => void;
}) {
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [suppressed, setSuppressed] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [snapshotsAvailable, setSnapshotsAvailable] = useState(true);

  // Read inside engine callbacks, which are created once and must not close
  // over a stale value.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }, [settings]);

  /**
   * Per-camera liveness and the element each camera is being watched through.
   *
   * Both are written on every telemetry payload — several times a second, per
   * camera — so they live in a ref, NOT in state. Putting them in state would
   * re-render the entire alert surface at telemetry rate, which is precisely
   * the cost this provider is structured to avoid. Consumers that show an age
   * label already re-render once a second on their own, so the status they
   * show is never more than a second stale.
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
        if (e.severity === "critical" && settingsRef.current.sound) criticalChime();
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
  // is tainted; consumers then say "no snapshot" instead of spinning.
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

  const setVisibleIds = useCallback((ids: Iterable<string>) => {
    engineRef.current?.setVisible(ids);
  }, []);

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
    void updateEvidence(id, { acknowledgedAt: Date.now() });
  }, []);

  const acknowledgeMany = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setEvents((prev) => prev.map((e) => (set.has(e.id) ? { ...e, acknowledged: true } : e)));
    const now = Date.now();
    for (const id of ids) void updateEvidence(id, { acknowledgedAt: now });
  }, []);

  const acknowledgeAll = useCallback(() => {
    setEvents((prev) => {
      const now = Date.now();
      for (const e of prev) if (!e.acknowledged) void updateEvidence(e.id, { acknowledgedAt: now });
      return prev.map((e) => (e.acknowledged ? e : { ...e, acknowledged: true }));
    });
  }, []);

  const deleteEvent = useCallback((id: string) => {
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      if (idx === -1) return prev;
      engineRef.current?.endLive(id);
      revoke(prev[idx]);
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
    void deleteEvidence(id);
  }, [revoke]);

  const deleteEvents = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setEvents((prev) => {
      const next: AlertEvent[] = [];
      for (const e of prev) {
        if (set.has(e.id)) {
          engineRef.current?.endLive(e.id);
          revoke(e);
        } else {
          next.push(e);
        }
      }
      return next;
    });
    for (const id of ids) void deleteEvidence(id);
  }, [revoke]);

  const openLive = useCallback((cameraId: string) => {
    onOpenLiveFeed?.(cameraId);
  }, [onOpenLiveFeed]);

  const setSound = useCallback((v: boolean) => {
    setSettings((s) => ({ ...s, sound: v }));
    if (v) primeAudio();
  }, []);

  const unacked = useMemo(() => events.filter((e) => !e.acknowledged).length, [events]);
  const worstUnacked = useMemo<Severity | null>(() => {
    let worst: Severity | null = null;
    for (const e of events) {
      if (e.acknowledged) continue;
      if (!worst || SEVERITY_RANK[e.severity] > SEVERITY_RANK[worst]) worst = e.severity;
    }
    return worst;
  }, [events]);

  const state = useMemo<AlertState>(() => ({
    events,
    unacked,
    worstUnacked,
    suppressed,
    snapshotsAvailable,
    sound: settings.sound,
    setSound,
    cameraStatusFor,
    captureMediaFor,
    acknowledge,
    acknowledgeMany,
    acknowledgeAll,
    deleteEvent,
    deleteEvents,
    openLive,
    setVisibleIds,
  }), [
    events, unacked, worstUnacked, suppressed, snapshotsAvailable, settings.sound, setSound,
    cameraStatusFor, captureMediaFor, acknowledge, acknowledgeMany, acknowledgeAll,
    deleteEvent, deleteEvents, openLive, setVisibleIds,
  ]);

  return (
    <IngestContext.Provider value={ingest}>
      <AlertStateContext.Provider value={state}>
        {children}
      </AlertStateContext.Provider>
    </IngestContext.Provider>
  );
}
