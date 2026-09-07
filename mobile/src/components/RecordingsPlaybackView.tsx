import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Film,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Download,
  Camera,
  Calendar,
  Clock,
  Video,
  Radio,
  Search,
  Disc,
  FastForward,
  Layers,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Sliders,
  Check,
  X,
} from "lucide-react";
import {
  fetchAllRecordings,
  toggleCameraRecording,
  getEngineAppStatus,
  fetchRecordingSettings,
  updateRecordingSettings,
  RecordingSettings,
  RecordingItem,
  getEngineBase,
} from "../lib/localEngine";
import clsx from "clsx";

interface CameraItem {
  id: string;
  name: string;
  source_type?: string;
  is_active?: boolean;
}

interface RecordingsPlaybackViewProps {
  cameras: CameraItem[];
}

export default function RecordingsPlaybackView({ cameras }: RecordingsPlaybackViewProps) {
  // --- State ---
  const [recordings, setRecordings] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [showAllDates, setShowAllDates] = useState(false);
  const [selectedType, setSelectedType] = useState<"all" | "continuous" | "event">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Playback state
  const [currentClip, setCurrentClip] = useState<RecordingItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Timeline scrub state
  const [timelineSecond, setTimelineSecond] = useState<number>(0);
  const [hoveredTimelineSecond, setHoveredTimelineSecond] = useState<number | null>(null);

  // Camera recording status map
  const [cameraRecStatus, setCameraRecStatus] = useState<Record<string, boolean>>({});
  const [togglingRec, setTogglingRec] = useState<string | null>(null);

  // Digital Zoom & Pan state (supports mouse drag and mobile touch)
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchDistanceRef = useRef<number | null>(null);

  // Recording Configuration modal state
  const [configOpen, setConfigOpen] = useState(false);
  const [recSettings, setRecSettings] = useState<RecordingSettings>({ segment_minutes: 10, record_with_detections: true });
  const [savingConfig, setSavingConfig] = useState(false);

  // Video element and container refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const timelineBarRef = useRef<HTMLDivElement>(null);

  const engineBase = getEngineBase();

  // Reset zoom on clip change
  useEffect(() => {
    setZoomLevel(1.0);
    setPan({ x: 0, y: 0 });
  }, [currentClip?.id]);

  const handleZoomIn = () => {
    setZoomLevel((z) => Math.min(4.0, Number((z + 0.5).toFixed(1))));
  };

  const handleZoomOut = () => {
    setZoomLevel((z) => {
      const next = Math.max(1.0, Number((z - 0.5).toFixed(1)));
      if (next === 1.0) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = () => {
    setZoomLevel(1.0);
    setPan({ x: 0, y: 0 });
  };

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoomLevel <= 1.0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoomLevel <= 1.0) return;
    const maxPan = (zoomLevel - 1.0) * 350;
    const newX = Math.max(-maxPan, Math.min(maxPan, e.clientX - dragStartRef.current.x));
    const newY = Math.max(-maxPan, Math.min(maxPan, e.clientY - dragStartRef.current.y));
    setPan({ x: newX, y: newY });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch pan & pinch-to-zoom handlers for mobile screens
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && zoomLevel > 1.0) {
      setIsDragging(true);
      const touch = e.touches[0];
      dragStartRef.current = { x: touch.clientX - pan.x, y: touch.clientY - pan.y };
    } else if (e.touches.length === 2) {
      // Pinch gesture start
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDistanceRef.current = Math.hypot(dx, dy);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging && zoomLevel > 1.0) {
      const touch = e.touches[0];
      const maxPan = (zoomLevel - 1.0) * 350;
      const newX = Math.max(-maxPan, Math.min(maxPan, touch.clientX - dragStartRef.current.x));
      const newY = Math.max(-maxPan, Math.min(maxPan, touch.clientY - dragStartRef.current.y));
      setPan({ x: newX, y: newY });
    } else if (e.touches.length === 2 && touchDistanceRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / touchDistanceRef.current;
      if (Math.abs(factor - 1) > 0.05) {
        setZoomLevel((prev) => Math.max(1.0, Math.min(4.0, Number((prev * (factor > 1 ? 1.08 : 0.92)).toFixed(1)))));
        touchDistanceRef.current = dist;
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchDistanceRef.current = null;
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const ok = await updateRecordingSettings(recSettings);
      if (ok) {
        setConfigOpen(false);
      }
    } finally {
      setSavingConfig(false);
    }
  };

  // --- Fetch Recordings & Status ---
  const loadData = useCallback(async () => {
    try {
      const [recs, status, settings] = await Promise.all([
        fetchAllRecordings(),
        getEngineAppStatus(),
        fetchRecordingSettings(),
      ]);
      setRecordings(recs || []);
      if (settings) {
        setRecSettings(settings);
      }

      if (status?.cameras) {
        const map: Record<string, boolean> = {};
        for (const [cid, cam] of Object.entries(status.cameras)) {
          map[cid] = Boolean(cam.recording);
        }
        setCameraRecStatus(map);
      }
    } catch (err) {
      console.error("[RecordingsPlayback] Error loading recordings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Merge cameras from props AND any camera ID discovered in recordings
  const allAvailableCameras = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    cameras.forEach((c) => map.set(c.id, { id: c.id, name: c.name }));
    recordings.forEach((r) => {
      if (r.camera_id && !map.has(r.camera_id)) {
        map.set(r.camera_id, {
          id: r.camera_id,
          name: r.camera_name || `Camera ${r.camera_id.slice(0, 6)}`,
        });
      }
    });
    return Array.from(map.values());
  }, [cameras, recordings]);

  // Camera ID -> Display Name map
  const cameraMap = useMemo(() => {
    const map = new Map<string, string>();
    allAvailableCameras.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [allAvailableCameras]);

  // Unique recorded dates sorted descending
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    recordings.forEach((r) => {
      const d = (r.start_time || "").split("T")[0];
      if (d) set.add(d);
    });
    return Array.from(set).sort().reverse();
  }, [recordings]);

  // Filter recordings by Camera, Date, Type, and Search
  const filteredRecordings = useMemo(() => {
    return recordings.filter((r) => {
      if (selectedCameraId !== "all" && r.camera_id !== selectedCameraId) {
        return false;
      }
      if (!showAllDates) {
        const recDate = (r.start_time || "").split("T")[0];
        if (recDate !== selectedDate) {
          return false;
        }
      }
      if (selectedType !== "all" && r.recording_type !== selectedType) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const cName = (cameraMap.get(r.camera_id) || r.camera_name || "").toLowerCase();
        if (!cName.includes(q) && !r.file_path.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [recordings, selectedCameraId, selectedDate, showAllDates, selectedType, searchQuery, cameraMap]);

  // Auto-select first clip if none is selected
  useEffect(() => {
    if (!currentClip && filteredRecordings.length > 0) {
      setCurrentClip(filteredRecordings[0]);
    }
  }, [filteredRecordings, currentClip]);

  // Video element event sync
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      setCurrentTime(v.currentTime);
      if (currentClip && currentClip.start_time) {
        const start = new Date(currentClip.start_time);
        const currentSecSinceMidnight =
          start.getUTCHours() * 3600 +
          start.getUTCMinutes() * 60 +
          start.getUTCSeconds() +
          v.currentTime;
        setTimelineSecond(Math.floor(currentSecSinceMidnight) % 86400);
      }
    };

    const onLoadedMetadata = () => {
      setDuration(v.duration || 0);
      v.playbackRate = playbackSpeed;
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("loadedmetadata", onLoadedMetadata);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);

    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("loadedmetadata", onLoadedMetadata);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
    };
  }, [currentClip, playbackSpeed]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch((err) => console.error("Play failed:", err));
    } else {
      v.pause();
    }
  };

  const seekRelative = (seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 10000, v.currentTime + seconds));
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Capture Snapshot from video
  const captureSnapshot = () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 1280;
      canvas.height = v.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataUrl;
        const camName = currentClip ? (cameraMap.get(currentClip.camera_id) || "Camera") : "Camera";
        a.download = `Snapshot_${camName}_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        a.click();
      }
    } catch (e) {
      console.warn("Snapshot capture prevented:", e);
    }
  };

  // Toggle Camera Recording Handler
  const handleToggleRecording = async (cameraId: string) => {
    if (cameraId === "all") return;
    const current = Boolean(cameraRecStatus[cameraId]);
    setTogglingRec(cameraId);
    try {
      const ok = await toggleCameraRecording(cameraId, !current);
      if (ok) {
        setCameraRecStatus((prev) => ({ ...prev, [cameraId]: !current }));
        setTimeout(loadData, 1000);
      }
    } finally {
      setTogglingRec(null);
    }
  };

  const formatSecondsToTime = (totalSec: number) => {
    const s = Math.max(0, Math.min(86399, Math.floor(totalSec)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const parseTimeToSeconds = (isoOrTime: string) => {
    try {
      const d = new Date(isoOrTime);
      if (!isNaN(d.getTime())) {
        return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      }
    } catch {}
    const parts = isoOrTime.split(":").map(Number);
    if (parts.length >= 2) {
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    }
    return 0;
  };

  const jumpToSecond = (targetSec: number) => {
    setTimelineSecond(targetSec);
    const match = filteredRecordings.find((r) => {
      const startSec = parseTimeToSeconds(r.start_time);
      const endSec = r.end_time ? parseTimeToSeconds(r.end_time) : startSec + 600;
      return targetSec >= startSec && targetSec <= endSec;
    });

    if (match) {
      setCurrentClip(match);
      if (videoRef.current) {
        const startSec = parseTimeToSeconds(match.start_time);
        const offset = Math.max(0, targetSec - startSec);
        videoRef.current.currentTime = offset;
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSec = Math.floor(ratio * 86400);
    jumpToSecond(targetSec);
  };

  const timelineSegments = useMemo(() => {
    return filteredRecordings.map((r) => {
      const startSec = parseTimeToSeconds(r.start_time);
      const endSec = r.end_time ? parseTimeToSeconds(r.end_time) : Math.min(86400, startSec + 600);
      const leftPercent = (startSec / 86400) * 100;
      const widthPercent = Math.max(0.5, ((endSec - startSec) / 86400) * 100);

      return {
        id: r.id,
        left: `${leftPercent}%`,
        width: `${widthPercent}%`,
        type: r.recording_type,
        clip: r,
        title: `${r.recording_type.toUpperCase()} | ${formatSecondsToTime(startSec)} - ${formatSecondsToTime(endSec)}`,
      };
    });
  }, [filteredRecordings]);

  const formatDuration = (sec: number) => {
    if (isNaN(sec) || sec < 0) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const activeCamRecording = selectedCameraId !== "all" && Boolean(cameraRecStatus[selectedCameraId]);
  const activeCameraName =
    selectedCameraId === "all"
      ? "All Cameras"
      : cameraMap.get(selectedCameraId) || selectedCameraId;

  return (
    <div className="flex flex-col min-h-screen bg-surface-0 text-zinc-100 font-sans pb-24">
      {/* Top Filter Bar */}
      <header className="sticky top-0 z-30 bg-surface-1/95 backdrop-blur-md border-b border-line px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-accent/15 text-accent shrink-0">
              <Film size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xs sm:text-sm font-bold text-white truncate">CCTV Playback Studio</h1>
              <p className="text-[10px] text-zinc-400 font-mono truncate">
                {filteredRecordings.length} clip{filteredRecordings.length === 1 ? "" : "s"} found
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Recording Config Button */}
            <button
              onClick={() => setConfigOpen(true)}
              title="Recording Settings (Segment Duration & AI Burn-in)"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-2 text-zinc-300 hover:text-white border border-line text-xs font-semibold"
            >
              <Sliders size={13} className="text-accent" />
              <span>{recSettings.segment_minutes}m</span>
            </button>

            {/* Refresh */}
            <button
              onClick={loadData}
              title="Refresh"
              className="p-1.5 rounded-lg bg-surface-2 text-zinc-400 hover:text-white border border-line"
            >
              <RefreshCw size={14} className={loading ? "animate-spin text-accent" : ""} />
            </button>
          </div>
        </div>

        {/* Camera Selector & Date Selector Row */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Camera Dropdown */}
          <div className="flex items-center gap-1.5 bg-surface-2 px-2.5 py-1.5 rounded-lg border border-line flex-1 min-w-[140px]">
            <Video size={13} className="text-accent shrink-0" />
            <select
              value={selectedCameraId}
              onChange={(e) => {
                setSelectedCameraId(e.target.value);
                setCurrentClip(null);
              }}
              className="bg-transparent text-xs text-zinc-200 font-medium focus:outline-none w-full truncate cursor-pointer"
            >
              <option value="all" className="bg-surface-1 text-zinc-200">
                All Cameras ({allAvailableCameras.length})
              </option>
              {allAvailableCameras.map((c) => (
                <option key={c.id} value={c.id} className="bg-surface-1 text-zinc-200">
                  {c.name} {cameraRecStatus[c.id] ? "🔴 [REC]" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-1.5 bg-surface-2 px-2.5 py-1.5 rounded-lg border border-line shrink-0">
            <Calendar size={13} className="text-zinc-400 shrink-0" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) {
                  setSelectedDate(e.target.value);
                  setShowAllDates(false);
                }
              }}
              className="bg-transparent text-xs text-zinc-200 font-mono focus:outline-none cursor-pointer"
            />
          </div>

          {/* Today Button */}
          <button
            onClick={() => {
              setSelectedDate(new Date().toISOString().split("T")[0]);
              setShowAllDates(false);
            }}
            className={clsx(
              "px-2.5 py-1 text-xs rounded-md font-semibold transition shrink-0",
              !showAllDates && selectedDate === new Date().toISOString().split("T")[0]
                ? "bg-accent text-black"
                : "bg-surface-2 text-zinc-400"
            )}
          >
            Today
          </button>

          {/* All Dates Button */}
          <button
            onClick={() => setShowAllDates(!showAllDates)}
            className={clsx(
              "px-2.5 py-1 text-xs rounded-md font-semibold transition shrink-0",
              showAllDates ? "bg-accent text-black" : "bg-surface-2 text-zinc-400"
            )}
          >
            All
          </button>
        </div>

        {/* Per-camera REC on/off button */}
        {selectedCameraId !== "all" && (
          <div className="pt-0.5">
            <button
              onClick={() => handleToggleRecording(selectedCameraId)}
              disabled={togglingRec === selectedCameraId}
              className={clsx(
                "w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-bold border transition shadow-sm",
                activeCamRecording
                  ? "bg-danger/15 text-danger border-danger/40 hover:bg-danger/25"
                  : "bg-surface-2 text-zinc-300 border-line hover:bg-surface-3 hover:text-white"
              )}
            >
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  activeCamRecording ? "bg-danger animate-ping" : "bg-zinc-500"
                )}
              />
              {togglingRec === selectedCameraId
                ? "Updating..."
                : activeCamRecording
                ? "REC ACTIVE — TAP TO PAUSE"
                : "START CONTINUOUS RECORDING"}
            </button>
          </div>
        )}
      </header>

      {/* Main Content: Player & Timeline */}
      <div className="p-3 sm:p-4 space-y-4">
        {/* Video Player Display Container */}
        <div
          ref={playerContainerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={clsx(
            "relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-line shadow-2xl flex flex-col justify-center items-center select-none touch-none",
            zoomLevel > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
          )}
        >
          {/* Zoom Indicator Badge & Quick Reset */}
          {zoomLevel > 1 && (
            <div className="absolute top-2.5 inset-x-0 mx-auto w-fit z-30 flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-black font-semibold text-xs shadow-lg backdrop-blur-md">
              <ZoomIn size={14} />
              <span>{(zoomLevel * 100).toFixed(0)}% Zoom</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetZoom();
                }}
                className="ml-1 px-1.5 py-0.5 bg-black/20 hover:bg-black/30 rounded text-[10px] uppercase font-bold"
              >
                Reset
              </button>
            </div>
          )}

          {currentClip ? (
            <div
              className="w-full h-full flex items-center justify-center overflow-hidden"
              style={{
                transform: `scale(${zoomLevel}) translate(${pan.x / zoomLevel}px, ${pan.y / zoomLevel}px)`,
                transformOrigin: "center center",
                transition: isDragging ? "none" : "transform 0.1s ease-out",
              }}
            >
              <video
                ref={videoRef}
                key={currentClip.id}
                src={`${engineBase}${currentClip.file_path}`}
                className="w-full h-full object-contain pointer-events-auto"
                playsInline
                autoPlay
                onClick={togglePlay}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center space-y-2.5">
              <div className="h-12 w-12 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-500">
                <Film size={22} />
              </div>
              <div className="text-xs font-semibold text-zinc-300">
                No video clip selected
              </div>
              <p className="text-[11px] text-zinc-500 max-w-xs">
                Select a clip from the archive list below or tap any segment on the 24-hour timeline.
              </p>
            </div>
          )}

          {/* Watermark Overlay */}
          <div className="absolute top-2 left-2 flex items-center gap-1.5 pointer-events-none z-10">
            <span className="flex items-center gap-1 bg-black/75 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-white border border-white/10 shadow">
              <Radio size={10} className="text-red-500 animate-pulse" />
              PLAYBACK
            </span>
            <span className="bg-black/75 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-medium text-cyan-400 border border-white/10 shadow truncate max-w-[120px]">
              {currentClip
                ? cameraMap.get(currentClip.camera_id) || currentClip.camera_name || "Camera"
                : activeCameraName}
            </span>
          </div>

          {/* Big Center Play/Pause button */}
          {currentClip && (
            <button
              onClick={togglePlay}
              className={clsx(
                "absolute inset-0 m-auto h-14 w-14 rounded-full bg-black/60 backdrop-blur-md text-white flex items-center justify-center transition border border-white/20",
                isPlaying ? "opacity-0 hover:opacity-100" : "opacity-90"
              )}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </button>
          )}

          {/* On-Player Scrub Bar & Controls Footer */}
          {currentClip && (
            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-2.5 flex flex-col gap-1.5 z-20">
              {/* Slider */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-400 min-w-[36px]">
                  {formatDuration(currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setCurrentTime(val);
                    if (videoRef.current) videoRef.current.currentTime = val;
                  }}
                  className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent"
                />
                <span className="text-[10px] font-mono text-zinc-400 min-w-[36px] text-right">
                  {formatDuration(duration)}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={togglePlay} className="text-white hover:text-accent p-1">
                    {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button onClick={() => seekRelative(-10)} className="text-zinc-400 hover:text-white p-1 text-[11px] font-mono flex items-center">
                    <RotateCcw size={14} /> -10
                  </button>
                  <button onClick={() => seekRelative(10)} className="text-zinc-400 hover:text-white p-1 text-[11px] font-mono flex items-center">
                    <RotateCw size={14} /> +10
                  </button>

                  {/* Speed toggle */}
                  <button
                    onClick={() => {
                      const speeds = [0.5, 1, 1.5, 2];
                      const next = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
                      handleSpeedChange(next);
                    }}
                    className="px-1.5 py-0.5 rounded bg-black/50 text-[10px] font-mono text-zinc-300 border border-white/10"
                  >
                    {playbackSpeed}x
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Zoom In/Out Buttons */}
                  <div className="flex items-center gap-1 bg-black/50 px-1.5 py-0.5 rounded border border-white/10">
                    <button
                      onClick={handleZoomOut}
                      disabled={zoomLevel <= 1}
                      className="text-zinc-400 hover:text-white disabled:opacity-30 p-0.5"
                      title="Zoom Out"
                    >
                      <ZoomOut size={13} />
                    </button>
                    <button
                      onClick={handleResetZoom}
                      className="text-[10px] font-mono text-zinc-300 min-w-[26px] text-center"
                    >
                      {zoomLevel.toFixed(1)}x
                    </button>
                    <button
                      onClick={handleZoomIn}
                      disabled={zoomLevel >= 4}
                      className="text-zinc-400 hover:text-white disabled:opacity-30 p-0.5"
                      title="Zoom In"
                    >
                      <ZoomIn size={13} />
                    </button>
                  </div>

                  <button onClick={captureSnapshot} className="text-zinc-400 hover:text-white p-1" title="Snapshot">
                    <Camera size={15} />
                  </button>

                  <a
                    href={`${engineBase}${currentClip.file_path}`}
                    download
                    className="text-zinc-400 hover:text-accent p-1"
                    title="Download MP4"
                  >
                    <Download size={15} />
                  </a>

                  <button onClick={toggleFullscreen} className="text-zinc-400 hover:text-white p-1" title="Fullscreen">
                    {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 24-Hour Interactive Timeline Card */}
        <div className="bg-surface-1 rounded-xl border border-line p-3 space-y-2.5 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock size={14} className="text-accent" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-200">
                24-Hour Timeline
              </span>
            </div>
            <span className="text-[11px] font-mono font-bold text-accent">
              {formatSecondsToTime(timelineSecond)}
            </span>
          </div>

          {/* Timeline Bar */}
          <div
            ref={timelineBarRef}
            onClick={handleTimelineClick}
            className="relative h-9 w-full bg-zinc-950 rounded-lg border border-line overflow-hidden cursor-pointer shadow-inner"
          >
            {/* Background 4-hour grid lines */}
            <div className="absolute inset-0 flex justify-between pointer-events-none opacity-20">
              {[0, 4, 8, 12, 16, 20, 24].map((h) => (
                <div key={h} className="h-full border-r border-zinc-500 w-0" />
              ))}
            </div>

            {/* Recorded Segments */}
            {timelineSegments.map((seg) => (
              <div
                key={seg.id}
                style={{ left: seg.left, width: seg.width }}
                title={seg.title}
                className={clsx(
                  "absolute top-1 bottom-1 rounded-sm shadow-sm transition-opacity hover:opacity-100",
                  currentClip?.id === seg.id
                    ? "bg-accent opacity-100 ring-1 ring-white"
                    : seg.type === "continuous"
                    ? "bg-cyan-500/80 opacity-75"
                    : "bg-amber-500/80 opacity-75"
                )}
              />
            ))}

            {/* Current Playhead Needle */}
            <div
              style={{ left: `${(timelineSecond / 86400) * 100}%` }}
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none shadow"
            >
              <div className="absolute -top-1 -left-1.5 w-3.5 h-2 bg-red-500 rounded-sm" />
            </div>
          </div>

          {/* Time Legend */}
          <div className="flex justify-between text-[9px] font-mono text-zinc-500 px-0.5">
            <span>00:00</span>
            <span>04:00</span>
            <span>08:00</span>
            <span>12:00</span>
            <span>16:00</span>
            <span>20:00</span>
            <span>24:00</span>
          </div>
        </div>

        {/* Clip Archive Drawer */}
        <div className="bg-surface-1 rounded-xl border border-line p-3 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-zinc-200">
              Recorded Clips ({filteredRecordings.length})
            </h2>
            <div className="flex items-center gap-1 text-[10px]">
              {(["all", "continuous", "event"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedType(t)}
                  className={clsx(
                    "px-2 py-0.5 rounded capitalize font-medium transition",
                    selectedType === t ? "bg-accent text-black font-bold" : "bg-surface-2 text-zinc-400"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Clip Cards List */}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {filteredRecordings.length === 0 ? (
              <div className="py-6 text-center text-xs text-zinc-500">
                No recorded video clips found.
              </div>
            ) : (
              filteredRecordings.map((r) => {
                const isSelected = currentClip?.id === r.id;
                const startStr = r.start_time ? r.start_time.split("T")[1]?.slice(0, 8) : "--:--";
                const endStr = r.end_time ? r.end_time.split("T")[1]?.slice(0, 8) : "--:--";
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setCurrentClip(r);
                      if (videoRef.current) {
                        videoRef.current.currentTime = 0;
                        videoRef.current.play().catch(() => {});
                      }
                    }}
                    className={clsx(
                      "p-2.5 rounded-lg border text-xs cursor-pointer transition flex flex-col gap-1.5",
                      isSelected
                        ? "bg-accent/15 border-accent shadow-md"
                        : "bg-surface-2/60 border-line hover:bg-surface-2"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 truncate">
                        <Video size={13} className={isSelected ? "text-accent" : "text-zinc-400"} />
                        <span className="font-semibold text-zinc-200 truncate">
                          {cameraMap.get(r.camera_id) || r.camera_name || "Camera"}
                        </span>
                      </div>
                      <span
                        className={clsx(
                          "px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold",
                          r.recording_type === "continuous"
                            ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        )}
                      >
                        {r.recording_type}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>{startStr} → {endStr}</span>
                      {isSelected ? (
                        <span className="flex items-center gap-1 text-accent font-bold">
                          <Play size={10} className="fill-accent" /> Playing
                        </span>
                      ) : (
                        <a
                          href={`${engineBase}${r.file_path}`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-zinc-400 hover:text-white"
                        >
                          <Download size={11} /> MP4
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Recording Settings Modal */}
      {configOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-surface-1 border border-line rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-accent/15 text-accent">
                  <Sliders size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Recording Settings</h3>
                  <p className="text-[10px] text-zinc-400">Segment duration & AI overlays</p>
                </div>
              </div>
              <button
                onClick={() => setConfigOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">
              {/* Duration Options */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-2">
                  Clip Segment Duration
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[5, 10, 15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() =>
                        setRecSettings((prev) => ({ ...prev, segment_minutes: mins }))
                      }
                      className={clsx(
                        "py-2 rounded-lg text-xs font-mono font-medium border text-center transition",
                        recSettings.segment_minutes === mins
                          ? "bg-accent text-black border-accent font-bold shadow-md shadow-accent/20"
                          : "bg-surface-2 text-zinc-300 border-line hover:border-zinc-500"
                      )}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 mt-1.5">
                  Videos are automatically split into MP4 segments of this length for instant playback.
                </p>
              </div>

              {/* Burn-in toggle */}
              <div className="p-3 rounded-xl bg-surface-2 border border-line flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="burnInDetsMobile"
                  checked={recSettings.record_with_detections}
                  onChange={(e) =>
                    setRecSettings((prev) => ({
                      ...prev,
                      record_with_detections: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 rounded border-zinc-700 bg-surface-3 text-accent focus:ring-accent cursor-pointer accent-accent"
                />
                <label htmlFor="burnInDetsMobile" className="flex-1 cursor-pointer">
                  <div className="text-xs font-semibold text-zinc-200">
                    Burn AI Detections into Recordings
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5 leading-relaxed">
                    Overlays AI bounding boxes, object names, tracking IDs, and speed km/h directly into recorded MP4 files.
                  </div>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-accent text-black font-semibold text-xs hover:bg-accent/90 transition shadow-md disabled:opacity-50"
              >
                {savingConfig ? (
                  "Saving..."
                ) : (
                  <>
                    <Check size={13} /> Save Settings
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
