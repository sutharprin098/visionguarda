import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit2, Trash2, Check, X, ShieldAlert, Navigation, HelpCircle, Eye, EyeOff, Layout, Settings, Download, Upload, Save, Camera as CameraIcon, Maximize2, CircleDot, PauseCircle } from 'lucide-react';
import axios from 'axios';
import { useMutation } from '@tanstack/react-query';
import { useTelemetry, useCameraTelemetry } from '../../contexts/TelemetryContext';
import { OverlaySettings, OverlayProfile } from '../../types';
import { computeContainRect, isPointInPolygon } from '../../utils/geometry';
import { setCameraRecording } from '../../utils/api';

interface CCTVPlayerProps {
  cameraId: string;
  cameraName: string;
  cameraType?: string;
  initialZones?: string; // JSON string
  initialLines?: string; // JSON string
  onConfigChange?: () => void;
}

// These small leaf components subscribe to one camera's telemetry directly
// (via useCameraTelemetry) instead of reading it in the parent CCTVPlayer.
// Detections/counters arrive many times a second per camera, and a grid can
// show up to 64 cameras at once — if CCTVPlayer itself held that state, every
// telemetry tick for ANY camera would re-render EVERY camera's full player
// tree (config panel, zone/line lists, profile manager and all). Isolating
// the fast-changing bits here means only the camera that actually changed
// re-renders, and only these small subtrees.

const CameraLiveBadge = memo(function CameraLiveBadge({ cameraId }: { cameraId: string }) {
  const telemetry = useCameraTelemetry(cameraId);
  return (
    <div className="flex items-center gap-1.5 text-xs text-brand-300 font-mono">
      <span>{telemetry?.fps ?? 0} FPS</span>
      <span className="opacity-40">|</span>
      <span>{telemetry?.latency ?? 0} ms</span>
    </div>
  );
});

const RecordingControl = memo(function RecordingControl({ cameraId }: { cameraId: string }) {
  const telemetry = useCameraTelemetry(cameraId);
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => setCameraRecording(cameraId, enabled),
  });
  const recording = telemetry?.recording ?? false;

  return (
    <button
      onClick={() => mutation.mutate(!recording)}
      disabled={mutation.isPending}
      title={recording ? 'Pause recording' : 'Resume recording'}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors disabled:opacity-50 ${
        recording ? 'text-red-400 hover:text-red-300' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {recording ? <CircleDot size={11} className="animate-pulse" /> : <PauseCircle size={11} />}
      {recording ? 'REC' : 'PAUSED'}
    </button>
  );
});

const CameraCountersHUD = memo(function CameraCountersHUD({ cameraId }: { cameraId: string }) {
  const telemetry = useCameraTelemetry(cameraId);
  if (!telemetry?.counters) return null;
  const { counters } = telemetry;
  return (
    <div className="absolute bottom-2 left-2 flex flex-col gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-bold font-mono text-white bg-slate-950/85 border border-brand-500/20 backdrop-blur">
      <div className="flex gap-1.5">
        <span className="text-slate-400">TOTAL -</span>
        <span className="text-emerald-400">IN: {counters.in}</span>
        <span className="text-brand-300 opacity-40">|</span>
        <span className="text-red-400">OUT: {counters.out}</span>
      </div>
      {(counters.people_in !== undefined || counters.vehicles_in !== undefined) && (
        <>
          <div className="h-[1px] bg-slate-800 my-0.5" style={{ opacity: 0.3 }} />
          <div className="flex gap-1.5 text-pink-400">
            <span className="text-slate-400">PEOPLE -</span>
            <span>IN: {counters.people_in ?? 0}</span>
            <span className="text-brand-300 opacity-40">|</span>
            <span>OUT: {counters.people_out ?? 0}</span>
          </div>
          <div className="flex gap-1.5 text-teal-400">
            <span className="text-slate-400">VEHICLE -</span>
            <span>IN: {counters.vehicles_in ?? 0}</span>
            <span className="text-brand-300 opacity-40">|</span>
            <span>OUT: {counters.vehicles_out ?? 0}</span>
          </div>
        </>
      )}
    </div>
  );
});

const TrackedObjectsPanel = memo(function TrackedObjectsPanel({ cameraId }: { cameraId: string }) {
  const telemetry = useCameraTelemetry(cameraId);
  if (!telemetry?.detections || telemetry.detections.length === 0) return null;
  return (
    <div className="p-2.5 rounded-lg bg-slate-900/60 border border-brand-500/10 space-y-2">
      <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider flex items-center gap-1.5 font-sans">
        <Eye size={12} className="text-brand-300" />
        Currently Tracked ({telemetry.detections.length})
      </span>
      <div className="max-h-36 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
        {telemetry.detections.map((det: any, idx: number) => (
          <div key={idx} className="flex items-center justify-between bg-slate-950 p-2 rounded text-[11px] font-mono">
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${
                det.class === 'person' ? 'bg-indigo-400' :
                ['car', 'truck', 'bus'].includes(det.class) ? 'bg-cyan-400' :
                ['motorcycle', 'bicycle'].includes(det.class) ? 'bg-emerald-400' : 'bg-pink-400'
              }`} />
              <span className="text-white capitalize font-semibold">{det.class}</span>
              {det.track_id !== null && (
                <span className="text-[9px] bg-slate-900 text-brand-300 px-1 py-0.5 rounded font-bold">
                  ID: {det.track_id}
                </span>
              )}
            </div>
            <div className="text-slate-400 flex items-center gap-1.5 text-[9px]">
              <span>{Math.round(det.confidence * 100)}%</span>
              {det.speed !== undefined && (
                <span className="text-amber-400 font-bold">{det.speed.toFixed(1)} km/h</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

// Renders nothing — just resets the screen-share backpressure flag whenever
// this camera's telemetry updates, without making the whole player
// re-render every time (isProcessingRef is a plain ref, not React state).
const ScreenShareBackpressureReset = memo(function ScreenShareBackpressureReset({
  cameraId, isProcessingRef,
}: { cameraId: string; isProcessingRef: React.MutableRefObject<boolean> }) {
  const telemetry = useCameraTelemetry(cameraId);
  useEffect(() => {
    isProcessingRef.current = false;
  }, [telemetry]);
  return null;
});

export function CCTVPlayer({ cameraId, cameraName, cameraType = 'webcam', initialZones = "[]", initialLines = "[]", onConfigChange }: CCTVPlayerProps) {
  const { sendMessage, worker, isConnected } = useTelemetry();
  const [activeTab, setActiveTab] = useState<'analytics' | 'overlays'>('analytics');
  const [profileName, setProfileName] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<OverlayProfile[]>([]);
  
  const [settings, setSettings] = useState<OverlaySettings>({
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
  });
  
  // Screen sharing states & refs
  const [isSharing, setIsSharing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Interactive drawing states
  const [drawMode, setDrawMode] = useState<'none' | 'zone' | 'line'>('none');
  const [points, setPoints] = useState<number[][]>([]);
  const [zones, setZones] = useState<any[]>(() => JSON.parse(initialZones));
  const [lines, setLines] = useState<any[]>(() => JSON.parse(initialLines));
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Zone edit mode: the zone (if any) currently reshapeable/movable by
  // dragging its vertex handles or its body directly on the canvas.
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const VERTEX_HIT_RADIUS_PX = 10;
  const dragRef = useRef<{
    zoneId: string;
    vertexIndex: number | null; // null = dragging the whole polygon body
    startNorm: [number, number];
    originalPoints: number[][];
  } | null>(null);

  const playerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const viewportId = `cctv_player_${cameraId}`;
  const canvasTransferredRef = useRef<boolean>(false);
  const deregisterTimeoutRef = useRef<number | null>(null);
  const isProcessingRef = useRef<boolean>(false);
  const contentRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);

  const captureSnapshot = useCallback(() => {
    const source = cameraType === 'screenshare' ? videoRef.current : imgRef.current;
    if (!source) return;
    const w = cameraType === 'screenshare' ? (source as HTMLVideoElement).videoWidth : (source as HTMLImageElement).naturalWidth;
    const h = cameraType === 'screenshare' ? (source as HTMLVideoElement).videoHeight : (source as HTMLImageElement).naturalHeight;
    if (!w || !h) return;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cameraName.replace(/\s+/g, '_')}_${Date.now()}.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.92);
  }, [cameraType, cameraName]);

  const enterTileFullscreen = useCallback(() => {
    playerRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: 1280, height: 720 },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsSharing(true);

      // Handle stream stop by user from browser native bar
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error('Error starting screen share:', err);
    }
  };

  const stopScreenShare = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsSharing(false);
    isProcessingRef.current = false;
  };

  // Lock-free loop for local sharing capture (max queue size = 1) using requestVideoFrameCallback.
  // Frame grab (createImageBitmap) and JPEG encode+send (in overlay.worker.ts) both happen
  // off the main thread — a prior version drew to a canvas and called the synchronous
  // canvas.toDataURL() right here on the UI thread, which blocked rendering/interaction
  // on every captured frame and was the source of screen-share UI freezes.
  useEffect(() => {
    if (!isSharing || !worker) return;

    const video = videoRef.current;
    if (!video) return;

    let active = true;
    let callbackId: number;
    let animationFrameId: number;

    const captureFrame = () => {
      if (!active) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !isProcessingRef.current) {
        isProcessingRef.current = true;
        createImageBitmap(video)
          .then((bmp) => {
            worker.postMessage({ type: 'screen_frame_bitmap', cameraId, bitmap: bmp }, [bmp]);
          })
          .catch(() => {})
          .finally(() => {
            isProcessingRef.current = false;
          });
      }
    };

    const updateLoop = () => {
      captureFrame();
      if (active) {
        if ('requestVideoFrameCallback' in video) {
          callbackId = (video as any).requestVideoFrameCallback(updateLoop);
        } else {
          animationFrameId = requestAnimationFrame(updateLoop);
        }
      }
    };

    if ('requestVideoFrameCallback' in video) {
      callbackId = (video as any).requestVideoFrameCallback(updateLoop);
    } else {
      animationFrameId = requestAnimationFrame(updateLoop);
    }

    return () => {
      active = false;
      if (video && 'cancelVideoFrameCallback' in video && callbackId !== undefined) {
        (video as any).cancelVideoFrameCallback(callbackId);
      }
      if (animationFrameId !== undefined) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isSharing, cameraId, worker]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Web Worker canvas integration: Register Canvas on Mount, deregister on
  // unmount. Without the deregister call, every CCTVPlayer that ever
  // unmounts (camera removed, grid layout changed, navigating away and
  // back) leaves its OffscreenCanvas/context/subscription alive forever
  // inside the worker's module-level Maps — the render loop keeps drawing
  // to canvases nobody can see (unbounded per-frame CPU growth over a
  // session) and the WS keeps re-subscribing to cameras nothing displays.
  //
  // canvas.transferControlToOffscreen() can only ever be called ONCE per
  // <canvas> element — a second call throws and permanently breaks
  // rendering for that camera. React 18 StrictMode deliberately double-
  // invokes this effect in dev (mount -> cleanup -> mount, same DOM node)
  // to catch exactly this kind of non-reentrant side effect, so
  // canvasTransferredRef must never be reset back to false. The deregister
  // itself is deferred to the next microtask/tick: if this effect re-fires
  // synchronously (StrictMode's simulated remount), the pending deregister
  // is cancelled before it ever reaches the worker; only a genuine unmount
  // (no immediate remount) lets it actually fire.
  useEffect(() => {
    if (deregisterTimeoutRef.current !== null) {
      clearTimeout(deregisterTimeoutRef.current);
      deregisterTimeoutRef.current = null;
    }

    const canvas = canvasRef.current;
    if (canvas && worker && !canvasTransferredRef.current) {
      try {
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage({
          type: 'register',
          viewportId,
          canvas: offscreen
        }, [offscreen]);
        canvasTransferredRef.current = true;
        console.log(`[CCTVPlayer ${cameraId}] Canvas transferred to Web Worker`);
      } catch (err) {
        console.error(`[CCTVPlayer ${cameraId}] Failed to transfer canvas to OffscreenCanvas:`, err);
      }
    }

    return () => {
      if (worker && canvasTransferredRef.current) {
        deregisterTimeoutRef.current = window.setTimeout(() => {
          deregisterTimeoutRef.current = null;
          worker.postMessage({ type: 'deregister', viewportId });
        }, 0);
      }
    };
  }, [worker, viewportId, cameraId]);

  // Associate Canvas viewport with active Camera ID
  useEffect(() => {
    if (worker) {
      worker.postMessage({
        type: 'associate_camera',
        viewportId,
        cameraId
      });
    }
  }, [worker, viewportId, cameraId]);

  // Load profiles from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('cctv_overlay_profiles');
      if (stored) {
        setSavedProfiles(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load profiles:', e);
    }
  }, []);

  const saveProfile = () => {
    if (!profileName.trim()) return;
    const newProfile: OverlayProfile = {
      id: `profile_${Date.now()}`,
      name: profileName.trim(),
      settings: { ...settings }
    };
    const updated = [...savedProfiles, newProfile];
    setSavedProfiles(updated);
    localStorage.setItem('cctv_overlay_profiles', JSON.stringify(updated));
    setProfileName('');
  };

  const applyProfile = (profileId: string) => {
    const prof = savedProfiles.find(p => p.id === profileId);
    if (prof) {
      setSettings(prof.settings);
    }
  };

  const deleteProfile = (profileId: string) => {
    const updated = savedProfiles.filter(p => p.id !== profileId);
    setSavedProfiles(updated);
    localStorage.setItem('cctv_overlay_profiles', JSON.stringify(updated));
  };

  const exportProfile = (prof: OverlayProfile) => {
    const dataStr = JSON.stringify(prof, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prof.name.toLowerCase().replace(/\s+/g, '_')}_profile.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importProfile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && parsed.settings) {
          const newProfile: OverlayProfile = {
            id: `profile_${Date.now()}`,
            name: parsed.name || `Imported Profile`,
            settings: parsed.settings
          };
          const updated = [...savedProfiles, newProfile];
          setSavedProfiles(updated);
          localStorage.setItem('cctv_overlay_profiles', JSON.stringify(updated));
          setSettings(parsed.settings);
        }
      } catch (err) {
        alert('Invalid profile JSON format.');
      }
    };
    reader.readAsText(file);
  };

  // Update Display configs in Web Worker
  useEffect(() => {
    if (worker) {
      worker.postMessage({
        type: 'update_config',
        cameraId,
        config: {
          zones,
          lines,
          editingZoneId,
          ...settings
        }
      });
    }
  }, [worker, cameraId, zones, lines, settings, editingZoneId]);

  // Update Draw Preview configs in Web Worker
  useEffect(() => {
    if (worker) {
      worker.postMessage({
        type: 'update_draw_preview',
        cameraId,
        drawMode,
        points
      });
    }
  }, [worker, cameraId, drawMode, points]);

  // Monitor resize observer to update Web Worker. Also recomputes the
  // object-contain letterbox rect (see computeContainRect) whenever the
  // container resizes or the media element's intrinsic resolution becomes
  // known/changes, and pushes it to the worker so drawing stays aligned
  // with the actual visible video pixels instead of the full canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worker) return;

    const sendContentRect = () => {
      const parent = playerRef.current;
      if (!parent) return;
      const containerW = parent.clientWidth;
      const containerH = parent.clientHeight;

      let contentW = 0;
      let contentH = 0;
      if (cameraType === 'screenshare' && videoRef.current) {
        contentW = videoRef.current.videoWidth;
        contentH = videoRef.current.videoHeight;
      } else if (imgRef.current) {
        contentW = imgRef.current.naturalWidth;
        contentH = imgRef.current.naturalHeight;
      }

      if (contentW && contentH) {
        setResolution((prev) => (prev && prev.w === contentW && prev.h === contentH ? prev : { w: contentW, h: contentH }));
      }

      const rect = computeContainRect(containerW, containerH, contentW, contentH);
      const last = contentRectRef.current;
      if (last && last.x === rect.x && last.y === rect.y && last.width === rect.width && last.height === rect.height) {
        return; // unchanged — skip the extra postMessage (img 'load' fires every MJPEG frame)
      }
      contentRectRef.current = rect;
      worker.postMessage({ type: 'content_rect', viewportId, rect });
    };

    const handleResize = () => {
      const parent = playerRef.current;
      if (parent) {
        worker.postMessage({
          type: 'resize',
          viewportId,
          width: parent.clientWidth,
          height: parent.clientHeight
        });
      }
      sendContentRect();
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    if (playerRef.current) {
      resizeObserver.observe(playerRef.current);
    }

    const imgEl = imgRef.current;
    const videoEl = videoRef.current;
    imgEl?.addEventListener('load', sendContentRect);
    videoEl?.addEventListener('loadedmetadata', sendContentRect);
    videoEl?.addEventListener('resize', sendContentRect);

    handleResize();

    return () => {
      resizeObserver.disconnect();
      imgEl?.removeEventListener('load', sendContentRect);
      videoEl?.removeEventListener('loadedmetadata', sendContentRect);
      videoEl?.removeEventListener('resize', sendContentRect);
    };
  }, [worker, viewportId, cameraType]);

  // Maps a mouse event's client coords onto the same normalized (0..1)
  // space zones/lines are stored in, through the letterboxed content rect
  // the worker draws against — otherwise clicks would be offset by the
  // letterbox bars whenever the video's aspect ratio doesn't match the
  // container's. Also returns the content rect's pixel size so callers can
  // convert a normalized distance into a screen-pixel one (for hit-testing).
  const clientToNorm = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const lx = clientX - rect.left;
    const ly = clientY - rect.top;
    const content = contentRectRef.current;
    const cx = lx - (content?.x ?? 0);
    const cy = ly - (content?.y ?? 0);
    const cw = content?.width || rect.width;
    const ch = content?.height || rect.height;
    return {
      x: Number(Math.min(1, Math.max(0, cx / cw)).toFixed(4)),
      y: Number(Math.min(1, Math.max(0, cy / ch)).toFixed(4)),
      cw,
      ch,
    };
  }, []);

  // Click handler for drawing points
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === 'none') return;

    const norm = clientToNorm(e.clientX, e.clientY);
    if (!norm) return;
    const normX = norm.x;
    const normY = norm.y;

    if (drawMode === 'line') {
      if (points.length < 2) {
        const nextPts = [...points, [normX, normY]];
        setPoints(nextPts);
      }
    } else if (drawMode === 'zone') {
      setPoints([...points, [normX, normY]]);
    }
  };

  const persistZonesLines = async (updatedZones: any[], updatedLines: any[]) => {
    try {
      await axios.post(`/api/cameras/${cameraId}/config`, {
        zones: JSON.stringify(updatedZones),
        lines: JSON.stringify(updatedLines),
      });
      if (onConfigChange) onConfigChange();
    } catch (err) {
      console.error('Failed to save camera configurations:', err);
    }
  };

  // Zone edit mode: mousedown either grabs a vertex handle (reshape/resize)
  // or, if the click landed inside the polygon body but not on a handle,
  // starts a whole-shape move. Nothing happens on empty canvas so this
  // never fights with the normal pan/scroll/other camera-tile interactions.
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!editingZoneId || drawMode !== 'none') return;
    const zone = zones.find((z) => z.id === editingZoneId);
    if (!zone?.points || zone.points.length < 3) return;
    const norm = clientToNorm(e.clientX, e.clientY);
    if (!norm) return;

    let vertexIndex: number | null = null;
    for (let i = 0; i < zone.points.length; i++) {
      const [zx, zy] = zone.points[i];
      const dx = (zx - norm.x) * norm.cw;
      const dy = (zy - norm.y) * norm.ch;
      if (Math.sqrt(dx * dx + dy * dy) <= VERTEX_HIT_RADIUS_PX) {
        vertexIndex = i;
        break;
      }
    }

    if (vertexIndex === null && !isPointInPolygon([norm.x, norm.y], zone.points)) {
      return; // clicked outside the shape and not on a handle — ignore
    }

    dragRef.current = {
      zoneId: editingZoneId,
      vertexIndex,
      startNorm: [norm.x, norm.y],
      originalPoints: zone.points.map((p: number[]) => [p[0], p[1]]),
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const norm = clientToNorm(e.clientX, e.clientY);
    if (!norm) return;

    setZones((prev) =>
      prev.map((z) => {
        if (z.id !== drag.zoneId) return z;
        if (drag.vertexIndex !== null) {
          const pts = drag.originalPoints.map((p, i) => (i === drag.vertexIndex ? [norm.x, norm.y] : p));
          return { ...z, points: pts };
        }
        // Whole-shape move: translate every vertex by the drag delta, clamped to [0,1]
        const dx = norm.x - drag.startNorm[0];
        const dy = norm.y - drag.startNorm[1];
        const pts = drag.originalPoints.map(([x, y]) => [
          Math.min(1, Math.max(0, x + dx)),
          Math.min(1, Math.max(0, y + dy)),
        ]);
        return { ...z, points: pts };
      })
    );
  };

  // Fires on mouseup AND mouseleave (dragging off the canvas edge shouldn't
  // leave the drag stuck active) — persists the final shape once, then
  // clears drag state either way.
  const handleCanvasDragEnd = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    persistZonesLines(zones, lines);
  };

  const handleSaveDrawing = async () => {
    if (drawMode === 'zone' && points.length < 3) return;
    if (drawMode === 'line' && points.length < 2) return;

    let updatedZones = [...zones];
    let updatedLines = [...lines];

    if (drawMode === 'zone') {
      updatedZones.push({
        id: `zone_${Date.now()}`,
        name: `Restricted Zone ${zones.length + 1}`,
        points: points
      });
      setZones(updatedZones);
    } else {
      updatedLines.push({
        id: `line_${Date.now()}`,
        name: `Counting Line ${lines.length + 1}`,
        points: points
      });
      setLines(updatedLines);
    }
    setShowConfigPanel(true);

    // Save to server
    try {
      await axios.post(`/api/cameras/${cameraId}/config`, {
        zones: JSON.stringify(updatedZones),
        lines: JSON.stringify(updatedLines)
      });
      setPoints([]);
      setDrawMode('none');
      if (onConfigChange) onConfigChange();
    } catch (err) {
      console.error('Failed to save camera configurations:', err);
    }
  };

  const handleClearDrawing = () => {
    setPoints([]);
  };

  const handleRemoveZone = async (id: string, type: 'zone' | 'line') => {
    let updatedZones = [...zones];
    let updatedLines = [...lines];

    if (type === 'zone') {
      updatedZones = updatedZones.filter(z => z.id !== id);
      setZones(updatedZones);
      if (editingZoneId === id) setEditingZoneId(null);
    } else {
      updatedLines = updatedLines.filter(l => l.id !== id);
      setLines(updatedLines);
    }

    try {
      await axios.post(`/api/cameras/${cameraId}/config`, {
        zones: JSON.stringify(updatedZones),
        lines: JSON.stringify(updatedLines)
      });
      if (onConfigChange) onConfigChange();
    } catch (err) {
      console.error('Failed to delete configuration:', err);
    }
  };

  const handleRename = async (id: string, name: string, type: 'zone' | 'line') => {
    let updatedZones = [...zones];
    let updatedLines = [...lines];

    if (type === 'zone') {
      updatedZones = updatedZones.map(z => z.id === id ? { ...z, name } : z);
      setZones(updatedZones);
    } else {
      updatedLines = updatedLines.map(l => l.id === id ? { ...l, name } : l);
      setLines(updatedLines);
    }

    try {
      await axios.post(`/api/cameras/${cameraId}/config`, {
        zones: JSON.stringify(updatedZones),
        lines: JSON.stringify(updatedLines)
      });
      if (onConfigChange) onConfigChange();
    } catch (err) {
      console.error('Failed to rename config:', err);
    }
  };

  // Any zone field that just needs its value swapped and persisted: the
  // roi flag (gates detection — see task), zoneType (labels alerts/lane
  // assignment), maxOccupancy (overcrowding threshold) and dwellLimit
  // (loitering threshold) — all already consumed by analytics.py, just not
  // previously exposed in this UI.
  const handleUpdateZoneField = (id: string, field: 'roi' | 'zoneType' | 'maxOccupancy' | 'dwellLimit', value: any) => {
    const updatedZones = zones.map(z => z.id === id ? { ...z, [field]: value } : z);
    setZones(updatedZones);
    persistZonesLines(updatedZones, lines);
  };

  // Two-line speed gate: pairing this line with another + a real-world
  // distance (meters) between them lets the backend compute calibrated
  // km/h (distance / time-between-crossings) instead of the rough
  // per-frame motion estimate. Persists like the other line fields.
  const handleUpdateLineField = async (id: string, field: 'speedPairId' | 'distanceM', value: string) => {
    const updatedLines = lines.map(l => {
      if (l.id !== id) return l;
      if (field === 'distanceM') {
        const n = value === '' ? undefined : Number(value);
        return { ...l, distanceM: n !== undefined && !Number.isNaN(n) ? n : undefined };
      }
      return { ...l, speedPairId: value || undefined };
    });
    setLines(updatedLines);

    try {
      await axios.post(`/api/cameras/${cameraId}/config`, {
        zones: JSON.stringify(zones),
        lines: JSON.stringify(updatedLines)
      });
      if (onConfigChange) onConfigChange();
    } catch (err) {
      console.error('Failed to update line speed-gate config:', err);
    }
  };

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      {/* Feed Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-slate-900/60" style={{ borderColor: 'rgba(99,102,241,0.1)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-sm font-semibold text-white truncate">{cameraName}</span>
          {resolution && (
            <span className="text-[10px] font-mono text-slate-500 shrink-0">{resolution.w}×{resolution.h}</span>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <RecordingControl cameraId={cameraId} />
          <CameraLiveBadge cameraId={cameraId} />
          <button onClick={captureSnapshot} title="Take snapshot" className="text-slate-400 hover:text-white transition-colors">
            <CameraIcon size={13} />
          </button>
          <button onClick={enterTileFullscreen} title="Fullscreen this camera" className="text-slate-400 hover:text-white transition-colors">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      <ScreenShareBackpressureReset cameraId={cameraId} isProcessingRef={isProcessingRef} />

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Side: Video Viewport Container */}
        <div ref={playerRef} className="relative flex-1 bg-black min-h-0">
        {/* Screen share: video element shown directly when sharing */}
        {cameraType === 'screenshare' && (
          <>
            <video
              ref={videoRef}
              className={`absolute inset-0 w-full h-full object-contain ${isSharing ? '' : 'hidden'}`}
              playsInline
              muted
            />
          </>
        )}

        {/* MJPEG stream: always shown for non-screenshare cameras at full camera FPS */}
        {cameraType !== 'screenshare' && (
          <img
            ref={imgRef}
            src={`/api/cameras/${cameraId}/stream`}
            alt={cameraName}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        )}

        {/* Screenshare prompt when not yet sharing */}
        {cameraType === 'screenshare' && !isSharing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 text-center p-4 z-10">
            <div className="w-10 h-10 rounded-full bg-brand-500/10 border border-brand-500/30 flex items-center justify-center mb-2 text-brand-400 animate-pulse">
              <Layout size={18} />
            </div>
            <p className="text-xs font-bold text-white mb-1">Screen Share Source</p>
            <p className="text-[9px] text-slate-400 max-w-[180px] mb-3">Share your screen or a specific window to detect humans inside it.</p>
            <button
              onClick={startScreenShare}
              className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 rounded-lg text-[10px] font-bold text-white shadow-lg transition-all hover:scale-105"
            >
              Start Screen Share
            </button>
          </div>
        )}

        {/* Overlay Canvas for Draw / Render (Managed by Web Worker) */}
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasDragEnd}
          onMouseLeave={handleCanvasDragEnd}
          className={`absolute inset-0 w-full h-full ${
            drawMode !== 'none' ? 'cursor-crosshair' : editingZoneId ? 'cursor-move pointer-events-auto' : 'pointer-events-auto'
          }`}
        />

        {/* Counters & HUD details */}
        <CameraCountersHUD cameraId={cameraId} />
          {/* Right Side: Collapsible Drawer overlay */}
          <AnimatePresence>
            {showConfigPanel && (
              <motion.div
                initial={{ x: 320, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 320, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="absolute right-0 top-0 bottom-0 w-[320px] border-l border-brand-500/10 bg-slate-950/95 flex flex-col h-full overflow-hidden backdrop-blur-md z-20"
              >
                <div className="p-3 border-b border-brand-500/10 flex items-center justify-between bg-slate-900/40">
                  <span className="text-[11px] font-bold text-brand-300 uppercase tracking-wider">Control Center</span>
                  <button
                    onClick={() => setShowConfigPanel(false)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>

                <div className="flex border-b border-brand-500/10">
                  <button
                    onClick={() => setActiveTab('analytics')}
                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors ${
                      activeTab === 'analytics'
                        ? 'border-brand-500 text-brand-400 bg-slate-900/20'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Zones & Lines
                  </button>
                  <button
                    onClick={() => setActiveTab('overlays')}
                    className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors ${
                      activeTab === 'overlays'
                        ? 'border-brand-500 text-brand-400 bg-slate-900/20'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Overlay Manager
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                  {/* Active Tracked Objects */}
                  <TrackedObjectsPanel cameraId={cameraId} />

                  {activeTab === 'analytics' ? (
                    <>
                      {/* Zones List */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                          <ShieldAlert size={10} className="text-red-500/70" />
                          Restricted Zones
                        </h4>
                        {zones.length === 0 ? (
                          <p className="text-[10px] text-slate-600 italic px-1">No zones drawn</p>
                        ) : (
                          <div className="space-y-1">
                            {zones.map((z) => (
                              <div key={z.id} className={`rounded px-1.5 py-1 space-y-1 ${editingZoneId === z.id ? 'bg-brand-500/10 ring-1 ring-brand-500/30' : 'hover:bg-slate-900'} group/item`}>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={z.name}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setZones(zones.map(item => item.id === z.id ? { ...item, name: val } : item));
                                    }}
                                    onBlur={() => handleRename(z.id, z.name, 'zone')}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="bg-transparent border-b border-transparent hover:border-slate-800 focus:border-brand-500/50 text-xs text-white/95 font-medium px-1 py-0.5 w-full outline-none transition-colors"
                                  />
                                  <button
                                    onClick={() => setEditingZoneId(editingZoneId === z.id ? null : z.id)}
                                    className={`p-1 rounded transition-colors ${editingZoneId === z.id ? 'text-brand-400 bg-brand-500/10' : 'text-slate-600 hover:text-brand-400 hover:bg-brand-500/10 opacity-0 group-hover/item:opacity-100'}`}
                                    title={editingZoneId === z.id ? 'Done editing shape' : 'Edit shape (drag vertices to resize, drag inside to move)'}
                                  >
                                    <Edit2 size={11} />
                                  </button>
                                  <button
                                    onClick={() => handleRemoveZone(z.id, 'zone')}
                                    className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover/item:opacity-100"
                                    title="Delete Zone"
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap px-1">
                                  <label className="flex items-center gap-1 text-[9px] text-cyan-400 font-semibold cursor-pointer" title="Only detect/track/analyze objects inside this polygon">
                                    <input
                                      type="checkbox"
                                      checked={!!z.roi}
                                      onChange={(e) => handleUpdateZoneField(z.id, 'roi', e.target.checked)}
                                      className="rounded border-slate-800 bg-slate-900 text-cyan-500 focus:ring-cyan-500 w-3 h-3"
                                    />
                                    Detection ROI
                                  </label>
                                  <select
                                    value={z.zoneType || 'intrusion'}
                                    onChange={(e) => handleUpdateZoneField(z.id, 'zoneType', e.target.value)}
                                    className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[9px] text-slate-300 outline-none"
                                    title="Zone type (labels alerts; lane also feeds vehicle lane assignment)"
                                  >
                                    <option value="intrusion">Intrusion</option>
                                    <option value="loitering">Loitering</option>
                                    <option value="lane">Lane</option>
                                  </select>
                                  <label className="flex items-center gap-1 text-[9px] text-slate-500" title="Overcrowding alert threshold">
                                    Max
                                    <input
                                      type="number"
                                      min={1}
                                      value={z.maxOccupancy ?? 5}
                                      onChange={(e) => setZones(zones.map(item => item.id === z.id ? { ...item, maxOccupancy: Number(e.target.value) } : item))}
                                      onBlur={(e) => handleUpdateZoneField(z.id, 'maxOccupancy', Number(e.target.value))}
                                      className="w-9 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[9px] text-white outline-none"
                                    />
                                  </label>
                                  <label className="flex items-center gap-1 text-[9px] text-slate-500" title="Loitering alert threshold (seconds)">
                                    Dwell
                                    <input
                                      type="number"
                                      min={1}
                                      value={z.dwellLimit ?? 10}
                                      onChange={(e) => setZones(zones.map(item => item.id === z.id ? { ...item, dwellLimit: Number(e.target.value) } : item))}
                                      onBlur={(e) => handleUpdateZoneField(z.id, 'dwellLimit', Number(e.target.value))}
                                      className="w-9 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[9px] text-white outline-none"
                                    />
                                    s
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Lines List */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
                          <Navigation size={10} className="text-blue-500/70 rotate-45" />
                          Counting Lines
                        </h4>
                        {lines.length === 0 ? (
                          <p className="text-[10px] text-slate-600 italic px-1">No lines drawn</p>
                        ) : (
                          <div className="space-y-1">
                            {lines.map((l) => (
                              <div key={l.id} className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-slate-900 group/item">
                                <input
                                  type="text"
                                  value={l.name}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setLines(lines.map(item => item.id === l.id ? { ...item, name: val } : item));
                                  }}
                                  onBlur={() => handleRename(l.id, l.name, 'line')}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                  className="bg-transparent border-b border-transparent hover:border-slate-800 focus:border-brand-500/50 text-xs text-white/95 font-medium px-1 py-0.5 w-full outline-none transition-colors"
                                />
                                <button
                                  onClick={() => handleRemoveZone(l.id, 'line')}
                                  className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover/item:opacity-100"
                                  title="Delete Line"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}

                            {lines.length >= 2 && (
                              <div className="mt-1 pt-2 border-t border-slate-800/60 space-y-1.5 px-1">
                                <p className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">
                                  Speed Gate (2-line real distance)
                                </p>
                                {lines.map((l) => (
                                  <div key={`gate_${l.id}`} className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-500 w-16 truncate shrink-0" title={l.name}>{l.name}</span>
                                    <select
                                      value={l.speedPairId || ''}
                                      onChange={(e) => handleUpdateLineField(l.id, 'speedPairId', e.target.value)}
                                      className="flex-1 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-white outline-none"
                                      title="Pair with another line to form a speed gate"
                                    >
                                      <option value="">Not paired</option>
                                      {lines.filter(o => o.id !== l.id).map(o => (
                                        <option key={o.id} value={o.id}>Pair: {o.name}</option>
                                      ))}
                                    </select>
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.1}
                                      placeholder="m"
                                      value={l.distanceM ?? ''}
                                      onChange={(e) => setLines(lines.map(item => item.id === l.id ? { ...item, distanceM: e.target.value === '' ? undefined : Number(e.target.value) } : item))}
                                      onBlur={(e) => handleUpdateLineField(l.id, 'distanceM', e.target.value)}
                                      disabled={!l.speedPairId}
                                      className="w-12 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-white outline-none disabled:opacity-40"
                                      title="Real-world distance to the paired line (meters)"
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      {/* Profiles block */}
                      <div className="p-2.5 rounded-lg bg-slate-900/60 border border-brand-500/10 space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Profiles</span>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            placeholder="New profile name..."
                            value={profileName}
                            onChange={(e) => setProfileName(e.target.value)}
                            className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs text-white outline-none"
                          />
                          <button
                            onClick={saveProfile}
                            className="p-1 bg-brand-500 hover:bg-brand-600 rounded text-white"
                            title="Save current to profile"
                          >
                            <Save size={14} />
                          </button>
                        </div>

                        {savedProfiles.length > 0 && (
                          <div className="space-y-1 pt-1.5">
                            {savedProfiles.map((p) => (
                              <div key={p.id} className="flex items-center justify-between bg-slate-950 p-1.5 rounded text-xs">
                                <span className="font-medium text-white">{p.name}</span>
                                <div className="flex items-center gap-1.5">
                                  <button onClick={() => applyProfile(p.id)} className="text-[10px] text-brand-400 hover:underline">Apply</button>
                                  <button onClick={() => exportProfile(p)} title="Export Profile"><Download size={11} className="text-slate-400 hover:text-white" /></button>
                                  <button onClick={() => deleteProfile(p.id)} title="Delete Profile"><Trash2 size={11} className="text-red-400 hover:text-red-300" /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between pt-1">
                          <label className="flex items-center gap-1 cursor-pointer text-[10px] text-slate-400 hover:text-white">
                            <Upload size={11} />
                            <span>Import Profile</span>
                            <input
                              type="file"
                              accept=".json"
                              onChange={importProfile}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>

                      {/* 26 Checkboxes grouped */}
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">Inference & Bounding Boxes</span>
                          <div className="grid grid-cols-1 gap-1.5 pl-1">
                            {[
                              { label: 'Bounding Box', key: 'showBoundingBox' },
                              { label: 'Segmentation Mask', key: 'showSegmentationMask' },
                              { label: 'Human Detection', key: 'showPerson' },
                              { label: 'Vehicle Detection', key: 'showVehicle' },
                              { label: 'Person ID', key: 'showPersonId' },
                              { label: 'Vehicle ID', key: 'showVehicleId' },
                              { label: 'Class Name', key: 'showClassName' },
                              { label: 'Confidence', key: 'showConfidence' },
                              { label: 'Speed Estimation', key: 'showSpeed' },
                              { label: 'Direction Arrow', key: 'showDirectionArrow' },
                              { label: 'Motion Trail', key: 'showMotionTrail' },
                              { label: 'Tracking Path', key: 'showTrackingPath' }
                            ].map((item) => (
                              <label key={item.key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!(settings as any)[item.key]}
                                  onChange={(e) => setSettings({ ...settings, [item.key]: e.target.checked })}
                                  className="rounded border-slate-800 bg-slate-900 text-brand-500 focus:ring-brand-500"
                                />
                                <span>{item.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">Analytics Zones & Lines</span>
                          <div className="grid grid-cols-1 gap-1.5 pl-1">
                            {[
                              { label: 'Zone Name Label', key: 'showZoneName' },
                              { label: 'Zone Border Lines', key: 'showZoneBorder' },
                              { label: 'Zone Fill Area', key: 'showZoneFill' },
                              { label: 'Line Crossing Stats', key: 'showLineCrossingStatus' },
                              { label: 'Intrusion Status Alert', key: 'showIntrusionStatus' },
                              { label: 'Loitering Timers', key: 'showLoiteringTimer' },
                              { label: 'Person Counts', key: 'showPersonCount' },
                              { label: 'Vehicle Counts', key: 'showVehicleCount' }
                            ].map((item) => (
                              <label key={item.key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!(settings as any)[item.key]}
                                  onChange={(e) => setSettings({ ...settings, [item.key]: e.target.checked })}
                                  className="rounded border-slate-800 bg-slate-900 text-brand-500 focus:ring-brand-500"
                                />
                                <span>{item.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">HUD & Telemetry Info</span>
                          <div className="grid grid-cols-1 gap-1.5 pl-1">
                            {[
                              { label: 'Camera FPS Display', key: 'showCameraFps' },
                              { label: 'AI Inference FPS', key: 'showAiFps' },
                              { label: 'Pipeline Latency', key: 'showLatency' },
                              { label: 'Local Timestamp', key: 'showTimestamp' },
                              { label: 'Camera Name Display', key: 'showCameraName' },
                              { label: 'Activity Heatmap', key: 'showHeatmap' },
                              { label: 'Active Event Labels', key: 'showEventLabels' },
                              { label: 'Recording Status Dot', key: 'showRecordingStatus' }
                            ].map((item) => (
                              <label key={item.key} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!(settings as any)[item.key]}
                                  onChange={(e) => setSettings({ ...settings, [item.key]: e.target.checked })}
                                  className="rounded border-slate-800 bg-slate-900 text-brand-500 focus:ring-brand-500"
                                />
                                <span>{item.label}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Customization Sliders / Colors */}
                      <div className="space-y-3 pt-3 border-t border-slate-900">
                        <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">Custom Styling</span>
                        
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-400">
                            <span>TRANSPARENCY</span>
                            <span>{settings.transparency.toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min="0.0"
                            max="1.0"
                            step="0.05"
                            value={settings.transparency}
                            onChange={(e) => setSettings({ ...settings, transparency: parseFloat(e.target.value) })}
                            className="w-full h-1 bg-slate-900 rounded appearance-none cursor-pointer accent-brand-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-400">
                            <span>BORDER WIDTH</span>
                            <span>{settings.borderWidth}px</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="6"
                            step="1"
                            value={settings.borderWidth}
                            onChange={(e) => setSettings({ ...settings, borderWidth: parseInt(e.target.value) })}
                            className="w-full h-1 bg-slate-900 rounded appearance-none cursor-pointer accent-brand-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-slate-400">
                            <span>FONT SIZE</span>
                            <span>{settings.fontSize}px</span>
                          </div>
                          <input
                            type="range"
                            min="8"
                            max="18"
                            step="1"
                            value={settings.fontSize}
                            onChange={(e) => setSettings({ ...settings, fontSize: parseInt(e.target.value) })}
                            className="w-full h-1 bg-slate-900 rounded appearance-none cursor-pointer accent-brand-500"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400">LABEL STYLE</label>
                          <select
                            value={settings.labelStyle}
                            onChange={(e) => setSettings({ ...settings, labelStyle: e.target.value as any })}
                            className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white outline-none"
                          >
                            <option value="solid">Solid Background</option>
                            <option value="transparent">Transparent Dark</option>
                            <option value="outline">Text Outline Only</option>
                          </select>
                        </div>

                        {/* Colors selection */}
                        <div className="space-y-2 pt-2 border-t border-slate-900">
                          <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">Color Palette</span>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: 'Bounding Box', key: 'boundingBox' },
                              { label: 'Seg Mask', key: 'segmentationMask' },
                              { label: 'Person ID', key: 'personId' },
                              { label: 'Vehicle ID', key: 'vehicleId' },
                              { label: 'Class Name', key: 'className' },
                              { label: 'Confidence', key: 'confidence' },
                              { label: 'Speed Label', key: 'speed' },
                              { label: 'HUD Text', key: 'hudText' },
                              { label: 'Zone Border', key: 'zoneBorder' },
                              { label: 'Zone Fill', key: 'zoneFill' },
                              { label: 'Heatmap', key: 'heatmap' }
                            ].map((c) => (
                              <div key={c.key} className="space-y-1">
                                <label className="text-[8px] font-bold text-slate-400 block truncate">{c.label}</label>
                                <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded px-1 py-0.5">
                                  <input
                                    type="color"
                                    value={(settings.colors as any)[c.key]}
                                    onChange={(e) => setSettings({
                                      ...settings,
                                      colors: { ...settings.colors, [c.key]: e.target.value }
                                    })}
                                    className="w-4 h-4 bg-transparent border-0 rounded cursor-pointer"
                                  />
                                  <span className="text-[8px] font-mono text-slate-500 uppercase truncate">{(settings.colors as any)[c.key]}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Control Drawer Footer */}
      <div className="flex items-center gap-2 p-2 bg-slate-950/80 border-t border-brand-500/10">
        {/* Draw tools */}
        {drawMode === 'none' ? (
          <>
            <button
              onClick={() => { setEditingZoneId(null); setDrawMode('zone'); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/20"
            >
              <ShieldAlert size={13} />
              + Zone
            </button>
            <button
              onClick={() => { setEditingZoneId(null); setDrawMode('line'); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-400 hover:bg-blue-500/10 transition-colors border border-blue-500/20"
            >
              <Navigation size={13} />
              + Line
            </button>

            {/* Screen share controls */}
            {cameraType === 'screenshare' && isSharing && (
              <button
                onClick={stopScreenShare}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-red-400 hover:bg-red-500/10 transition-colors border border-red-500/20"
              >
                <X size={12} />
                Stop Share
              </button>
            )}

            {/* Toggle layers */}
            <button
              onClick={() => setSettings({ ...settings, showSegmentationMask: !settings.showSegmentationMask })}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors ml-auto ${settings.showSegmentationMask ? 'text-brand-400' : 'text-slate-500'}`}
            >
              {settings.showSegmentationMask ? <Eye size={13} /> : <EyeOff size={13} />}
              Seg
            </button>
            <button
              onClick={() => setSettings({ ...settings, showTrackingPath: !settings.showTrackingPath })}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-colors ${settings.showTrackingPath ? 'text-brand-400' : 'text-slate-500'}`}
            >
              {settings.showTrackingPath ? <Eye size={13} /> : <EyeOff size={13} />}
              Path
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 w-full justify-between">
            <span className="text-xs text-brand-300 animate-pulse font-medium">
              Click to place {drawMode === 'zone' ? 'polygon vertices' : 'line endpoints'}...
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearDrawing}
                disabled={points.length === 0}
                className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-xs font-semibold disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={handleSaveDrawing}
                disabled={drawMode === 'zone' ? points.length < 3 : points.length < 2}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-40"
              >
                <Check size={13} />
                Save
              </button>
              <button
                onClick={() => {
                  setPoints([]);
                  setDrawMode('none');
                }}
                className="flex items-center gap-1 px-2 py-1 rounded bg-red-500 hover:bg-red-600 text-white text-xs font-bold"
              >
                <X size={13} />
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Config Panel Toggle Button */}
        {drawMode === 'none' && (
          <button
            onClick={() => setShowConfigPanel(!showConfigPanel)}
            className={`p-1.5 rounded-lg border ml-1 transition-colors ${
              showConfigPanel
                ? 'bg-brand-500/20 text-brand-400 border-brand-500/30'
                : 'text-slate-400 hover:text-white border-transparent hover:bg-slate-800'
            }`}
            title="Toggle Analytics Config"
          >
            <Settings size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
