import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Monitor,
  Camera,
  Video,
  Play,
  Square,
  Activity,
  Clock,
  Users,
  Zap,
  Layers,
  Settings,
  Eye,
  EyeOff,
  AlertTriangle,
  Info,
  Car,
  ShieldAlert,
  Navigation,
  Trash2,
  Save,
  Upload,
  Download,
  Paintbrush
} from 'lucide-react';
import axios from 'axios';
import { useTelemetry, useCameraTelemetry } from '../contexts/TelemetryContext';
import { Header } from '../components/layout/Header';
import { OverlaySettings, OverlayProfile } from '../types';

interface CameraProfile {
  id: string;
  name: string;
  type: string;
  source: string;
  is_active: number;
}

interface AnalyticsShape {
  id: string;
  name: string;
  points: number[][];
  shapeType?: 'polygon' | 'rectangle' | 'circle' | 'freehand';
  zoneType?: 'intrusion' | 'restricted' | 'danger' | 'safe' | 'parking' | 'entry' | 'exit' | 'waiting' | 'loading' | 'custom';
  lineType?: 'entry_counting' | 'exit_counting' | 'bidirectional' | 'one_way' | 'reverse_direction' | 'crossing';
  color?: string;
  borderWidth?: number;
  opacity?: number;
  dashed?: boolean;
  showFill?: boolean;
  showBorder?: boolean;
  showLabel?: boolean;
  locked?: boolean;
  direction?: 'bidirectional' | 'one_way' | 'reverse';
  maxOccupancy?: number;
  dwellLimit?: number;
}

interface AnalyticsTemplate {
  id: string;
  name: string;
  zones: AnalyticsShape[];
  lines: AnalyticsShape[];
}

const ANALYTICS_CONFIG_STORAGE_KEY = 'camai:screenshare-analytics-configs';
const ANALYTICS_TEMPLATES_STORAGE_KEY = 'camai:screenshare-analytics-templates';

function getStorageKey() {
  return ANALYTICS_CONFIG_STORAGE_KEY;
}

function normalizeZone(zone: Partial<AnalyticsShape>, index: number): AnalyticsShape {
  return {
    id: zone.id ?? generateId(),
    name: zone.name ?? `Zone ${index + 1}`,
    points: zone.points ?? [],
    shapeType: zone.shapeType ?? 'polygon',
    zoneType: zone.zoneType ?? 'intrusion',
    color: zone.color ?? '#ef4444',
    borderWidth: zone.borderWidth ?? 2,
    opacity: zone.opacity ?? 0.25,
    dashed: zone.dashed ?? false,
    showFill: zone.showFill ?? true,
    showBorder: zone.showBorder ?? true,
    showLabel: zone.showLabel ?? true,
    locked: zone.locked ?? false,
    maxOccupancy: zone.maxOccupancy ?? 8,
    dwellLimit: zone.dwellLimit ?? 10,
  };
}

function normalizeLine(line: Partial<AnalyticsShape>, index: number): AnalyticsShape {
  return {
    id: line.id ?? generateId(),
    name: line.name ?? `Line ${index + 1}`,
    points: line.points ?? [],
    lineType: line.lineType ?? 'crossing',
    color: line.color ?? '#3b82f6',
    borderWidth: line.borderWidth ?? 3,
    opacity: line.opacity ?? 1.0,
    dashed: line.dashed ?? false,
    showFill: line.showFill ?? false,
    showBorder: line.showBorder ?? true,
    showLabel: line.showLabel ?? true,
    locked: line.locked ?? false,
    direction: line.direction ?? 'bidirectional',
  };
}

function generateId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);
}

export default function ScreenShareDetection() {
  const navigate = useNavigate();
  const { sendMessage, isConnected, worker, profiling } = useTelemetry() as any;

  // Active source selection
  const [activeTab, setActiveTab] = useState<'webcam' | 'screenshare' | 'rtsp'>('screenshare');

  // RTSP camera list and selection
  const [rtspCameras, setRtspCameras] = useState<CameraProfile[]>([]);
  const [selectedRtspId, setSelectedRtspId] = useState<string>('');

  // Local media stream states
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Toggle visualization layers via unified OverlaySettings
  const [activeSidebarTab, setActiveSidebarTab] = useState<'hud_analytics' | 'overlays'>('hud_analytics');
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

  // Analytics drawing state
  const [drawMode, setDrawMode] = useState<'none' | 'zone' | 'line'>('none');
  const [drawPoints, setDrawPoints] = useState<number[][]>([]);
  const [zones, setZones] = useState<AnalyticsShape[]>([]);
  const [lines, setLines] = useState<AnalyticsShape[]>([]);
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(true);
  const [templates, setTemplates] = useState<AnalyticsTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Performance metrics (measured on client)
  const [cameraFps, setCameraFps] = useState<number>(0);
  const [processingTime, setProcessingTime] = useState<number>(0);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const isProcessingRef = useRef<boolean>(false);
  const canvasTransferredRef = useRef<boolean>(false);
  const deregisterTimeoutRef = useRef<number | null>(null);

  // Fetch configured RTSP/USB cameras
  useEffect(() => {
    const fetchCameras = async () => {
      try {
        const { data } = await axios.get<CameraProfile[]>('/api/cameras');
        const filtered = data.filter((c) => c.type !== 'screenshare');
        setRtspCameras(filtered);
        if (filtered.length > 0) {
          setSelectedRtspId(filtered[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch cameras:', err);
      }
    };
    fetchCameras();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(ANALYTICS_TEMPLATES_STORAGE_KEY);
    if (saved) {
      try {
        setTemplates(JSON.parse(saved));
      } catch (err) {
        console.warn('Unable to parse saved analytics templates', err);
      }
    }
  }, []);

  // Determine current camera ID for telemetry and frame pushing
  const getCameraId = useCallback(() => {
    if (activeTab === 'webcam') return 'live_webcam';
    if (activeTab === 'screenshare') return 'live_screenshare';
    return selectedRtspId;
  }, [activeTab, selectedRtspId]);

  const currentCameraId = getCameraId();
  const activeTelemetry = useCameraTelemetry(currentCameraId);

  useEffect(() => {
    if (!currentCameraId) return;
    try {
      const saved = localStorage.getItem(getStorageKey());
      const configs = saved ? JSON.parse(saved) : {};
      const savedConfig = configs[currentCameraId];
      if (savedConfig) {
        setZones((savedConfig.zones || []).map((zone: Partial<AnalyticsShape>, idx: number) => normalizeZone(zone, idx)));
        setLines((savedConfig.lines || []).map((line: Partial<AnalyticsShape>, idx: number) => normalizeLine(line, idx)));
      } else {
        setZones([]);
        setLines([]);
      }
    } catch (err) {
      console.warn('Unable to load analytics config from localStorage', err);
    }
  }, [currentCameraId]);

  // Reset isProcessing when telemetry updates
  useEffect(() => {
    isProcessingRef.current = false;
    if (activeTelemetry && lastFrameTimeRef.current > 0) {
      setProcessingTime(Date.now() - lastFrameTimeRef.current);
    }
  }, [activeTelemetry]);

  // Register canvas with the Web Worker once on mount, deregister on
  // unmount (navigating away from this page) so the worker's canvas/context/
  // subscription maps don't accumulate one stale "screenshare_detection_view"
  // entry per visit — see the matching fix in CCTVPlayer.tsx for why this
  // matters for the render loop's per-frame cost and WS subscription count.
  //
  // canvas.transferControlToOffscreen() can only be called ONCE per <canvas>
  // element — a second call throws and permanently breaks rendering. React
  // 18 StrictMode double-invokes this effect in dev (mount -> cleanup ->
  // mount, same DOM node) specifically to catch non-reentrant effects like
  // this, so canvasTransferredRef must never be reset to false, and the
  // deregister is deferred so a StrictMode remount can cancel it before it
  // ever reaches the worker.
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
          viewportId: 'screenshare_detection_view',
          canvas: offscreen
        }, [offscreen]);
        canvasTransferredRef.current = true;
        console.log('[ScreenShare] Canvas successfully transferred to Web Worker');
      } catch (err) {
        console.error('[ScreenShare] Failed to transfer canvas to OffscreenCanvas:', err);
      }
    }

    return () => {
      if (worker && canvasTransferredRef.current) {
        deregisterTimeoutRef.current = window.setTimeout(() => {
          deregisterTimeoutRef.current = null;
          worker.postMessage({ type: 'deregister', viewportId: 'screenshare_detection_view' });
        }, 0);
      }
    };
  }, [worker]);

  // Associate canvas viewport with the active camera ID
  useEffect(() => {
    if (worker && currentCameraId) {
      worker.postMessage({
        type: 'associate_camera',
        viewportId: 'screenshare_detection_view',
        cameraId: currentCameraId
      });
    }
  }, [worker, currentCameraId]);

  // Post display configs to Web Worker
  const persistAnalyticsConfig = useCallback(async (updatedZones: AnalyticsShape[], updatedLines: AnalyticsShape[]) => {
    if (!currentCameraId) return;

    try {
      const stored = localStorage.getItem(getStorageKey());
      const configs = stored ? JSON.parse(stored) : {};
      configs[currentCameraId] = { zones: updatedZones, lines: updatedLines };
      localStorage.setItem(getStorageKey(), JSON.stringify(configs));
    } catch (err) {
      console.warn('Unable to persist analytics config to localStorage', err);
    }

    if (currentCameraId) {
      try {
        await axios.post(`/api/cameras/${currentCameraId}/config`, {
          zones: JSON.stringify(updatedZones),
          lines: JSON.stringify(updatedLines)
        });
      } catch (err) {
        console.error('Unable to persist analytics config to backend', err);
      }
    }
  }, [activeTab, currentCameraId, selectedRtspId]);

  // Load profiles from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('screenshare_overlay_profiles');
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
    localStorage.setItem('screenshare_overlay_profiles', JSON.stringify(updated));
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
    localStorage.setItem('screenshare_overlay_profiles', JSON.stringify(updated));
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
          localStorage.setItem('screenshare_overlay_profiles', JSON.stringify(updated));
          setSettings(parsed.settings);
        }
      } catch (err) {
        alert('Invalid profile JSON format.');
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (worker && currentCameraId) {
      worker.postMessage({
        type: 'update_config',
        cameraId: currentCameraId,
        config: {
          zones,
          lines,
          ...settings
        }
      });
    }
  }, [worker, currentCameraId, zones, lines, settings]);

  useEffect(() => {
    if (worker && currentCameraId) {
      worker.postMessage({
        type: 'update_draw_preview',
        cameraId: currentCameraId,
        drawMode,
        points: drawPoints
      });
    }
  }, [worker, currentCameraId, drawMode, drawPoints]);

  useEffect(() => {
    if (currentCameraId) {
      persistAnalyticsConfig(zones, lines);
    }
  }, [currentCameraId, zones, lines, persistAnalyticsConfig]);

  // Monitor resize and notify Web Worker
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worker) return;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        worker.postMessage({
          type: 'resize',
          viewportId: 'screenshare_detection_view',
          width: parent.clientWidth,
          height: parent.clientHeight
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    handleResize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [worker, activeTab, isCapturing]);

  // Stop local media stream
  const stopMediaStream = useCallback(() => {
    const refVal: any = frameIntervalRef.current;
    if (refVal) {
      // support both timeout object and our stored handles
      if (typeof refVal === 'number') {
        clearTimeout(refVal);
      } else {
        if (refVal.rafId) cancelAnimationFrame(refVal.rafId);
        if (refVal.cancelHandle && videoRef.current && typeof (videoRef.current as any).cancelVideoFrameCallback === 'function') {
          try { (videoRef.current as any).cancelVideoFrameCallback(refVal.cancelHandle); } catch (e) {}
        }
      }
      frameIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
    setCameraFps(0);
    isProcessingRef.current = false;
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch (e) {}
    }
    if (worker) {
      try { worker.postMessage({ type: 'clear_pending_frames' }); } catch (e) {}
    }
    console.log('[ScreenShare] Stopped media stream for', activeTab);
  }, []);

  const clearDrawing = () => {
    setDrawPoints([]);
    setDrawMode('none');
  };

  const saveDrawing = () => {
    if (drawMode === 'zone' && drawPoints.length >= 3) {
      const nextZone = normalizeZone({
        id: generateId(),
        name: `Zone ${zones.length + 1}`,
        points: drawPoints
      }, zones.length);
      setZones((prev) => [...prev, nextZone]);
      clearDrawing();
    }

    if (drawMode === 'line' && drawPoints.length >= 2) {
      const nextLine = normalizeLine({
        id: generateId(),
        name: `Line ${lines.length + 1}`,
        points: drawPoints.slice(0, 2)
      }, lines.length);
      setLines((prev) => [...prev, nextLine]);
      clearDrawing();
    }
  };

  const removeShape = (id: string, type: 'zone' | 'line') => {
    if (type === 'zone') {
      setZones((prev) => prev.filter((item) => item.id !== id));
    } else {
      setLines((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const renameShape = (id: string, value: string, type: 'zone' | 'line') => {
    if (type === 'zone') {
      setZones((prev) => prev.map((item) => (item.id === id ? { ...item, name: value } : item)));
    } else {
      setLines((prev) => prev.map((item) => (item.id === id ? { ...item, name: value } : item)));
    }
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (drawMode === 'none' || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const rawX = event.clientX - bounds.left;
    const rawY = event.clientY - bounds.top;
    const normalized: [number, number] = [
      Math.min(1, Math.max(0, rawX / bounds.width)),
      Math.min(1, Math.max(0, rawY / bounds.height))
    ];

    setDrawPoints((current) => {
      if (drawMode === 'zone') {
        return [...current, normalized];
      }
      if (drawMode === 'line') {
        if (current.length === 0) {
          return [normalized];
        }
        if (current.length === 1) {
          return [current[0], normalized];
        }
        return [normalized];
      }
      return current;
    });
  };

  const handleRightClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (drawMode === 'none') return;
    event.preventDefault();
    setDrawPoints((current) => current.slice(0, -1));
  };

  const clearAllAnalytics = () => {
    setZones([]);
    setLines([]);
  };

  const saveTemplate = () => {
    const template: AnalyticsTemplate = {
      id: generateId(),
      name: `Template ${templates.length + 1}`,
      zones,
      lines
    };
    const nextTemplates = [template, ...templates];
    setTemplates(nextTemplates);
    localStorage.setItem(ANALYTICS_TEMPLATES_STORAGE_KEY, JSON.stringify(nextTemplates));
    setSelectedTemplateId(template.id);
  };

  const loadTemplate = (templateId: string) => {
    const match = templates.find((template) => template.id === templateId);
    if (!match) return;
    setZones(match.zones);
    setLines(match.lines);
  };

  const exportConfig = () => {
    const payload = {
      source: currentCameraId,
      zones,
      lines,
      exported_at: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `camai_analytics_${currentCameraId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed.zones && parsed.lines) {
        setZones(parsed.zones);
        setLines(parsed.lines);
      }
    } catch (err) {
      console.warn('Invalid analytics config file', err);
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  };

  const currentShapeCount = zones.length + lines.length;

  // Start capture for Webcam or Screen Share
  const startMediaStream = async () => {
    setError(null);
    stopMediaStream();

    try {
      let stream: MediaStream;
      if (activeTab === 'screenshare') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          },
          audio: false
        });

        stream.getVideoTracks()[0].onended = () => {
          stopMediaStream();
          navigate('/');
        };
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
            frameRate: { ideal: 30 }
          },
          audio: false
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => {
          console.error('Error playing media video:', err);
        });
      }
      setIsCapturing(true);
      // Use requestVideoFrameCallback when available for efficient frame timing.
      // `handles` is written into frameIntervalRef.current *before* the loop
      // starts, then mutated in place on every tick — stopMediaStream reads
      // the same object, so it always sees the most recently scheduled
      // handle. (A previous version captured cancelHandle/rafId into a fresh
      // `{ cancelHandle, rafId }` snapshot *after* starting the loop, so it
      // only ever held the very first, long-since-fired handle — cancelling
      // it was a no-op and the frame loop kept running forever after
      // "stopping" capture, switching tabs, or navigating away.)
      const handles: { cancelHandle: number | null; rafId: number | null } = { cancelHandle: null, rafId: null };
      (frameIntervalRef as any).current = handles;

      const postBitmapToWorker = async (bmp: ImageBitmap) => {
        try {
          if (worker) {
            worker.postMessage({ type: 'screen_frame_bitmap', cameraId: getCameraId(), bitmap: bmp }, [bmp]);
          } else {
            // Fallback: encode on main thread (rare)
            const off = document.createElement('canvas');
            off.width = bmp.width; off.height = bmp.height;
            const ctx = off.getContext('2d');
            if (ctx) ctx.drawImage(bmp, 0, 0);
            try { bmp.close(); } catch (e) {}
            off.toBlob((blob) => {
              if (!blob) return;
              const reader = new FileReader();
              reader.onloadend = () => {
                const dataUrl = reader.result as string;
                sendMessage({ type: 'screen_frame', camera_id: getCameraId(), frame: dataUrl });
              };
              reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.7);
          }
        } catch (err) {
          try { bmp.close(); } catch (e) {}
        }
      };

      const handleVideoFrame = () => {
        const video = videoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        // Gate on isProcessingRef (cleared once telemetry for this frame comes
        // back — see the effect above) so createImageBitmap/postMessage never
        // run faster than the AI can keep up. Without this check, a slow AI
        // path piles up overlapping in-flight bitmaps every rVFC/rAF tick —
        // uncapped CPU/memory growth over a long-running session.
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;
        // Create bitmap (non-blocking) and post to worker; worker will drop older frames
        createImageBitmap(video).then((bmp) => {
          postBitmapToWorker(bmp);
        }).catch(() => {
          isProcessingRef.current = false;
        });
      };

      if (videoRef.current && typeof (videoRef.current as any).requestVideoFrameCallback === 'function') {
        const rvfc = (videoRef.current as any).requestVideoFrameCallback.bind(videoRef.current);
        const loop = () => {
          try { handleVideoFrame(); } catch (e) {}
          // schedule next
          handles.cancelHandle = rvfc((now: number, meta: any) => {
            loop();
          });
        };
        loop();
      } else {
        // Fallback to requestAnimationFrame driven loop
        const rafLoop = () => {
          handleVideoFrame();
          handles.rafId = requestAnimationFrame(rafLoop);
        };
        handles.rafId = requestAnimationFrame(rafLoop);
      }

    } catch (err: any) {
      console.error('Error starting media capture:', err);
      const msg = err instanceof Error ? err.message : 'Permission denied or media unavailable.';
      setError(msg);
      setIsCapturing(false);
    }
  };

  // Switch tabs -> stop running capture streams
  useEffect(() => {
    stopMediaStream();
    setError(null);
  }, [activeTab, stopMediaStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMediaStream();
    };
  }, [stopMediaStream]);

  // Local Camera preview FPS counter (measured client-side)
  useEffect(() => {
    if (!isCapturing || activeTab === 'rtsp') return;

    let frameCount = 0;
    let lastTime = performance.now();
    let animationFrameId: number;

    const countFrames = () => {
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setCameraFps(Math.round((frameCount * 1000) / (now - lastTime)));
        frameCount = 0;
        lastTime = now;
      }
      animationFrameId = requestAnimationFrame(countFrames);
    };

    animationFrameId = requestAnimationFrame(countFrames);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [isCapturing, activeTab]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
      <Header title="Screen Share Detection" subtitle="Asynchronous AI Human Segmentation & Tracking" />

      {/* Main Container */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        
        {/* Viewport Section */}
        <div className="flex-1 flex flex-col p-6 min-w-0 h-full">
          
          {/* Tab selector */}
          <div className="flex items-center gap-2 mb-4 bg-slate-900/60 p-1.5 rounded-xl border border-brand-500/10 w-fit">
            <button
              onClick={() => setActiveTab('screenshare')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'screenshare' ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor size={14} />
              Screen Share
            </button>
            <button
              onClick={() => setActiveTab('webcam')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'webcam' ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Camera size={14} />
              Webcam Share
            </button>
            <button
              onClick={() => setActiveTab('rtsp')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'rtsp' ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Video size={14} />
              RTSP Camera Feed
            </button>
          </div>

          {/* Alert messages */}
          {error && (
            <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs text-red-400 bg-red-500/10 border border-red-500/20">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Sub-selector for RTSP Camera */}
          {activeTab === 'rtsp' && rtspCameras.length > 0 && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-slate-400">Select Network Camera:</span>
              <select
                value={selectedRtspId}
                onChange={(e) => setSelectedRtspId(e.target.value)}
                className="bg-slate-900 border border-brand-500/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand-500"
              >
                {rtspCameras.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.name} ({cam.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Main Display Port */}
          <div className="flex-1 relative bg-black rounded-2xl overflow-hidden border border-brand-500/10 flex items-center justify-center">
            
            {/* 1. Client Video Element (Webcam/Screenshare) */}
            {(activeTab === 'screenshare' || activeTab === 'webcam') && (
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-contain"
                style={{ display: isCapturing ? 'block' : 'none' }}
              />
            )}

            {/* 2. Server MJPEG Stream (RTSP Camera) */}
            {activeTab === 'rtsp' && selectedRtspId && (
              <img
                src={`/api/cameras/${selectedRtspId}/stream`}
                alt="RTSP Live Stream"
                className="w-full h-full object-contain"
              />
            )}

            {/* Canvas Overlay for YOLO Segmented Masks / Bboxes (Managed by Web Worker) */}
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
            />

            {drawMode !== 'none' && (
              <div
                className="absolute inset-0 z-20 pointer-events-auto"
                onClick={handleCanvasClick}
                onContextMenu={handleRightClick}
              />
            )}

            {/* Hidden capture canvas (640x480) */}
            <canvas
              ref={hiddenCanvasRef}
              width={640}
              height={480}
              className="hidden"
            />

            {/* Prompter overlays for starting streams */}
            {!isCapturing && (activeTab === 'screenshare' || activeTab === 'webcam') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 p-6 text-center">
                <div className="w-16 h-16 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-4 text-brand-400">
                  {activeTab === 'screenshare' ? <Monitor size={30} /> : <Camera size={30} />}
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5">
                  {activeTab === 'screenshare' ? 'Screen Capture Source' : 'Webcam Capture Source'}
                </h3>
                <p className="text-[11px] text-slate-400 max-w-xs mb-5">
                  {activeTab === 'screenshare'
                    ? 'Share your screen, window, or browser tab to run YOLO11n human tracking on that feed.'
                    : 'Use your device camera feed to analyze human motion in real-time.'}
                </p>
                <button
                  onClick={startMediaStream}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 rounded-xl text-xs font-bold text-white shadow-lg transition-transform hover:scale-105"
                >
                  <Play size={13} />
                  {activeTab === 'screenshare' ? 'Share Screen' : 'Start Camera'}
                </button>
              </div>
            )}
          </div>

          {/* Action buttons footer */}
          {isCapturing && (activeTab === 'screenshare' || activeTab === 'webcam') && (
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={stopMediaStream}
                className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-xl text-xs font-bold text-white shadow-lg transition-all"
              >
                <Square size={13} />
                {activeTab === 'screenshare' ? 'Stop Screen Share' : 'Stop Camera'}
              </button>

              <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Streaming Local Frame Buffer</span>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Controls & Stats */}
        <div className="w-80 border-l border-brand-500/10 flex flex-col h-full bg-slate-950/40 overflow-y-auto">
          
          {/* Performance HUD Badges */}
          <div className="p-5 border-b border-brand-500/10 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
              <Activity size={13} className="text-cyan-400" />
              Live Performance HUD
            </h3>

            <div className="grid grid-cols-1 gap-2.5">
              <HUDMetric
                icon={<Camera size={14} />}
                label="Camera preview FPS"
                value={activeTab === 'rtsp' ? '—' : `${cameraFps} Hz`}
                color="#06b6d4"
              />
              <HUDMetric
                icon={<Activity size={14} />}
                label="AI Inference FPS"
                value={activeTelemetry ? `${activeTelemetry.fps} Hz` : '0 Hz'}
                color="#10b981"
              />
              <HUDMetric
                icon={<Clock size={14} />}
                label="Detection Latency"
                value={activeTelemetry ? `${activeTelemetry.latency} ms` : '0 ms'}
                color="#a5b4fc"
              />
              <HUDMetric
                icon={<Zap size={14} />}
                label="Total Processing Time"
                value={activeTab === 'rtsp' ? '—' : `${processingTime} ms`}
                color="#fbbf24"
              />
              <HUDMetric
                icon={<Users size={14} />}
                label="Humans Detected"
                value={activeTelemetry ? String(activeTelemetry.people) : '0'}
                color={(activeTelemetry?.people ?? 0) > 0 ? '#f43f5e' : '#64748b'}
              />
              <HUDMetric
                icon={<Car size={14} />}
                label="Vehicles Detected"
                value={activeTelemetry?.vehicles !== undefined ? String(activeTelemetry.vehicles) : '0'}
                color={activeTelemetry?.vehicles && activeTelemetry.vehicles > 0 ? '#10b981' : '#64748b'}
              />
            </div>
          </div>

          {/* Detailed Pipeline Profiling HUD */}
          {activeTelemetry && (
            <div className="p-5 border-b border-brand-500/10 space-y-3 bg-slate-900/15">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
                <Settings size={13} className="text-amber-400" />
                Pipeline Execution Profile
              </h3>
              <div className="space-y-1.5 text-[11px] font-mono text-slate-400">
                <div className="flex justify-between">
                  <span>Camera Grab / FPS:</span>
                  <span className="text-white font-bold">{activeTelemetry.camera_fps ?? 30.0} Hz</span>
                </div>
                <div className="flex justify-between">
                  <span>OpenCV Decode FPS:</span>
                  <span className="text-white font-bold">{activeTelemetry.decode_fps ?? activeTelemetry.camera_fps ?? 30.0} Hz</span>
                </div>
                <div className="flex justify-between">
                  <span>YOLO Inference FPS:</span>
                  <span className="text-emerald-400 font-bold">{activeTelemetry.inference_fps ?? activeTelemetry.fps} Hz</span>
                </div>
                <div className="flex justify-between">
                  <span>ByteTrack Tracking FPS:</span>
                  <span className="text-cyan-400 font-bold">{activeTelemetry.tracking_fps ?? activeTelemetry.fps} Hz</span>
                </div>
                <div className="flex justify-between">
                  <span>CPU Usage:</span>
                  <span className="text-amber-400 font-bold">{activeTelemetry.cpu ?? 0.0}%</span>
                </div>
                <div className="flex justify-between">
                  <span>RAM Usage:</span>
                  <span className="text-amber-400 font-bold">{activeTelemetry.memory ?? 0.0}%</span>
                </div>
                <div className="flex justify-between">
                  <span>GPU Usage:</span>
                  <span className="text-amber-400 font-bold">{activeTelemetry.gpu ?? 0.0}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Worker Encode (ms):</span>
                  <span className="text-white font-bold">{profiling && currentCameraId && profiling[currentCameraId] ? Math.round(profiling[currentCameraId].encode_ms) : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Worker Send (ms):</span>
                  <span className="text-white font-bold">{profiling && currentCameraId && profiling[currentCameraId] ? Math.round(profiling[currentCameraId].send_ms) : '—'}</span>
                </div>
                <div className="h-[1px] bg-slate-800 my-1.5" />
                <div className="flex justify-between text-brand-300 font-bold">
                  <span>Detection Latency:</span>
                  <span>{activeTelemetry.latency} ms</span>
                </div>
              </div>
            </div>
          )}

          {/* Active Tracked Objects */}
          {activeTelemetry && activeTelemetry.detections && activeTelemetry.detections.length > 0 && (
            <div className="p-5 border-b border-brand-500/10 space-y-3 bg-slate-900/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
                <Eye size={13} className="text-brand-400" />
                Currently Tracked ({activeTelemetry.detections.length})
              </h3>
              <div className="max-h-48 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
                {activeTelemetry.detections.map((det: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-slate-900/40 border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        det.class === 'person' ? 'bg-indigo-400' :
                        ['car', 'truck', 'bus'].includes(det.class) ? 'bg-cyan-400' :
                        ['motorcycle', 'bicycle'].includes(det.class) ? 'bg-emerald-400' : 'bg-pink-400'
                      }`} />
                      <span className="text-white capitalize font-semibold">{det.class}</span>
                      {det.track_id !== null && (
                        <span className="text-[10px] bg-slate-800 text-brand-300 px-1.5 py-0.5 rounded font-bold">
                          ID: {det.track_id}
                        </span>
                      )}
                    </div>
                    <div className="text-slate-400 flex items-center gap-2 text-[10px]">
                      <span>{Math.round(det.confidence * 100)}%</span>
                      {det.speed !== undefined && (
                        <span className="text-amber-400 font-bold">{det.speed.toFixed(1)} km/h</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Setting Config Toggles & Overlay Manager */}
          <div className="flex border-b border-brand-500/10">
            <button
              onClick={() => setActiveSidebarTab('hud_analytics')}
              className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors ${
                activeSidebarTab === 'hud_analytics'
                  ? 'border-brand-500 text-brand-400 bg-slate-900/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              HUD & Shapes
            </button>
            <button
              onClick={() => setActiveSidebarTab('overlays')}
              className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition-colors ${
                activeSidebarTab === 'overlays'
                  ? 'border-brand-500 text-brand-400 bg-slate-900/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Overlay Manager
            </button>
          </div>

          <div className="flex-1 p-5 space-y-5">
            {activeSidebarTab === 'hud_analytics' ? (
              <>
                <div className="p-4 bg-slate-900/50 rounded-2xl border border-brand-500/10 space-y-3">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400 uppercase tracking-[0.24em]">
                    <span className="flex items-center gap-2 text-brand-300">
                      <Paintbrush size={12} /> Analytics Shapes
                    </span>
                    <span className="text-slate-500">{currentShapeCount} total</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setDrawMode('zone')}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11px] font-semibold transition ${drawMode === 'zone' ? 'bg-red-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      <ShieldAlert size={12} />
                      Add Zone
                    </button>
                    <button
                      onClick={() => setDrawMode('line')}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-[11px] font-semibold transition ${drawMode === 'line' ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      <Navigation size={12} />
                      Add Line
                    </button>
                  </div>

                  {drawMode !== 'none' && (
                    <div className="rounded-xl border border-brand-500/20 bg-slate-950/80 p-3 text-[11px] text-slate-300">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-white">Drawing mode:</span>
                        <span className="text-brand-300 uppercase tracking-wider">{drawMode}</span>
                      </div>
                      <p className="leading-relaxed text-slate-400 mb-3">
                        Click within the viewport to place {drawMode === 'zone' ? 'polygon vertices' : 'line endpoints'}. Right-click to undo the last point.
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveDrawing}
                          disabled={drawMode === 'zone' ? drawPoints.length < 3 : drawPoints.length < 2}
                          className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-40"
                        >
                          Save Drawing
                        </button>
                        <button
                          onClick={clearDrawing}
                          className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:border-slate-500"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 uppercase tracking-[0.24em]">
                      <span>Shape Library</span>
                      <button
                        onClick={clearAllAnalytics}
                        className="text-rose-400 hover:text-rose-300"
                      >
                        Clear All
                      </button>
                    </div>

                    <div className="space-y-2 text-[12px] text-slate-300">
                      <div>
                        <span className="font-semibold">Zones</span>
                        {zones.length === 0 ? (
                          <p className="text-slate-500 text-[11px] mt-1">No analytic zones configured.</p>
                        ) : (
                          zones.map((zone) => (
                            <div key={zone.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2">
                              <input
                                className="flex-1 bg-transparent text-slate-200 text-xs outline-none"
                                value={zone.name}
                                onChange={(event) => renameShape(zone.id, event.target.value, 'zone')}
                              />
                              <button onClick={() => removeShape(zone.id, 'zone')} className="text-red-400 hover:text-red-300" title="Delete zone">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      <div>
                        <span className="font-semibold">Lines</span>
                        {lines.length === 0 ? (
                          <p className="text-slate-500 text-[11px] mt-1">No count lines configured.</p>
                        ) : (
                          lines.map((line) => (
                            <div key={line.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-2 py-2">
                              <input
                                className="flex-1 bg-transparent text-slate-200 text-xs outline-none"
                                value={line.name}
                                onChange={(event) => renameShape(line.id, event.target.value, 'line')}
                              />
                              <button onClick={() => removeShape(line.id, 'line')} className="text-red-400 hover:text-red-300" title="Delete line">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-brand-500/10">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 uppercase tracking-[0.24em]">
                      <span>Templates</span>
                      <button
                        onClick={saveTemplate}
                        className="inline-flex items-center gap-1 rounded-xl bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:bg-slate-700"
                      >
                        <Save size={12} />
                        Save
                      </button>
                    </div>
                    {templates.length === 0 ? (
                      <p className="text-slate-500 text-[11px]">No saved templates yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {templates.map((template) => (
                          <button
                            key={template.id}
                            onClick={() => loadTemplate(template.id)}
                            className={`w-full text-left rounded-xl border px-3 py-2 text-xs transition ${selectedTemplateId === template.id ? 'border-brand-500 bg-slate-800 text-white' : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-600'}`}
                          >
                            {template.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={exportConfig}
                        className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-[11px] font-semibold text-white"
                      >
                        <Download size={12} />
                        Export
                      </button>
                      <button
                        onClick={() => importInputRef.current?.click()}
                        className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-200 hover:border-slate-500"
                      >
                        <Upload size={12} />
                        Import
                      </button>
                    </div>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept="application/json"
                      className="hidden"
                      onChange={importConfig}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                {/* Profiles block */}
                <div className="p-3 rounded-2xl bg-slate-900/60 border border-brand-500/10 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">Profiles</span>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      placeholder="New profile name..."
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white outline-none"
                    />
                    <button
                      onClick={saveProfile}
                      className="p-1.5 bg-brand-500 hover:bg-brand-600 rounded-lg text-white"
                      title="Save current to profile"
                    >
                      <Save size={14} />
                    </button>
                  </div>

                  {savedProfiles.length > 0 && (
                    <div className="space-y-1 pt-1.5">
                      {savedProfiles.map((p) => (
                        <div key={p.id} className="flex items-center justify-between bg-slate-950 p-2 rounded-xl text-xs">
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
                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-bold text-slate-500 tracking-wider uppercase">Inference & Bounding Boxes</span>
                    <div className="grid grid-cols-1 gap-2.5 pl-1">
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
                    <div className="grid grid-cols-1 gap-2.5 pl-1">
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
                    <div className="grid grid-cols-1 gap-2.5 pl-1">
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
                <div className="space-y-3.5 pt-3 border-t border-slate-900">
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
                          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-1 py-0.5">
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

            <div className="pt-4 border-t border-brand-500/10 text-[10px] text-slate-500 leading-normal space-y-1.5">
              <p>• ByteTrack assigns a persistent numeric identity to each person moving across frames.</p>
              <p>• YOLO11n Seg runs asynchronously in background processes so the UI stays fully responsive.</p>
              <p>• OffscreenCanvas & Web Workers process and render overlays completely off the React thread.</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/** Stats HUD Item Component */
function HUDMetric({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/40 border border-brand-500/10 font-mono">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span style={{ color }}>{icon}</span>
        <span>{label}</span>
      </div>
      <span className="text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

/** Toggle Switch Component */
function ToggleRow({ id, label, checked, onChange, icon }: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  icon: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between cursor-pointer py-1 group">
      <div className="flex items-center gap-2.5 text-xs text-slate-300 group-hover:text-white transition-colors">
        <span className="text-slate-500 group-hover:text-brand-400 transition-colors">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="relative">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-8 h-4 rounded-full transition-colors ${checked ? 'bg-brand-500' : 'bg-slate-800'}`} />
        <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
    </label>
  );
}
