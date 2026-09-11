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
  Sparkles,
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

  // Currently playing clip
  const [currentClip, setCurrentClip] = useState<RecordingItem | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // 24h Timeline scrubbing (seconds from 00:00:00 to 86400)
  const [timelineSecond, setTimelineSecond] = useState<number>(() => {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  });
  const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
  const [hoveredTimelineSecond, setHoveredTimelineSecond] = useState<number | null>(null);


  // Camera recording status map
  const [cameraRecStatus, setCameraRecStatus] = useState<Record<string, boolean>>({});
  const [togglingRec, setTogglingRec] = useState<string | null>(null);

  // Digital Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Recording Configuration modal state
  const [configOpen, setConfigOpen] = useState(false);
  const [recSettings, setRecSettings] = useState<RecordingSettings>({ segment_minutes: 10, record_with_detections: true });
  const [savingConfig, setSavingConfig] = useState(false);

  // Video element and container refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const timelineBarRef = useRef<HTMLDivElement>(null);

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

  const handleWheel = (e: React.WheelEvent) => {
    if (!currentClip) return;
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
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
      // Camera filter
      if (selectedCameraId !== "all" && r.camera_id !== selectedCameraId) {
        return false;
      }

      // Date filter
      if (!showAllDates) {
        const recDate = (r.start_time || "").split("T")[0];
        if (recDate !== selectedDate) {
          return false;
        }
      }

      // Type filter
      if (selectedType !== "all" && r.recording_type !== selectedType) {
        return false;
      }

      // Search query (camera name, id, file path)
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

  // Playback control actions
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch((e) => console.warn("Play interrupted:", e));
    } else {
      v.pause();
    }
  };

  const seekRelative = (secDelta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + secDelta));
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
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleFullscreen = () => {
    if (!playerContainerRef.current) return;
    if (!document.fullscreenElement) {
      playerContainerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  // Capture video frame snapshot as PNG
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

  // Convert seconds since midnight into "HH:MM:SS" string
  const formatSecondsToTime = (totalSec: number) => {
    const s = Math.max(0, Math.min(86399, Math.floor(totalSec)));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  // Convert "HH:MM:SS" or ISO Date string to seconds from midnight
  const parseTimeToSeconds = (isoOrTime: string) => {
    try {
      const d = new Date(isoOrTime);
      if (!isNaN(d.getTime())) {
        return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      }
    } catch { /* not an iso */ }
    const parts = isoOrTime.split(":").map(Number);
    if (parts.length >= 2) {
      return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    }
    return 0;
  };

  // Jump to specific time second
  const jumpToSecond = (targetSec: number) => {
    setTimelineSecond(targetSec);

    // Find if a recording covers this exact second
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

  // Handle Timeline Click / Scrub
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSec = Math.floor(ratio * 86400);
    jumpToSecond(targetSec);
  };

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const moveX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, moveX / rect.width));
    setHoveredTimelineSecond(Math.floor(ratio * 86400));
  };

  // Render 24-Hour Timeline segments
  const timelineSegments = useMemo(() => {
    return filteredRecordings.map((r) => {
      const startSec = parseTimeToSeconds(r.start_time);
      const endSec = r.end_time ? parseTimeToSeconds(r.end_time) : Math.min(86400, startSec + 600);
      const leftPercent = (startSec / 86400) * 100;
      const widthPercent = Math.max(0.3, ((endSec - startSec) / 86400) * 100);

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

  // Compute stats for current filter
  const stats = useMemo(() => {
    const total = filteredRecordings.length;
    const continuous = filteredRecordings.filter((r) => r.recording_type === "continuous").length;
    const events = filteredRecordings.filter((r) => r.recording_type === "event").length;
    return { total, continuous, events };
  }, [filteredRecordings]);

  // Calculate duration string e.g. "04:12"
  const formatDuration = (sec: number) => {
    if (isNaN(sec) || sec < 0) return "00:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const activeCameraName = useMemo(() => {
    if (selectedCameraId === "all") return "All Cameras";
    return cameraMap.get(selectedCameraId) || "Camera";
  }, [selectedCameraId, cameraMap]);

  const activeCamRecording = selectedCameraId !== "all" && cameraRecStatus[selectedCameraId];

  return (
    <div className="flex h-full flex-col bg-surface-base text-zinc-100 select-none overflow-hidden">
      {/* Top Header / Control Bar */}
      <header className="shrink-0 border-b border-line bg-surface-1 px-6 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Left: Title & Quick Cam Picker */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent border border-accent/30 shadow-inner">
              <Film size={20} className="animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-wide text-zinc-100">
                  NVR Playback & Recording Studio
                </h1>
                <span className="rounded-full bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-400 border border-cyan-500/20">
                  H.264 High-Def
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Continuous 24h surveillance timeline, event triggers & instant clip archive
              </p>
            </div>
          </div>

          {/* Right: Live Camera Recording Toggle & Date Selectors */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Camera Select Dropdown */}
            <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-lg border border-line">
              <Video size={14} className="text-zinc-400" />
              <select
                value={selectedCameraId}
                onChange={(e) => {
                  setSelectedCameraId(e.target.value);
                  setCurrentClip(null);
                }}
                className="bg-transparent text-xs text-zinc-200 font-medium focus:outline-none cursor-pointer"
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

            {/* Live Camera Recording Toggle Button */}
            {selectedCameraId !== "all" && (
              <button
                onClick={() => handleToggleRecording(selectedCameraId)}
                disabled={togglingRec === selectedCameraId}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold border transition shadow-sm ${
                  activeCamRecording
                    ? "bg-danger/15 text-danger border-danger/40 hover:bg-danger/25"
                    : "bg-surface-2 text-zinc-300 border-line hover:bg-surface-3 hover:text-white"
                }`}
                title={activeCamRecording ? "Click to Pause Recording" : "Click to Start Recording"}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    activeCamRecording ? "bg-danger animate-ping" : "bg-zinc-500"
                  }`}
                />
                {togglingRec === selectedCameraId
                  ? "Updating..."
                  : activeCamRecording
                  ? "REC ACTIVE"
                  : "START RECORDING"}
              </button>
            )}

            {/* Unified Date Selector & All Dates toggle */}
            <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-lg border border-line">
              <Calendar size={14} className="text-zinc-400" />
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
              <button
                onClick={() => setShowAllDates(!showAllDates)}
                className={`ml-1 px-2 py-0.5 text-[11px] rounded transition font-medium ${
                  showAllDates
                    ? "bg-accent text-black font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
                title="Toggle showing all recorded dates"
              >
                {showAllDates ? "Showing All" : "All"}
              </button>
            </div>

            {/* Recording Config Button */}
            <button
              onClick={() => setConfigOpen(true)}
              title="Recording Settings (Segment Duration & Detection Burn-in)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-zinc-300 hover:text-white hover:bg-surface-3 border border-line transition text-xs font-medium"
            >
              <Sliders size={13} className="text-accent" />
              <span>Config ({recSettings.segment_minutes}m)</span>
            </button>

            {/* Refresh Button */}
            <button
              onClick={loadData}
              title="Refresh recordings"
              className="p-1.5 rounded-lg bg-surface-2 text-zinc-400 hover:text-white hover:bg-surface-3 border border-line transition"
            >
              <RefreshCw size={14} className={loading ? "animate-spin text-accent" : ""} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Studio Content: Player & Timeline (Left 70%) + Segment Drawer (Right 30%) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Video Player Deck & 24h Timeline */}
        <div className="flex-1 flex flex-col min-w-0 bg-surface-base p-5 overflow-y-auto space-y-4">
          {/* Video Player Display Container */}
          <div
            ref={playerContainerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            className={`relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-line shadow-2xl flex flex-col justify-center items-center group select-none ${
              zoomLevel > 1 ? (isDragging ? "cursor-grabbing" : "cursor-grab") : ""
            }`}
          >
            {/* Zoom Indicator Badge & Quick Reset */}
            {zoomLevel > 1 && (
              <div className="absolute top-3 inset-x-0 mx-auto w-fit z-20 flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-black font-semibold text-xs shadow-lg backdrop-blur-md">
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
                  src={`http://127.0.0.1:8000${currentClip.file_path}`}
                  className="w-full h-full object-contain pointer-events-auto"
                  playsInline
                  autoPlay
                  onClick={togglePlay}
                />
              </div>
            ) : (
              /* High-tech standby canvas view when no specific file is playing */
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="h-16 w-16 rounded-full bg-zinc-900/80 border border-zinc-700 flex items-center justify-center text-zinc-500 shadow-inner">
                  <Film size={28} />
                </div>
                <div className="text-sm font-semibold text-zinc-300">
                  No video selected for {showAllDates ? "All Dates" : selectedDate}
                </div>
                <p className="text-xs text-zinc-500 max-w-sm">
                  Click any segment on the 24-hour timeline bar below or select a clip from the archive list on the right.
                </p>
              </div>
            )}

            {/* Video Watermark & Overlay Indicators */}
            <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none z-10">
              <span className="flex items-center gap-1.5 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-mono text-white border border-white/10 shadow">
                <Radio size={12} className="text-red-500 animate-pulse" />
                PLAYBACK {currentClip ? `[${currentClip.recording_type.toUpperCase()}]` : ""}
              </span>
              <span className="bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-medium text-cyan-400 border border-white/10 shadow">
                {currentClip
                  ? cameraMap.get(currentClip.camera_id) || currentClip.camera_name || "Camera"
                  : activeCameraName}
              </span>
              <span className="bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-300 border border-white/10 shadow">
                {currentClip?.start_time ? currentClip.start_time.split("T")[0] : selectedDate} {formatSecondsToTime(timelineSecond)}
              </span>
            </div>

            {/* Speed & Resolution Badge */}
            <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none z-10">
              <span className="bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-zinc-300 border border-white/10">
                {playbackSpeed}x SPEED
              </span>
              <span className="bg-black/70 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-mono text-emerald-400 border border-white/10">
                1080p 15FPS
              </span>
            </div>

            {/* Big Center Play/Pause button on hover */}
            {currentClip && (
              <button
                onClick={togglePlay}
                className="absolute inset-0 m-auto h-16 w-16 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:scale-110 border border-white/20"
              >
                {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
              </button>
            )}

            {/* On-Player Scrub Bar & Controls Footer */}
            {currentClip && (
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 flex flex-col gap-2 z-10 transition-opacity duration-200">
                {/* Scrub Slider */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-zinc-400 min-w-[42px]">
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
                    className="flex-1 h-1.5 bg-zinc-700/80 rounded-lg appearance-none cursor-pointer accent-accent"
                  />
                  <span className="text-[11px] font-mono text-zinc-400 min-w-[42px] text-right">
                    {formatDuration(duration)}
                  </span>
                </div>

                {/* Control Action Buttons */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={togglePlay}
                      className="text-white hover:text-accent transition"
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button
                      onClick={() => seekRelative(-10)}
                      className="text-zinc-400 hover:text-white transition flex items-center gap-0.5 text-xs font-mono"
                      title="Back 10s"
                    >
                      <RotateCcw size={15} /> -10s
                    </button>
                    <button
                      onClick={() => seekRelative(10)}
                      className="text-zinc-400 hover:text-white transition flex items-center gap-0.5 text-xs font-mono"
                      title="Forward 10s"
                    >
                      <RotateCw size={15} /> +10s
                    </button>

                    {/* Speed Selector (Single compact cycler button) */}
                    <button
                      onClick={() => {
                        const speeds = [1, 1.5, 2, 4, 0.5];
                        const nextIndex = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
                        handleSpeedChange(speeds[nextIndex]);
                      }}
                      className="flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded border border-white/10 text-xs text-zinc-200 hover:text-accent transition font-mono"
                      title="Cycle speed: 1x, 1.5x, 2x, 4x, 0.5x"
                    >
                      <FastForward size={12} className="text-zinc-400" />
                      <span className="font-bold text-accent">{playbackSpeed}x</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Volume Control */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={toggleMute}
                        className="text-zinc-400 hover:text-white transition"
                      >
                        {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={handleVolumeChange}
                        className="w-16 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent"
                      />
                    </div>

                    {/* Digital Zoom Indicator & Reset when active */}
                    {zoomLevel > 1 && (
                      <button
                        onClick={handleResetZoom}
                        className="px-2 py-0.5 rounded bg-accent text-black font-mono font-bold text-[10px] hover:bg-accent/80 transition"
                        title="Click to reset zoom"
                      >
                        {zoomLevel.toFixed(1)}x Reset
                      </button>
                    )}

                    {/* Snapshot Frame button */}
                    <button
                      onClick={captureSnapshot}
                      title="Take frame snapshot"
                      className="text-zinc-400 hover:text-white transition"
                    >
                      <Camera size={16} />
                    </button>

                    {/* Download MP4 file */}
                    <a
                      href={`http://127.0.0.1:8000${currentClip.file_path}`}
                      download
                      title="Download full MP4 clip"
                      className="text-zinc-400 hover:text-accent transition"
                    >
                      <Download size={16} />
                    </a>

                    {/* Fullscreen */}
                    <button
                      onClick={toggleFullscreen}
                      title="Toggle Fullscreen"
                      className="text-zinc-400 hover:text-white transition"
                    >
                      {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 24-Hour Interactive Timeline Card */}
          <div className="bg-surface-1 rounded-xl border border-line p-4 space-y-3 shadow-lg">
            {/* Timeline Header & Jump-to-time Input */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-accent" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  24-Hour Surveillance Timeline
                </span>
                <span className="text-xs font-mono font-bold text-accent bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
                  {formatSecondsToTime(timelineSecond)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="text-[11px] font-mono text-zinc-500">Click anywhere or drag playhead to navigate 24h archive</span>
              </div>
            </div>

            {/* Timeline Bar Track */}
            <div
              ref={timelineBarRef}
              onClick={handleTimelineClick}
              onMouseEnter={() => setIsHoveringTimeline(true)}
              onMouseLeave={() => {
                setIsHoveringTimeline(false);
                setHoveredTimelineSecond(null);
              }}
              onMouseMove={handleTimelineMouseMove}
              className="relative w-full h-12 bg-surface-2 rounded-lg border border-line cursor-pointer overflow-hidden group shadow-inner"
            >
              {/* Hour Grid Markers */}
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  style={{ left: `${(i / 24) * 100}%` }}
                  className="absolute top-0 bottom-0 border-l border-zinc-800/80 pointer-events-none"
                >
                  {i % 2 === 0 && (
                    <span className="absolute top-1 left-1 text-[9px] font-mono text-zinc-500">
                      {String(i).padStart(2, "0")}:00
                    </span>
                  )}
                </div>
              ))}

              {/* Recorded Footage Blocks */}
              {timelineSegments.map((seg) => (
                <div
                  key={seg.id}
                  style={{ left: seg.left, width: seg.width }}
                  className={`absolute top-5 bottom-1 rounded-sm transition-all ${
                    seg.type === "continuous"
                      ? "bg-cyan-500/60 hover:bg-cyan-400 border border-cyan-400/40"
                      : "bg-amber-500/80 hover:bg-amber-400 border border-amber-400/60"
                  }`}
                  title={seg.title}
                />
              ))}

              {/* Current Active Playhead Cursor */}
              <div
                style={{ left: `${(timelineSecond / 86400) * 100}%` }}
                className="absolute top-0 bottom-0 w-1 bg-red-500 pointer-events-none z-20 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              >
                <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow" />
              </div>

              {/* Hover Cursor Tooltip */}
              {isHoveringTimeline && hoveredTimelineSecond !== null && (
                <div
                  style={{ left: `${(hoveredTimelineSecond / 86400) * 100}%` }}
                  className="absolute top-0 bottom-0 w-0.5 bg-white/40 pointer-events-none z-10"
                >
                  <div className="absolute bottom-1 -left-8 bg-black/90 text-white text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/20 shadow">
                    {formatSecondsToTime(hoveredTimelineSecond)}
                  </div>
                </div>
              )}
            </div>

            {/* Timeline Legend & Stats */}
            <div className="flex flex-wrap items-center justify-between text-xs text-zinc-400 pt-1">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm bg-cyan-500/60 border border-cyan-400/40" />
                  <span>Continuous Video</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm bg-amber-500/80 border border-amber-400/60" />
                  <span>Event & Alert Triggers</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-1 bg-red-500 rounded-full" />
                  <span>Playhead Position</span>
                </div>
              </div>

              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span>Total Clips: <strong className="text-zinc-200">{stats.total}</strong></span>
                <span>• Continuous: <strong className="text-cyan-400">{stats.continuous}</strong></span>
                <span>• Events: <strong className="text-amber-400">{stats.events}</strong></span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Drawer: Clip Library & Incident Explorer */}
        <aside className="w-80 shrink-0 border-l border-line bg-surface-1 flex flex-col overflow-hidden">
          {/* Drawer Header */}
          <div className="p-4 border-b border-line space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-1.5">
                <Layers size={14} className="text-accent" />
                Recorded Segments ({filteredRecordings.length})
              </h2>
              <span className="text-[11px] font-mono text-zinc-400">
                {showAllDates ? "All Dates" : selectedDate}
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-500" />
              <input
                type="text"
                placeholder="Search camera or file..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-2 border border-line rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent/40"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex rounded-lg bg-surface-2 p-0.5 border border-line text-xs">
              <button
                onClick={() => setSelectedType("all")}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  selectedType === "all" ? "bg-surface-3 text-white font-semibold shadow" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                All ({filteredRecordings.length})
              </button>
              <button
                onClick={() => setSelectedType("continuous")}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  selectedType === "continuous" ? "bg-cyan-500/20 text-cyan-300 font-semibold shadow" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Continuous
              </button>
              <button
                onClick={() => setSelectedType("event")}
                className={`flex-1 py-1 rounded-md text-[11px] font-medium transition ${
                  selectedType === "event" ? "bg-amber-500/20 text-amber-300 font-semibold shadow" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Events
              </button>
            </div>
          </div>

          {/* Clips List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredRecordings.length === 0 ? (
              <div className="py-12 px-4 text-center text-zinc-500 space-y-2">
                <Film size={24} className="mx-auto opacity-40" />
                <p className="text-xs">No recording segments found for this filter or date.</p>
                <button
                  onClick={() => {
                    setSelectedCameraId("all");
                    setSelectedType("all");
                    setSearchQuery("");
                    setShowAllDates(true);
                  }}
                  className="text-xs text-accent hover:underline"
                >
                  Show all recorded clips
                </button>
              </div>
            ) : (
              filteredRecordings.map((r) => {
                const isSelected = currentClip?.id === r.id;
                const camName = cameraMap.get(r.camera_id) || r.camera_name || "Camera";
                const startStr = r.start_time ? r.start_time.split("T")[1]?.slice(0, 8) : "--:--:--";
                const endStr = r.end_time ? r.end_time.split("T")[1]?.slice(0, 8) : "In progress";

                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setCurrentClip(r);
                      const sec = parseTimeToSeconds(r.start_time);
                      setTimelineSecond(sec);
                    }}
                    className={`group relative p-3 rounded-xl border transition cursor-pointer flex flex-col gap-1.5 ${
                      isSelected
                        ? "bg-accent/10 border-accent/40 shadow-md"
                        : "bg-surface-2/60 border-line hover:bg-surface-2 hover:border-zinc-700"
                    }`}
                  >
                    {/* Top Row: Camera Name & Type Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Video size={13} className={isSelected ? "text-accent" : "text-zinc-400"} />
                        <span className="truncate text-xs font-semibold text-zinc-200">
                          {camName}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          r.recording_type === "continuous"
                            ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {r.recording_type}
                      </span>
                    </div>

                    {/* Middle Row: Time range & duration */}
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>{startStr} → {endStr}</span>
                      {isSelected && (
                        <span className="flex items-center gap-1 text-accent font-semibold">
                          <Play size={10} className="fill-accent" /> Playing
                        </span>
                      )}
                    </div>

                    {/* Bottom Row: Direct actions */}
                    <div className="pt-1 flex items-center justify-between border-t border-line/50 text-[10px] text-zinc-500">
                      <span className="truncate font-mono max-w-[170px]" title={r.file_path}>
                        {r.file_path.split("/").pop()}
                      </span>
                      <a
                        href={`http://127.0.0.1:8000${r.file_path}`}
                        download
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-zinc-400 hover:text-white transition"
                        title="Download MP4"
                      >
                        <Download size={12} /> Save
                      </a>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      {/* Recording Settings Modal */}
      {configOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-surface-1 border border-line rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-accent/15 text-accent">
                  <Sliders size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Recording Settings</h3>
                  <p className="text-[11px] text-zinc-400">Manage NVR segment duration & AI overlays</p>
                </div>
              </div>
              <button
                onClick={() => setConfigOpen(false)}
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-surface-2 transition"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {/* Segment Duration Selection */}
              <div>
                <label className="block text-xs font-semibold text-zinc-300 mb-2">
                  Recording Segment Duration
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {[5, 10, 15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() =>
                        setRecSettings((prev) => ({ ...prev, segment_minutes: mins }))
                      }
                      className={clsx(
                        "py-2 px-2 rounded-lg text-xs font-mono font-medium border text-center transition",
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
                  Videos are automatically split into MP4 segments of this length for instant playback and archiving.
                </p>
              </div>

              {/* AI Detections in Video Toggle */}
              <div className="p-3.5 rounded-xl bg-surface-2 border border-line flex items-start gap-3">
                <input
                  type="checkbox"
                  id="burnInDetsModal"
                  checked={recSettings.record_with_detections}
                  onChange={(e) =>
                    setRecSettings((prev) => ({
                      ...prev,
                      record_with_detections: e.target.checked,
                    }))
                  }
                  className="mt-1 h-4 w-4 rounded border-zinc-700 bg-surface-3 text-accent focus:ring-accent cursor-pointer accent-accent"
                />
                <label htmlFor="burnInDetsModal" className="flex-1 cursor-pointer">
                  <div className="text-xs font-semibold text-zinc-200">
                    Burn AI Detections into Recordings
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                    Overlays real-time AI bounding boxes, object classification names, tracking IDs, and vehicle speed directly into the recorded MP4 file.
                  </div>
                </label>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-line">
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="px-4 py-2 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-surface-2 transition font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-black font-semibold text-xs hover:bg-accent/90 transition shadow-md disabled:opacity-50"
              >
                {savingConfig ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" /> Saving...
                  </>
                ) : (
                  <>
                    <Check size={14} /> Save Configuration
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
