import React, { createContext, useContext, useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';

export interface Telemetry {
  people: number;
  vehicles?: number;
  detections: Array<{
    class: string;
    confidence: number;
    track_id: number | null;
    bbox: { x1: number; y1: number; x2: number; y2: number };
    speed?: number;
    speed_calibrated?: boolean;
    tracking_status?: 'tracked' | 'coasting';
    dwell_time?: number;
    direction?: string;
    lane?: string | null;
  }>;
  masks: number[][][]; // normalized polygons [[x,y], ...]
  tracks: Array<{
    track_id: number;
    class?: string;
    points: number[][]; // history of coordinates
  }>;
  counters: { 
    in: number; 
    out: number;
    vehicles_in?: number;
    vehicles_out?: number;
    people_in?: number;
    people_out?: number;
  };
  heatmap: number[][];
  latency: number;
  fps: number;
  camera_fps?: number;
  decode_fps?: number;
  inference_fps?: number;
  tracking_fps?: number;
  cpu?: number;
  memory?: number;
  gpu?: number;
  status: string;
  recording?: boolean;
  queue_depth?: number;
  capture_latency?: number;
  decode_latency?: number;
  preprocess_latency?: number;
  inference_latency?: number;
  postprocess_latency?: number;
  tracking_latency?: number;
  rendering_latency?: number;
  total_latency?: number;
  bottleneck?: string;
  backend?: string;
  device?: string;
  imgsz?: number;
  stage_errors?: Record<string, number>;
  line_stats?: Record<string, { in_count: number; out_count: number }>;
  zone_stats?: Record<string, {
    people_count: number;
    vehicles_count: number;
    items_count: number;
    occupancy: number;
    max_occupancy: number;
    entry_count: number;
    exit_count: number;
    avg_dwell_time: number;
    loitering_count: number;
    utilization: number;
    status: 'normal' | 'danger';
    parking_status?: 'occupied' | 'free';
    parking_score?: number;
    parking_reason?: string;
  }>;
  parking_stats?: {
    total: number;
    occupied: number;
    free: number;
    occupancy_percent: number;
    slots: Array<{
      id: string;
      name: string;
      occupied: boolean;
      status: 'occupied' | 'free';
      score: number;
      vehicle_overlap: number;
      vehicle_track_id: number | null;
      reason: string;
      points: number[][];
    }>;
  };
  crowd_stats?: {
    total_people: number;
    peak_cell_count: number;
    density_level: 'low' | 'moderate' | 'high' | 'critical';
    grid_size: number;
  };
  profile?: {
    capture_ms: number;
    preprocess_ms: number;
    inference_ms: number;
    analytics_ms: number;
    total_ms: number;
  };
}

export interface TelemetryData {
  [cameraId: string]: Telemetry;
}

interface TelemetryContextType {
  telemetry: TelemetryData;
  isConnected: boolean;
  sendMessage: (message: any) => void;
  worker: Worker | null;
  profiling?: { [cameraId: string]: { encode_ms: number; send_ms: number; total_ms: number; ts: number } };
  renderFps: number;
}

const TelemetryContext = createContext<TelemetryContextType>({
  telemetry: {},
  isConnected: false,
  sendMessage: () => {},
  worker: null,
  profiling: {},
  renderFps: 0,
});

// Per-camera subscription store, kept outside React state on purpose.
//
// The provider used to funnel every WS telemetry tick through one setState,
// so any component reading `telemetry` from context (e.g. one CCTVPlayer per
// grid cell, up to 64 in a full grid) re-rendered on every message from every
// camera, not just its own — the canvas overlay itself is unaffected (the
// worker draws it independently via rAF) but the surrounding React tree
// re-rendered dozens of times a second for no visible benefit. Components
// that only care about one camera should use useCameraTelemetry(camId)
// instead, which re-renders only when that specific camera's data changes.
type Listener = () => void;
const cameraListeners = new Map<string, Set<Listener>>();
let latestTelemetry: TelemetryData = {};

function notifyCamera(camId: string) {
  cameraListeners.get(camId)?.forEach((l) => l());
}

function subscribeCamera(camId: string, listener: Listener) {
  let set = cameraListeners.get(camId);
  if (!set) {
    set = new Set();
    cameraListeners.set(camId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) cameraListeners.delete(camId);
  };
}

function getCameraSnapshot(camId: string) {
  return latestTelemetry[camId];
}

export function useCameraTelemetry(cameraId: string): Telemetry | undefined {
  return useSyncExternalStore(
    (onStoreChange) => subscribeCamera(cameraId, onStoreChange),
    () => getCameraSnapshot(cameraId)
  );
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const [telemetry, setTelemetry] = useState<TelemetryData>({});
  const [isConnected, setIsConnected] = useState(false);
  const [worker, setWorker] = useState<Worker | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [profiling, setProfiling] = useState<{ [cameraId: string]: { encode_ms: number; send_ms: number; total_ms: number; ts: number } }>({});
  const [renderFps, setRenderFps] = useState(0);

  const sendMessage = useCallback((message: any) => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'send_message', message });
    }
  }, []);

  // Throttles the aggregate `telemetry` setState — consumers that need
  // per-camera speed (CCTVPlayer's HUD/boxes) already use
  // useCameraTelemetry(), which updates independently via
  // useSyncExternalStore and is unaffected by this. `telemetry` itself is
  // only meant for dashboard-level aggregates (sums/averages across
  // cameras), which don't need to re-render at full WS rate — doing so was
  // re-rendering every consumer of the raw context value (e.g. Dashboard)
  // dozens of times a second across all cameras combined.
  const lastAggregateUpdateRef = useRef(0);
  const pendingAggregateTimeoutRef = useRef<number | null>(null);
  const AGGREGATE_THROTTLE_MS = 400;

  useEffect(() => {
    // Instantiate Dedicated Web Worker
    const w = new Worker(new URL('../workers/overlay.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    setWorker(w);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // For local dev server, Vite proxy handles /ws
    const wsUrl = `${protocol}//${host}/ws`;

    console.log('[WebSocket Provider] Initializing worker with WS URL:', wsUrl);
    w.postMessage({ type: 'init_ws', wsUrl });

    w.onmessage = (event) => {
      const { type, isConnected: wsConnected, data, changedIds } = event.data;
      if (type === 'ws_status') {
        setIsConnected(wsConnected);
      } else if (type === 'telemetry') {
        // `data` is now a partial update (only the camera(s) that changed —
        // see overlay.worker.ts) — merge it into the running accumulator
        // instead of replacing it wholesale.
        latestTelemetry = { ...latestTelemetry, ...data };
        const changed: string[] = changedIds || Object.keys(data);
        changed.forEach(notifyCamera);

        const now = Date.now();
        const elapsed = now - lastAggregateUpdateRef.current;
        if (elapsed >= AGGREGATE_THROTTLE_MS) {
          lastAggregateUpdateRef.current = now;
          setTelemetry(latestTelemetry);
        } else if (pendingAggregateTimeoutRef.current === null) {
          pendingAggregateTimeoutRef.current = window.setTimeout(() => {
            pendingAggregateTimeoutRef.current = null;
            lastAggregateUpdateRef.current = Date.now();
            setTelemetry(latestTelemetry);
          }, AGGREGATE_THROTTLE_MS - elapsed);
        }
      } else if (type === 'render_fps') {
        setRenderFps(event.data.fps || 0);
      } else if (type === 'profiling') {
        try {
          const d = data as any;
          if (d && d.cameraId) {
            setProfiling((prev) => ({ ...prev, [d.cameraId]: { encode_ms: d.encode_ms || 0, send_ms: d.send_ms || 0, total_ms: d.total_ms || 0, ts: d.ts || Date.now() } }));
          }
        } catch (e) {}
      }
    };

    return () => {
      console.log('[WebSocket Provider] Terminating overlay worker');
      w.terminate();
      setWorker(null);
      if (pendingAggregateTimeoutRef.current !== null) {
        window.clearTimeout(pendingAggregateTimeoutRef.current);
        pendingAggregateTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <TelemetryContext.Provider value={{ telemetry, isConnected, sendMessage, worker, profiling, renderFps }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export const useTelemetry = () => useContext(TelemetryContext);
