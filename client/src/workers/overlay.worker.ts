// Dedicated Web Worker for drawing high-performance canvas overlays in the background.

interface Telemetry {
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
  masks: number[][][];
  tracks: Array<{
    track_id: number;
    class?: string;
    points: number[][];
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
  line_stats?: Record<string, { in_count: number; out_count: number }>;
  zone_stats?: Record<string, {
    occupancy: number;
    max_occupancy: number;
    status: 'normal' | 'danger';
  }>;

  capture_latency?: number;
  decode_latency?: number;
  inference_latency?: number;
  preprocess_latency?: number;
  postprocess_latency?: number;
  tracking_latency?: number;
  rendering_latency?: number;
  total_latency?: number;
  bottleneck?: string;
  frame?: string;
}

interface CameraConfig {
  zones: any[];
  lines: any[];
  editingZoneId?: string | null;

  showBoundingBox: boolean;
  showSegmentationMask: boolean;
  showPerson: boolean;
  showVehicle: boolean;
  showPersonId: boolean;
  showVehicleId: boolean;
  showClassName: boolean;
  showConfidence: boolean;
  showSpeed: boolean;
  showDirectionArrow: boolean;
  showMotionTrail: boolean;
  showTrackingPath: boolean;
  showZoneName: boolean;
  showZoneBorder: boolean;
  showZoneFill: boolean;
  showLineCrossingStatus: boolean;
  showIntrusionStatus: boolean;
  showLoiteringTimer: boolean;
  showPersonCount: boolean;
  showVehicleCount: boolean;
  showCameraFps: boolean;
  showAiFps: boolean;
  showLatency: boolean;
  showTimestamp: boolean;
  showCameraName: boolean;
  showHeatmap: boolean;
  showEventLabels: boolean;
  showRecordingStatus: boolean;

  colors: {
    boundingBox: string;
    segmentationMask: string;
    personId: string;
    vehicleId: string;
    className: string;
    confidence: string;
    speed: string;
    directionArrow: string;
    motionTrail: string;
    trackingPath: string;
    zoneName: string;
    zoneBorder: string;
    zoneFill: string;
    hudText: string;
    heatmap: string;
  };
  transparency: number;
  borderWidth: number;
  fontSize: number;
  labelStyle: 'solid' | 'transparent' | 'outline';
}

const DEFAULT_CONFIG: CameraConfig = {
  zones: [],
  lines: [],
  editingZoneId: null,
  showBoundingBox: true,
  showSegmentationMask: true,
  showPerson: true,
  showVehicle: true,
  showPersonId: true,
  showVehicleId: true,
  showClassName: true,
  showConfidence: true,
  showSpeed: true,
  showDirectionArrow: true,
  showMotionTrail: true,
  showTrackingPath: true,
  showZoneName: true,
  showZoneBorder: true,
  showZoneFill: true,
  showLineCrossingStatus: true,
  showIntrusionStatus: true,
  showLoiteringTimer: true,
  showPersonCount: true,
  showVehicleCount: true,
  showCameraFps: true,
  showAiFps: true,
  showLatency: true,
  showTimestamp: true,
  showCameraName: true,
  showHeatmap: true,
  showEventLabels: true,
  showRecordingStatus: true,
  colors: {
    boundingBox: '#6366f1',
    segmentationMask: '#818cf8',
    personId: '#38bdf8',
    vehicleId: '#34d399',
    className: '#f472b6',
    confidence: '#fbbf24',
    speed: '#fb7185',
    directionArrow: '#a7f3d0',
    motionTrail: '#34d399',
    trackingPath: '#10b981',
    zoneName: '#ef4444',
    zoneBorder: '#ef4444',
    zoneFill: '#ef4444',
    hudText: '#ffffff',
    heatmap: '#f43f5e'
  },
  transparency: 0.35,
  borderWidth: 2,
  fontSize: 12,
  labelStyle: 'solid'
};

interface DrawPreview {
  mode: 'none' | 'zone' | 'line';
  points: number[][];
}

const canvases = new Map<string, OffscreenCanvas>(); // viewportId -> OffscreenCanvas
const contexts = new Map<string, OffscreenCanvasRenderingContext2D>(); // viewportId -> Context
const telemetryData: { [cameraId: string]: Telemetry } = {}; // cameraId -> Telemetry

// Per-track motion state used to extrapolate bounding-box position between
// AI telemetry ticks. The AI pipeline runs well under the video's own frame
// rate (its latency budget is dominated by inference, not decode), but this
// render loop repaints every rAF at full video FPS — without extrapolation,
// a box just sits at its last known position and "steps" to the next one
// each time telemetry arrives, which reads as visible lag/trailing behind a
// fast-moving object. Storing velocity (normalized units/ms) computed from
// consecutive ticks and dead-reckoning forward by elapsed wall-clock time
// keeps the box moving smoothly with the vehicle in between.
interface TrackMotionState {
  cx: number; cy: number;   // normalized center at last telemetry receipt
  w: number; h: number;     // normalized box size at last receipt
  vx: number; vy: number;   // normalized units per ms
  receiptTime: number;      // performance.now() when this tick was received
}
const trackMotion = new Map<string, Map<number, TrackMotionState>>(); // cameraId -> track_id -> state
// Cap how far we'll dead-reckon past the last real update — bounds runaway
// drift if telemetry stalls (occlusion longer than the tracker's own coast
// window, dropped WS messages) instead of flying the box off to nowhere.
const MAX_EXTRAPOLATE_MS = 350;
const cameraConfigs = new Map<string, CameraConfig>(); // cameraId -> Config
const viewportToCameraMap = new Map<string, string>(); // viewportId -> cameraId
const drawPreviews = new Map<string, DrawPreview>(); // cameraId -> DrawPreview
// The video/img element renders with object-contain, so it's letterboxed
// inside its container whenever its native aspect ratio differs from the
// container's — this holds the actual displayed content rect (in CSS
// pixels, within the canvas) per viewport so every normalized-coordinate
// draw call below can map onto the real video pixels instead of the full
// (possibly letterboxed) canvas. Falls back to the full canvas if unset.
const contentRects = new Map<string, { x: number; y: number; width: number; height: number }>();

let ws: WebSocket | null = null;

self.onmessage = (event) => {
  const { type, cameraId, viewportId, canvas, width, height, config, wsUrl, telemetry, drawMode, points, rect } = event.data;

  if (type === 'init_ws') {
    initWebSocket(wsUrl);
  } else if (type === 'register') {
    const id = viewportId || cameraId;
    if (canvas && id) {
      canvases.set(id, canvas);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        contexts.set(id, ctx);
      }
    }
  } else if (type === 'deregister') {
    const id = viewportId || cameraId;
    if (id) {
      const oldCamId = viewportToCameraMap.get(id);
      if (oldCamId) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'unsubscribe', camera_id: oldCamId })); } catch (e) {}
        }
      }
      canvases.delete(id);
      contexts.delete(id);
      contentRects.delete(id);
      viewportToCameraMap.delete(id);
    }
  } else if (type === 'associate_camera') {
    if (viewportId && cameraId) {
      const oldCamId = viewportToCameraMap.get(viewportId);
      if (oldCamId && oldCamId !== cameraId) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'unsubscribe', camera_id: oldCamId })); } catch (e) {}
        }
      }
      viewportToCameraMap.set(viewportId, cameraId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'subscribe', camera_id: cameraId })); } catch (e) {}
      }
    }
  } else if (type === 'resize') {
    const id = viewportId || cameraId;
    if (id) {
      const cv = canvases.get(id);
      if (cv) {
        cv.width = width;
        cv.height = height;
      }
    }
  } else if (type === 'content_rect') {
    const id = viewportId || cameraId;
    if (id && rect) {
      contentRects.set(id, rect);
    }
  } else if (type === 'update_config') {
    if (cameraId) {
      cameraConfigs.set(cameraId, {
        ...DEFAULT_CONFIG,
        ...cameraConfigs.get(cameraId),
        ...config
      });
    }
  } else if (type === 'update_draw_preview') {
    if (cameraId) {
      drawPreviews.set(cameraId, {
        mode: drawMode || 'none',
        points: points || []
      });
    }
  } else if (type === 'inject_telemetry') {
    if (cameraId && telemetry) {
      telemetryData[cameraId] = telemetry;
    }
  } else if (type === 'send_message') {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event.data.message));
    }
  } else if (type === 'screen_frame_bitmap') {
    // Incoming ImageBitmap from main thread for screen/frame capture
    const { bitmap, cameraId: cam } = event.data;
    if (!cam || !bitmap) {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      return;
    }
    // Store latest pending bitmap and trigger processing loop
    pendingFrame.cameraId = cam;
    if (pendingFrame.bitmap && typeof pendingFrame.bitmap.close === 'function') {
      try { pendingFrame.bitmap.close(); } catch (e) {}
    }
    pendingFrame.bitmap = bitmap;
    if (!processingFrame) {
      processPendingFrames();
    }
  } else if (type === 'clear_pending_frames') {
    if (pendingFrame.bitmap && typeof pendingFrame.bitmap.close === 'function') {
      try { pendingFrame.bitmap.close(); } catch (e) {}
    }
    pendingFrame.bitmap = null;
    pendingFrame.cameraId = undefined;
  }
};

// Frame processing state
let processingFrame = false;
const pendingFrame: { bitmap: ImageBitmap | null; cameraId?: string } = { bitmap: null };

async function processPendingFrames() {
  if (processingFrame) return;
  processingFrame = true;
  while (pendingFrame.bitmap) {
    const bmp = pendingFrame.bitmap;
    const camId = pendingFrame.cameraId;
    // Clear pending so new frames replace while we process
    pendingFrame.bitmap = null;
    pendingFrame.cameraId = undefined;

    try {
      const off = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = off.getContext('2d');
      if (ctx) {
        ctx.drawImage(bmp, 0, 0);
      }
      try { bmp.close(); } catch (e) {}

      // Profiling timers (use performance if available)
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const encodeStart = now;

      // Convert to JPEG blob and then base64-encode
      const blob = await off.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      const encodeEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const ab = await blob.arrayBuffer();
      // base64 encode
      let binary = '';
      const bytes = new Uint8Array(ab);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const base64 = btoa(binary);
      const dataUrl = 'data:image/jpeg;base64,' + base64;

      const sendStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'screen_frame', camera_id: camId, frame: dataUrl }));
        } catch (e) {
          // ignore send errors; websocket will reconnect if needed
        }
      }
      const sendEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

      // Post profiling back to main thread for UI HUD (milliseconds)
      try {
        self.postMessage({ type: 'profiling', data: { cameraId: camId, encode_ms: Math.max(0, encodeEnd - encodeStart), send_ms: Math.max(0, sendEnd - sendStart), total_ms: Math.max(0, sendEnd - encodeStart), ts: Date.now() } });
      } catch (e) {}
    } catch (err) {
      // swallow frame processing errors and continue
      try { if (bmp && typeof bmp.close === 'function') bmp.close(); } catch (e) {}
    }
  }
  processingFrame = false;
}

function updateTrackMotion(cameraId: string, telemetry: Telemetry, recvTime: number) {
  const prevMap = trackMotion.get(cameraId);
  const nextMap = new Map<number, TrackMotionState>();
  const dets = telemetry.detections || [];
  for (const det of dets) {
    if (det.track_id === null || det.track_id === undefined) continue;
    const { x1, y1, x2, y2 } = det.bbox;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const w = x2 - x1;
    const h = y2 - y1;
    let vx = 0, vy = 0;
    const prev = prevMap?.get(det.track_id);
    if (prev) {
      const dt = recvTime - prev.receiptTime;
      // Only trust velocity between two consecutive, closely-spaced ticks —
      // a long gap (track was lost and re-identified, or a stall) means the
      // position delta over dt is not a meaningful instantaneous velocity.
      if (dt > 5 && dt < 1500) {
        vx = (cx - prev.cx) / dt;
        vy = (cy - prev.cy) / dt;
      }
    }
    nextMap.set(det.track_id, { cx, cy, w, h, vx, vy, receiptTime: recvTime });
  }
  trackMotion.set(cameraId, nextMap);
}

// Returns the extrapolated bbox for a track at the current render time, or
// the telemetry's own bbox if no motion state exists yet (first tick).
function getRenderBbox(cameraId: string, trackId: number | null, bbox: { x1: number; y1: number; x2: number; y2: number }, renderNow: number) {
  if (trackId === null || trackId === undefined) return bbox;
  const state = trackMotion.get(cameraId)?.get(trackId);
  if (!state) return bbox;
  const elapsed = Math.min(renderNow - state.receiptTime, MAX_EXTRAPOLATE_MS);
  if (elapsed <= 0) return bbox;
  const pcx = state.cx + state.vx * elapsed;
  const pcy = state.cy + state.vy * elapsed;
  return {
    x1: pcx - state.w / 2,
    y1: pcy - state.h / 2,
    x2: pcx + state.w / 2,
    y2: pcy + state.h / 2,
  };
}

function initWebSocket(wsUrl: string) {
  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  console.log('[Worker WS] Connecting to:', wsUrl);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    self.postMessage({ type: 'ws_status', isConnected: true });
    // Re-subscribe to all active cameras in viewports
    viewportToCameraMap.forEach((camId) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'subscribe', camera_id: camId })); } catch (e) {}
      }
    });
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'telemetry') {
        const data = payload.data;
        const changedIds = Object.keys(data);
        const recvTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        for (const camId in data) {
          // Store AI telemetry only — no video frames (video served via MJPEG)
          telemetryData[camId] = data[camId];
          updateTrackMotion(camId, data[camId], recvTime);
        }
        // Forward only the cameras that changed in this message (`data`),
        // not the full `telemetryData` accumulator. The server already only
        // ever sends one camera per WS message (see _ws_dispatch_loop in
        // pipeline.py), so posting the whole multi-camera map here meant
        // structured-cloning every camera's detections/masks/heatmap on
        // every single message — cost scaling with total camera count
        // regardless of which one actually changed. The main thread merges
        // this partial update into its own accumulator.
        self.postMessage({ type: 'telemetry', data, changedIds });
      }
    } catch (err) {
      // ignore
    }
  };

  ws.onclose = () => {
    self.postMessage({ type: 'ws_status', isConnected: false });
    setTimeout(() => {
      initWebSocket(wsUrl);
    }, 3000);
  };

  ws.onerror = () => {
    self.postMessage({ type: 'ws_status', isConnected: false });
  };
}

// Render FPS tracking (sliding 2-second window)
const renderTimestamps: number[] = [];
let renderFps = 0.0;
// Reported to the main thread (for the system-wide dashboard) at 1Hz, not
// every rAF — the render loop itself repaints at full display refresh rate,
// but nothing needs a render-FPS number updated that often outside this HUD.
let lastRenderFpsReport = 0;

// Render loop using requestAnimationFrame inside Web Worker
function renderLoop() {
  // Track render FPS
  const now = performance.now();
  renderTimestamps.push(now);
  const cutoff = now - 2000;
  while (renderTimestamps.length > 0 && renderTimestamps[0] < cutoff) {
    renderTimestamps.shift();
  }
  renderFps = renderTimestamps.length > 1 ? renderTimestamps.length / 2 : 0;
  if (now - lastRenderFpsReport > 1000) {
    lastRenderFpsReport = now;
    self.postMessage({ type: 'render_fps', fps: renderFps });
  }
  contexts.forEach((ctx, viewportId) => {
    const canvas = canvases.get(viewportId);
    if (!canvas) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas — video is shown via MJPEG <img> or <video> element behind this canvas
    ctx.clearRect(0, 0, width, height);

    // Resolve mapped camera ID
    const cameraId = viewportToCameraMap.get(viewportId) || viewportId;

    const config = cameraConfigs.get(cameraId) || DEFAULT_CONFIG;
    const telemetry = telemetryData[cameraId];

    // All normalized (0..1) coordinates below map onto this content rect,
    // not the raw canvas — the video/img renders with object-contain, so
    // whenever its native aspect ratio differs from the container's there
    // are letterbox bars the canvas covers but the video doesn't. Falls
    // back to the full canvas if no content rect has been reported yet
    // (e.g. before the media element's first frame loads).
    const cr = contentRects.get(viewportId);
    const cx0 = cr?.x ?? 0;
    const cy0 = cr?.y ?? 0;
    const cw = cr?.width || width;
    const ch = cr?.height || height;
    // Map a normalized (0..1) coordinate onto the actual video content rect.
    const toX = (n: number) => cx0 + n * cw;
    const toY = (n: number) => cy0 + n * ch;

    // 1. Draw Zones
    if (config.zones) {
      config.zones.forEach((zone: any) => {
        if (!zone.points || zone.points.length < 3) return;
        const isRoi = !!zone.roi;
        const isEditing = config.editingZoneId === zone.id;
        ctx.beginPath();
        ctx.moveTo(toX(zone.points[0][0]), toY(zone.points[0][1]));
        for (let i = 1; i < zone.points.length; i++) {
          ctx.lineTo(toX(zone.points[i][0]), toY(zone.points[i][1]));
        }
        ctx.closePath();

        // ROI (detection region) zones render in a distinct cyan so they
        // read as "gates what's detected" rather than a regular alert zone.
        const fillColor = isRoi ? '#22d3ee' : (config.colors?.zoneFill || '#ef4444');
        const borderColor = isRoi ? '#22d3ee' : (config.colors?.zoneBorder || '#ef4444');

        if (config.showZoneFill) {
          ctx.fillStyle = fillColor;
          ctx.globalAlpha = config.transparency;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }

        if (config.showZoneBorder) {
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = isEditing ? config.borderWidth + 1.5 : config.borderWidth;
          ctx.setLineDash(isEditing ? [6, 4] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (config.showZoneName) {
          ctx.font = `bold ${config.fontSize}px Inter, sans-serif`;
          ctx.fillStyle = isRoi ? '#22d3ee' : (config.colors?.zoneName || '#ef4444');
          const zStats = telemetry?.zone_stats?.[zone.id];
          const roiTag = isRoi ? '[ROI] ' : '';
          const zoneLabel = zStats
            ? `${roiTag}${zone.name || 'Zone'} [${zStats.status.toUpperCase()}] ${zStats.occupancy}/${zStats.max_occupancy}`
            : `${roiTag}${zone.name || 'Restricted Zone'}`;
          ctx.fillText(zoneLabel, toX(zone.points[0][0]) + 5, toY(zone.points[0][1]) + 15);
          if (zStats && zStats.status === 'danger') {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = (config.borderWidth || 2) + 2;
            ctx.stroke(); // re-stroke the already-built zone path in a heavier alert color
          }
        }

        // Draggable vertex handles for the zone currently being edited —
        // gives the operator a visible grab target for reshape/resize, and
        // a distinct fill (white ring) so it doesn't get lost against the
        // zone's own fill/border color.
        if (isEditing) {
          zone.points.forEach(([px, py]: number[]) => {
            const hx = toX(px), hy = toY(py);
            ctx.beginPath();
            ctx.arc(hx, hy, 7, 0, Math.PI * 2);
            ctx.fillStyle = '#0f172a';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#facc15';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(hx, hy, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#facc15';
            ctx.fill();
          });
        }
      });
    }

    // 2. Draw Lines
    if (config.lines) {
      config.lines.forEach((line: any) => {
        if (!line.points || line.points.length < 2) return;
        ctx.strokeStyle = config.colors?.zoneBorder || '#3b82f6';
        ctx.lineWidth = config.borderWidth + 1.5;
        ctx.beginPath();
        ctx.moveTo(toX(line.points[0][0]), toY(line.points[0][1]));
        ctx.lineTo(toX(line.points[1][0]), toY(line.points[1][1]));
        ctx.stroke();

        ctx.font = `bold ${config.fontSize}px Inter, sans-serif`;
        ctx.fillStyle = config.colors?.zoneBorder || '#3b82f6';

        const lineStats = telemetry?.line_stats?.[line.id];
        const countText = lineStats && config.showLineCrossingStatus 
          ? ` (IN: ${lineStats.in_count} | OUT: ${lineStats.out_count})` 
          : '';
        
        ctx.fillText((line.name || 'Crossing Line') + countText, toX(line.points[0][0]) + 5, toY(line.points[0][1]) - 5);
      });
    }

    // 3. Draw Telemetry
    if (telemetry) {
      // Heatmap rendering
      if (config.showHeatmap && telemetry.heatmap) {
        const rows = telemetry.heatmap.length;
        const cols = telemetry.heatmap[0]?.length || 0;
        if (rows > 0 && cols > 0) {
          const cellW = cw / cols;
          const cellH = ch / rows;
          const heatColor = config.colors?.heatmap || '#f43f5e';
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const val = telemetry.heatmap[r][c];
              if (val > 0.1) {
                const opacity = Math.min(val / 10, 0.85);
                ctx.fillStyle = heatColor;
                ctx.globalAlpha = opacity * config.transparency;
                ctx.fillRect(cx0 + c * cellW, cy0 + r * cellH, cellW + 1, cellH + 1);
              }
            }
          }
          ctx.globalAlpha = 1.0;
        }
      }

      // Draw Segmentation Masks
      if (config.showSegmentationMask && telemetry.masks && telemetry.detections) {
        ctx.globalAlpha = config.transparency;
        telemetry.masks.forEach((poly, idx) => {
          if (!poly || poly.length === 0) return;
          const det = telemetry.detections[idx];
          if (det) {
            const className = det.class || 'person';
            const isVehicle = ['car', 'bus', 'truck', 'motorcycle', 'bicycle'].includes(className);
            if (className === 'person' && !config.showPerson) return;
            if (isVehicle && !config.showVehicle) return;
          }
          ctx.fillStyle = config.colors?.segmentationMask || '#818cf8';
          ctx.beginPath();
          ctx.moveTo(toX(poly[0][0]), toY(poly[0][1]));
          for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(toX(poly[i][0]), toY(poly[i][1]));
          }
          ctx.closePath();
          ctx.fill();
        });
        ctx.globalAlpha = 1.0;
      }

      // Draw Motion Trails & Tracking Paths
      if ((config.showMotionTrail || config.showTrackingPath) && telemetry.tracks) {
        ctx.lineWidth = config.borderWidth;
        ctx.strokeStyle = config.showMotionTrail 
          ? (config.colors?.motionTrail || '#34d399') 
          : (config.colors?.trackingPath || '#10b981');
        
        telemetry.tracks.forEach((track) => {
          if (!track.points || track.points.length < 2) return;
          const trackClass = track.class || 'person';
          const isVehicle = ['car', 'bus', 'truck', 'motorcycle', 'bicycle'].includes(trackClass);
          if (trackClass === 'person' && !config.showPerson) return;
          if (isVehicle && !config.showVehicle) return;

          ctx.beginPath();
          ctx.moveTo(toX(track.points[0][0]), toY(track.points[0][1]));
          for (let i = 1; i < track.points.length; i++) {
            ctx.lineTo(toX(track.points[i][0]), toY(track.points[i][1]));
          }
          ctx.stroke();
        });
      }

      // Draw Bounding Boxes
      if (config.showBoundingBox && telemetry.detections) {
        telemetry.detections.forEach((det) => {
          const className = det.class || 'person';
          const isVehicle = ['car', 'bus', 'truck', 'motorcycle', 'bicycle'].includes(className);
          if (className === 'person' && !config.showPerson) return;
          if (isVehicle && !config.showVehicle) return;

          const { x1, y1, x2, y2 } = getRenderBbox(cameraId, det.track_id, det.bbox, now);
          const bx1 = toX(x1);
          const by1 = toY(y1);
          const bw = (x2 - x1) * cw;
          const bh = (y2 - y1) * ch;
          const baseColor = config.colors?.boundingBox || (isVehicle ? '#10b981' : '#6366f1');
          const labelColor = isVehicle ? (config.colors?.vehicleId || '#34d399') : (config.colors?.personId || '#38bdf8');
          // "coasting" = tracker is predicting this box through a missed
          // detection (occlusion/blur), not drawing from a fresh match this
          // frame — dashed outline makes that state visible per goal spec's
          // "Tracking Status" requirement instead of looking identical to a
          // normal confirmed detection.
          const isCoasting = det.tracking_status === 'coasting';

          // Glow outline
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 8;
          ctx.strokeStyle = baseColor;
          ctx.lineWidth = config.borderWidth;
          ctx.setLineDash(isCoasting ? [6, 4] : []);
          ctx.strokeRect(bx1, by1, bw, bh);
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;

          // Corner ticks
          const tl = 12;
          ctx.strokeStyle = labelColor;
          ctx.lineWidth = config.borderWidth + 1.5;
          ctx.beginPath(); ctx.moveTo(bx1 + tl, by1); ctx.lineTo(bx1, by1); ctx.lineTo(bx1, by1 + tl); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(bx1 + bw - tl, by1); ctx.lineTo(bx1 + bw, by1); ctx.lineTo(bx1 + bw, by1 + tl); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(bx1 + tl, by1 + bh); ctx.lineTo(bx1, by1 + bh); ctx.lineTo(bx1, by1 + bh - tl); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(bx1 + bw - tl, by1 + bh); ctx.lineTo(bx1 + bw, by1 + bh); ctx.lineTo(bx1 + bw, by1 + bh - tl); ctx.stroke();

          // Label text
          let details: string[] = [];
          if (config.showClassName) {
            let prefix = '';
            if (det.track_id !== null && det.track_id !== undefined) {
              const showId = isVehicle ? config.showVehicleId : config.showPersonId;
              if (showId) {
                prefix = `ID:${det.track_id} `;
              }
            }
            details.push(`${prefix}${className.toUpperCase()}`);
          } else if (det.track_id !== null && det.track_id !== undefined) {
            const showId = isVehicle ? config.showVehicleId : config.showPersonId;
            if (showId) {
              details.push(`ID:${det.track_id}`);
            }
          }

          if (config.showConfidence) {
            details.push(`${(det.confidence * 100).toFixed(0)}%`);
          }

          details.push(isCoasting ? 'COASTING' : 'TRACKED');

          if (config.showSpeed && det.speed !== undefined && det.speed > 0) {
            // speed_calibrated = measured via a real-world-distance speed
            // gate (two paired lines); otherwise it's the rough per-frame
            // motion estimate — mark calibrated readings so they read as
            // trustworthy km/h rather than an approximation.
            details.push(det.speed_calibrated ? `${Math.round(det.speed)}km/h ✓` : `~${Math.round(det.speed)}km/h`);
          }

          if (det.direction && det.direction !== 'stationary') {
            details.push(det.direction);
          }

          if (isVehicle && det.lane) {
            details.push(`LANE:${det.lane}`);
          }

          const labelText = details.join(' | ');

          if (labelText) {
            ctx.font = `bold ${config.fontSize}px monospace`;
            const textWidth = ctx.measureText(labelText).width;
            const textHeight = config.fontSize + 4;

            if (config.labelStyle === 'solid') {
              ctx.fillStyle = baseColor;
              ctx.fillRect(bx1 - 1, by1 - textHeight, textWidth + 8, textHeight);
              ctx.fillStyle = '#ffffff';
              ctx.fillText(labelText, bx1 + 3, by1 - 4);
            } else if (config.labelStyle === 'transparent') {
              ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
              ctx.fillRect(bx1 - 1, by1 - textHeight, textWidth + 8, textHeight);
              ctx.strokeStyle = baseColor;
              ctx.lineWidth = 1;
              ctx.strokeRect(bx1 - 1, by1 - textHeight, textWidth + 8, textHeight);
              ctx.fillStyle = labelColor;
              ctx.fillText(labelText, bx1 + 3, by1 - 4);
            } else { // outline
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 3;
              ctx.strokeText(labelText, bx1 + 3, by1 - 4);
              ctx.fillStyle = labelColor;
              ctx.fillText(labelText, bx1 + 3, by1 - 4);
            }
          }

          // Draw Direction Arrow
          if (config.showDirectionArrow && det.track_id !== null && telemetry.tracks) {
            const trk = telemetry.tracks.find(t => t.track_id === det.track_id);
            if (trk && trk.points && trk.points.length >= 2) {
              const p1 = trk.points[trk.points.length - 2];
              const p2 = trk.points[trk.points.length - 1];
              const dx = (p2[0] - p1[0]) * cw;
              const dy = (p2[1] - p1[1]) * ch;
              const len = Math.sqrt(dx*dx + dy*dy);
              if (len > 2) {
                const cx = bx1 + bw / 2;
                const cy = by1 + bh / 2;
                const angle = Math.atan2(dy, dx);
                
                ctx.strokeStyle = config.colors?.directionArrow || '#a7f3d0';
                ctx.lineWidth = config.borderWidth + 1;
                ctx.beginPath();
                ctx.moveTo(cx - Math.cos(angle)*10, cy - Math.sin(angle)*10);
                ctx.lineTo(cx + Math.cos(angle)*10, cy + Math.sin(angle)*10);
                ctx.stroke();
                
                ctx.fillStyle = config.colors?.directionArrow || '#a7f3d0';
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(angle)*10, cy + Math.sin(angle)*10);
                ctx.lineTo(cx + Math.cos(angle + Math.PI - 0.4)*6, cy + Math.sin(angle + Math.PI - 0.4)*6);
                ctx.lineTo(cx + Math.cos(angle + Math.PI + 0.4)*6, cy + Math.sin(angle + Math.PI + 0.4)*6);
                ctx.closePath();
                ctx.fill();
              }
            }
          }
        });
      }

      // Draw HUD (FPS, Latency, Timestamp, Camera Name, Counts)
      let hudLines: string[] = [];
      if (config.showCameraName) {
        hudLines.push(`CAM: ${cameraId.toUpperCase()}`);
      }
      if (config.showTimestamp) {
        hudLines.push(`TIME: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`);
      }
      if (config.showCameraFps && telemetry.camera_fps !== undefined) {
        hudLines.push(`CAP: ${telemetry.camera_fps.toFixed(1)} FPS`);
      }
      if (config.showAiFps && telemetry.fps !== undefined) {
        hudLines.push(`AI: ${telemetry.fps.toFixed(1)} FPS`);
        hudLines.push(`RND: ${renderFps.toFixed(1)} FPS`);
      }
      if (config.showLatency && telemetry.latency !== undefined) {
        hudLines.push(`LATENCY: ${telemetry.latency} ms`);
        hudLines.push(`  CAP: ${telemetry.capture_latency ?? 0} ms`);
        hudLines.push(`  DEC: ${telemetry.decode_latency ?? 0} ms`);
        hudLines.push(`  AI: ${telemetry.inference_latency ?? 0} ms`);
        hudLines.push(`  TRK: ${telemetry.tracking_latency ?? 0} ms`);
        hudLines.push(`  RND: ${telemetry.rendering_latency ?? 0} ms`);
        if (telemetry.bottleneck) {
          hudLines.push(`B-NECK: ${telemetry.bottleneck.toUpperCase()}`);
        }
        if (telemetry.cpu !== undefined) hudLines.push(`CPU: ${telemetry.cpu.toFixed(0)}%`);
        if (telemetry.memory !== undefined) hudLines.push(`RAM: ${telemetry.memory.toFixed(0)}%`);
        if (telemetry.gpu !== undefined) hudLines.push(`GPU: ${telemetry.gpu.toFixed(0)}%`);
        if (telemetry.queue_depth !== undefined) hudLines.push(`QUEUE: ${telemetry.queue_depth}`);
      }
      if (config.showPersonCount) {
        hudLines.push(`PEOPLE: ${telemetry.people}`);
      }
      if (config.showVehicleCount && telemetry.vehicles !== undefined) {
        hudLines.push(`VEHICLES: ${telemetry.vehicles}`);
      }

      if (hudLines.length > 0) {
        ctx.font = 'bold 11px monospace';
        let maxW = 0;
        hudLines.forEach(l => {
          const w = ctx.measureText(l).width;
          if (w > maxW) maxW = w;
        });

        const padX = 10;
        const padY = 8;
        const lineH = 14;
        const hudW = maxW + padX * 2;
        const hudH = hudLines.length * lineH + padY * 2;
        const hudX = width - hudW - 15;
        const hudY = 15;

        // Background box
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(hudX, hudY, hudW, hudH);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hudX, hudY, hudW, hudH);

        // Render text
        ctx.fillStyle = config.colors?.hudText || '#ffffff';
        hudLines.forEach((l, idx) => {
          ctx.fillText(l, hudX + padX, hudY + padY + idx * lineH + 11);
        });
      }

      // Draw Recording status (REC dot blinking)
      if (config.showRecordingStatus && telemetry.recording) {
        const blink = Math.floor(Date.now() / 500) % 2 === 0;
        ctx.fillStyle = blink ? '#ef4444' : 'rgba(239, 68, 68, 0.2)';
        ctx.beginPath();
        ctx.arc(25, 25, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = 'bold 12px monospace';
        ctx.fillStyle = '#ef4444';
        ctx.fillText('REC', 37, 29);
      }
    }

    // 4. Draw Interactive Drawing Preview
    const preview = drawPreviews.get(cameraId);
    if (preview && preview.mode !== 'none' && preview.points.length > 0) {
      ctx.strokeStyle = preview.mode === 'zone' ? '#ef4444' : '#3b82f6';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = preview.mode === 'zone' ? 'rgba(239, 68, 68, 0.2)' : 'transparent';
      
      ctx.beginPath();
      ctx.moveTo(toX(preview.points[0][0]), toY(preview.points[0][1]));
      for (let i = 1; i < preview.points.length; i++) {
        ctx.lineTo(toX(preview.points[i][0]), toY(preview.points[i][1]));
      }

      if (preview.mode === 'zone' && preview.points.length >= 3) {
        ctx.closePath();
      }
      ctx.stroke();
      if (preview.mode === 'zone') ctx.fill();

      // Draw point markers
      preview.points.forEach(([px, py]) => {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(toX(px), toY(py), 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(renderLoop);
  } else {
    setTimeout(renderLoop, 16);
  }
}

// Start render loop
renderLoop();
