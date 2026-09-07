import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ZoomIn, ZoomOut, RotateCcw,
  Clock, Download,
  CheckCircle2,
  Layers, Disc,
  Play, Pause
} from "lucide-react";

interface TimelineEvent {
  timeStr: string;
  hourFraction: number; // 0.0 to 1.0 (representing 00:00 to 24:00)
  type: "speed" | "intrusion" | "plate";
  label: string;
  color: string;
}

const SAMPLE_EVENTS: TimelineEvent[] = [
  { timeStr: "03:14 AM", hourFraction: 3.23 / 24, type: "intrusion", label: "Fence Breach", color: "bg-rose-500" },
  { timeStr: "07:45 AM", hourFraction: 7.75 / 24, type: "plate", label: "Delivery Truck #402", color: "bg-sky-400" },
  { timeStr: "09:15 AM", hourFraction: 9.25 / 24, type: "speed", label: "Speed 68 km/h", color: "bg-amber-400" },
  { timeStr: "11:30 AM", hourFraction: 11.5 / 24, type: "plate", label: "VIP Pass Verified", color: "bg-emerald-400" },
  { timeStr: "14:22 PM", hourFraction: 14.36 / 24, type: "intrusion", label: "Perimeter Loitering", color: "bg-rose-500" },
  { timeStr: "17:50 PM", hourFraction: 17.83 / 24, type: "speed", label: "Speed 72 km/h", color: "bg-amber-400" },
  { timeStr: "20:05 PM", hourFraction: 20.08 / 24, type: "plate", label: "Late Vehicle Entry", color: "bg-sky-400" },
];

export default function ContinuousNVRSection() {
  // Playback & Recording state
  const [isRecording, setIsRecording] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [burnDetections, setBurnDetections] = useState(true);
  const [segmentDuration, setSegmentDuration] = useState<number>(15);
  const [activeCam, setActiveCam] = useState<"CAM-01" | "CAM-02">("CAM-01");
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [currentTimeStr, setCurrentTimeStr] = useState("14:22:45");
  const [timelinePosition, setTimelinePosition] = useState(0.60); // 14:24 out of 24 hrs
  
  // Digital Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Mock timestamp ticker
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const hrs = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');
      setCurrentTimeStr(`${hrs}:${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const fraction = clickX / rect.width;
    setTimelinePosition(fraction);

    const totalMinutes = Math.floor(fraction * 24 * 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const secs = Math.floor((fraction * 86400) % 60);
    setCurrentTimeStr(
      `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    );
  };

  const handleZoom = (delta: number) => {
    setZoom((prev) => {
      const next = Math.min(4.0, Math.max(1.0, Number((prev + delta).toFixed(1))));
      if (next === 1.0) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePan = (dx: number, dy: number) => {
    if (zoom <= 1.0) return;
    const maxOffset = (zoom - 1) * 35;
    setPan((prev) => ({
      x: Math.min(maxOffset, Math.max(-maxOffset, prev.x + dx)),
      y: Math.min(maxOffset, Math.max(-maxOffset, prev.y + dy)),
    }));
  };

  const resetZoom = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  return (
    <section id="nvr-recording" className="relative py-16 sm:py-28 overflow-hidden bg-gradient-to-b from-white via-sky-50/60 to-slate-100 text-slate-900 border-t border-sky-100">
      
      {/* Background Decorative Ambient Glows */}
      <div className="absolute top-1/3 -left-32 w-96 h-96 bg-sky-200/40 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-indigo-200/40 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-sky-300 text-sky-800 text-xs font-bold uppercase tracking-wider mb-3 shadow-xs"
          >
            <Disc className="w-4 h-4 text-rose-500 animate-spin" style={{ animationDuration: '4s' }} />
            <span>24/7 CONTINUOUS NVR RECORDING &amp; DIGITAL ZOOM STUDIO</span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black tracking-tight text-slate-900 leading-tight"
          >
            Never Miss a Second.
            <br />
            <span className="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Continuous NVR Storage &amp; 4X Zoom Studio
            </span>
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mt-4 text-slate-600 text-xs sm:text-base leading-relaxed font-medium"
          >
            Enterprise continuous MP4 segmented recording with optional burned-in AI bounding boxes and speed telemetry.
            Scrub 24 hours of history fluidly with instant digital zoom &amp; pan on Desktop and Mobile APK.
          </motion.p>
        </div>

        {/* NVR Control Room Studio Player Container */}
        <div className="rounded-3xl border border-slate-800 bg-slate-950 p-3 sm:p-6 shadow-2xl shadow-sky-950/20 text-slate-100">
          
          {/* Top Studio Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
            
            {/* Camera Switcher & Status */}
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setActiveCam("CAM-01")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                    activeCam === "CAM-01"
                      ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  CAM-01 (GATE)
                </button>
                <button
                  onClick={() => setActiveCam("CAM-02")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                    activeCam === "CAM-02"
                      ? "bg-sky-500 text-white shadow-md shadow-sky-500/30"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  CAM-02 (RADAR)
                </button>
              </div>

              {/* Per-Camera REC Switch Button */}
              <button
                onClick={() => setIsRecording((prev) => !prev)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border font-mono text-xs font-bold transition ${
                  isRecording
                    ? "bg-rose-950/40 border-rose-500/50 text-rose-300 hover:bg-rose-900/50"
                    : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
                title="Click to toggle continuous 24/7 background recording for this camera"
              >
                <span className={`w-2.5 h-2.5 rounded-full ${isRecording ? "bg-rose-500 animate-pulse" : "bg-slate-600"}`} />
                <span>{isRecording ? "REC ACTIVE" : "REC PAUSED"}</span>
              </button>
            </div>

            {/* AI Burn-In & Duration Controls */}
            <div className="flex flex-wrap items-center gap-2">
              
              {/* Burn-in Toggle */}
              <button
                onClick={() => setBurnDetections((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold transition ${
                  burnDetections
                    ? "bg-sky-950/50 border-sky-400 text-sky-300"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300"
                }`}
                title="Burn real-time YOLO bounding boxes, class labels, and speed radar directly into the saved MP4 video"
              >
                <Layers size={14} className={burnDetections ? "text-sky-400" : "text-slate-500"} />
                <span>BURN-IN TELEMETRY: {burnDetections ? "ON" : "OFF"}</span>
              </button>

              {/* Segment Duration Selector */}
              <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded-xl border border-slate-800 text-xs font-mono">
                <span className="text-slate-400 hidden sm:inline mr-1">SEGMENT:</span>
                {[5, 10, 15, 30, 60].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => setSegmentDuration(mins)}
                    className={`px-2 py-1 rounded font-bold transition ${
                      segmentDuration === mins
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>

            </div>

          </div>

          {/* Main Video Viewport with Digital Zoom & Burn-In Overlay */}
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 shadow-inner h-[320px] sm:h-[480px]">
            
            {/* The scaled video element */}
            <div
              className="w-full h-full relative transition-transform duration-200 ease-out"
              style={{
                transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: "center center",
              }}
            >
              <video
                key={activeCam}
                src={activeCam === "CAM-01" ? "/videos/junction.mp4" : "/videos/speed.mp4"}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover select-none pointer-events-none"
              />

              {/* Burned-in AI Overlays when burnDetections is true */}
              {burnDetections && (
                <div className="absolute inset-0 pointer-events-none">
                  {/* Top-left burn-in watermark */}
                  <div className="absolute top-4 left-4 font-mono text-[10px] sm:text-xs text-white bg-black/60 px-2.5 py-1 rounded backdrop-blur-xs border border-white/20">
                    <span className="text-emerald-400 font-bold">CAMAI PRO REC · {activeCam}</span>
                    <span className="mx-1.5 text-slate-500">|</span>
                    <span>2026-09-07 {currentTimeStr} UTC</span>
                  </div>

                  {/* Top-right codec and bitrate watermark */}
                  <div className="absolute top-4 right-4 font-mono text-[9px] sm:text-[10px] text-slate-300 bg-black/60 px-2.5 py-1 rounded backdrop-blur-xs border border-white/20">
                    <span>H.264 · 1080p@60FPS · 4.8 Mbps</span>
                  </div>

                  {/* Bounding Box 1 */}
                  {activeCam === "CAM-01" ? (
                    <>
                      <div className="absolute top-[28%] left-[24%] w-[26%] h-[24%] border-2 border-sky-400 bg-sky-500/10 rounded">
                        <div className="bg-sky-500 text-slate-950 font-bold font-mono text-[9px] sm:text-[10px] px-1.5 py-0.5 inline-block">
                          VEHICLE #104 · 98.4% · 54 km/h
                        </div>
                      </div>
                      <div className="absolute bottom-[22%] right-[28%] w-[22%] h-[28%] border-2 border-emerald-400 bg-emerald-500/10 rounded">
                        <div className="bg-emerald-500 text-slate-950 font-bold font-mono text-[9px] sm:text-[10px] px-1.5 py-0.5 inline-block">
                          BUS #88 · 96.1% · IN-LANE
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="absolute top-[32%] left-[34%] w-[28%] h-[30%] border-2 border-amber-400 bg-amber-500/10 rounded">
                        <div className="bg-amber-500 text-slate-950 font-bold font-mono text-[9px] sm:text-[10px] px-1.5 py-0.5 inline-block">
                          SPEED RADAR: 68.4 km/h [ZONE ALERT]
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Non-scaling HUD Controls Overlay (Floating inside player) */}
            <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-3 pointer-events-auto">
              
              {/* Digital Zoom Controls Bar */}
              <div className="flex items-center gap-1.5 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 shadow-lg text-xs font-mono">
                <span className="text-slate-400 font-bold mr-1 hidden sm:inline">ZOOM:</span>
                <button
                  onClick={() => handleZoom(-0.5)}
                  disabled={zoom <= 1.0}
                  className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-300"
                  title="Zoom Out (-)"
                >
                  <ZoomOut size={16} />
                </button>
                
                <span className="font-extrabold text-sky-400 w-10 text-center">{zoom.toFixed(1)}x</span>

                <button
                  onClick={() => handleZoom(0.5)}
                  disabled={zoom >= 4.0}
                  className="p-1 rounded hover:bg-slate-800 disabled:opacity-30 text-slate-300"
                  title="Zoom In (+)"
                >
                  <ZoomIn size={16} />
                </button>

                {zoom > 1.0 && (
                  <>
                    <div className="w-[1px] h-4 bg-slate-700 mx-1" />
                    <button
                      onClick={resetZoom}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 flex items-center gap-1"
                    >
                      <RotateCcw size={11} />
                      <span>1x</span>
                    </button>

                    {/* Quick Pan Directional Micro-pads */}
                    <div className="hidden sm:flex items-center gap-0.5 ml-1 text-slate-400">
                      <button onClick={() => handlePan(-10, 0)} className="px-1 hover:text-white">◀</button>
                      <button onClick={() => handlePan(0, -10)} className="px-1 hover:text-white">▲</button>
                      <button onClick={() => handlePan(0, 10)} className="px-1 hover:text-white">▼</button>
                      <button onClick={() => handlePan(10, 0)} className="px-1 hover:text-white">▶</button>
                    </div>
                  </>
                )}
              </div>

              {/* Status Badge & Speed Selector */}
              <div className="flex items-center gap-2 bg-slate-950/85 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 text-xs font-mono">
                <button
                  onClick={() => setIsPlaying((p) => !p)}
                  className="p-1 text-sky-400 hover:text-sky-300"
                  title={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                </button>

                <div className="flex items-center gap-1 text-[10px]">
                  {[1, 2, 4].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-1.5 py-0.5 rounded ${
                        playbackSpeed === spd ? "bg-sky-500 text-white font-bold" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>

                <div className="w-[1px] h-3 bg-slate-700" />
                <span className="text-emerald-400 font-bold">{currentTimeStr}</span>
              </div>

            </div>

          </div>

          {/* 24-Hour Timeline Scrubbing Bar */}
          <div className="mt-4 p-3 sm:p-4 rounded-2xl bg-slate-900/90 border border-slate-800">
            
            <div className="flex items-center justify-between text-xs font-mono mb-2 text-slate-400">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-sky-400" />
                <span className="font-bold text-slate-200">24-HOUR TIMELINE SCRUBBER</span>
                <span className="text-slate-500 hidden sm:inline">• Click anywhere to seek instantly</span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-sky-500/80" /> Continuous Rec
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-amber-400" /> Motion / Speed
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded bg-rose-500" /> Alert Event
                </span>
              </div>
            </div>

            {/* Timeline Track */}
            <div
              onClick={handleTimelineClick}
              className="relative h-10 w-full bg-slate-950 rounded-xl cursor-pointer border border-slate-800 overflow-hidden group select-none"
            >
              {/* Continuous Recording Bands (Simulating 24h recorded history) */}
              <div className="absolute inset-y-1.5 left-[2%] right-[2%] bg-gradient-to-r from-sky-600/40 via-blue-600/50 to-indigo-600/40 rounded-md border border-sky-500/30" />

              {/* Event Markers on Timeline */}
              {SAMPLE_EVENTS.map((ev, idx) => (
                <div
                  key={idx}
                  style={{ left: `${ev.hourFraction * 100}%` }}
                  className={`absolute top-0 bottom-0 w-1.5 ${ev.color} opacity-90 transition-transform group-hover:scale-y-110`}
                  title={`${ev.timeStr}: ${ev.label}`}
                />
              ))}

              {/* Playhead Scrubber Needle */}
              <div
                style={{ left: `${timelinePosition * 100}%` }}
                className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_12px_#38bdf8] pointer-events-none z-20 flex flex-col items-center"
              >
                <div className="w-3 h-3 bg-sky-400 rounded-full -mt-1 shadow-md shadow-sky-500 border border-white" />
              </div>

              {/* 24h Hour Tick Marks */}
              <div className="absolute inset-x-0 bottom-1 flex justify-between px-3 text-[8.5px] font-mono text-slate-500 pointer-events-none">
                <span>00:00</span>
                <span>04:00</span>
                <span>08:00</span>
                <span>12:00</span>
                <span>16:00</span>
                <span>20:00</span>
                <span>23:59</span>
              </div>
            </div>

            {/* Active Segment Metadata Strip */}
            <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex flex-wrap items-center gap-3 text-slate-300 text-[11px]">
                <span>
                  <strong className="text-slate-400">File:</strong> REC_20260907_141500_CAM01.mp4
                </span>
                <span>
                  <strong className="text-slate-400">Duration:</strong> {segmentDuration}:00m (900s)
                </span>
                <span>
                  <strong className="text-slate-400">Size:</strong> 284.6 MB
                </span>
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <CheckCircle2 size={12} /> Indexed in SQLite
                </span>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href="/videos/junction.mp4"
                  download="REC_20260907_141500_CAM01.mp4"
                  className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] flex items-center gap-1.5 transition shadow-sm"
                >
                  <Download size={13} />
                  <span>Download MP4</span>
                </a>
              </div>
            </div>

          </div>

        </div>

        {/* 4 Technical Feature Spec Cards Below the Demo */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="p-5 rounded-2xl bg-white border border-sky-100 shadow-xs hover:border-sky-300 transition group">
            <div className="w-10 h-10 rounded-xl bg-sky-100 text-sky-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Disc size={20} />
            </div>
            <h4 className="font-extrabold text-sm text-slate-900 mb-1">
              Zero-Drop Circular Ring Buffer
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Continuous background segmented writing in configurable 5 to 60 minute chunks with zero dropped frames. Automatic FIFO quota retention cleans oldest clips seamlessly.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-sky-100 shadow-xs hover:border-sky-300 transition group">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Layers size={20} />
            </div>
            <h4 className="font-extrabold text-sm text-slate-900 mb-1">
              AI Detection Burn-In Option
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Stamp bounding boxes, confidence scores, optical speed vectors (km/h), and UTC timestamps directly into standard H.264 MP4 frames for court-admissible evidence.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-sky-100 shadow-xs hover:border-sky-300 transition group">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Layers size={20} />
            </div>
            <h4 className="font-extrabold text-sm text-slate-900 mb-1">
              Microsecond SQLite Catalog
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every segment, camera UUID, duration, start/end timestamp, and detection event metadata is cataloged in an embedded SQLite database for sub-second timeline seeks.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-white border border-sky-100 shadow-xs hover:border-sky-300 transition group">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <ZoomIn size={20} />
            </div>
            <h4 className="font-extrabold text-sm text-slate-900 mb-1">
              4X Lossless Digital Zoom &amp; Pan
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              Inspect license plates, faces, or distant perimeter fence lines with up to 4x smooth digital zoom and pan on both Windows Desktop and Android Mobile APK.
            </p>
          </div>

        </div>

      </div>
    </section>
  );
}
