import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, CameraOff, Zap, ZapOff, Eye, EyeOff, AlertTriangle, Users, Activity, Clock, Layers } from 'lucide-react';
import { useWebcam } from '../../hooks/useWebcam';
import { useDetection } from '../../hooks/useDetection';
import { DetectionOverlay } from './DetectionOverlay';
import { formatMs, formatConfidence } from '../../utils/formatters';

export function CameraFeed() {
  const [showSegmentation, setShowSegmentation] = useState(true);
  const [videoDims, setVideoDims] = useState({ width: 640, height: 480 });

  const webcam = useWebcam();
  const detection = useDetection();

  // Start/stop the detection loop when camera starts/stops
  const handleStartCamera = useCallback(async () => {
    await webcam.startCamera();
  }, [webcam]);

  // Once camera is active, start the detection loop
  useEffect(() => {
    if (webcam.isActive) {
      // Small delay to let the video element initialize
      const timer = setTimeout(() => {
        detection.startLoop(webcam.captureFrame);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [webcam.isActive]); // intentionally not including detection/captureFrame to avoid restart loops

  const handleStopCamera = useCallback(() => {
    detection.stopLoop();
    webcam.stopCamera();
    detection.reset();
  }, [webcam, detection]);

  const handleManualCapture = useCallback(async () => {
    const blob = await webcam.captureFrame();
    if (blob) {
      detection.submitFrame(blob);
    }
  }, [webcam, detection]);

  // Update video dimensions on load
  const handleVideoMeta = useCallback(() => {
    if (webcam.videoRef.current) {
      setVideoDims({
        width: webcam.videoRef.current.videoWidth || 640,
        height: webcam.videoRef.current.videoHeight || 480,
      });
    }
  }, [webcam.videoRef]);

  const lastResult = detection.lastResult;
  const hasHuman = lastResult?.status === 'human_found';

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      {/* Top metrics bar */}
      {webcam.isActive && (
        <div className="flex items-center gap-3 flex-wrap">
          <MetricBadge
            icon={<Activity size={13} />}
            label="Inference"
            value={`${detection.inferFps} FPS`}
            color={detection.inferFps > 5 ? '#10b981' : detection.inferFps > 2 ? '#f59e0b' : '#ef4444'}
          />
          <MetricBadge
            icon={<Clock size={13} />}
            label="Latency"
            value={formatMs(detection.latencyMs)}
            color="#a5b4fc"
          />
          <MetricBadge
            icon={<Users size={13} />}
            label="People"
            value={String(lastResult?.people ?? 0)}
            color={hasHuman ? '#10b981' : '#64748b'}
          />
          <MetricBadge
            icon={<Camera size={13} />}
            label="Camera"
            value={`${webcam.fps} FPS`}
            color="#06b6d4"
          />
          <MetricBadge
            icon={<Layers size={13} />}
            label="Dropped"
            value={String(detection.droppedFrames)}
            color="#64748b"
          />
          {lastResult?.yoloLatency !== undefined && (
            <MetricBadge
              icon={<Zap size={13} />}
              label="YOLO"
              value={formatMs(lastResult.yoloLatency)}
              color="#818cf8"
            />
          )}
        </div>
      )}

      {/* Camera viewport */}
      <div className="relative rounded-2xl overflow-hidden flex-1 min-h-0"
        style={{ background: '#0a0a0f', border: '1px solid rgba(99,102,241,0.2)' }}>
        
        {/* Video element */}
        <video
          ref={webcam.videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleVideoMeta}
          className="w-full h-full object-contain"
          style={{ display: webcam.isActive ? 'block' : 'none' }}
        />

        {/* Hidden canvas for frame capture */}
        <canvas ref={webcam.canvasRef} className="hidden" />

        {/* Placeholder when camera is off */}
        {!webcam.isActive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <Camera size={32} className="text-brand-400 opacity-60" />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
              Camera Inactive
            </p>
            <p className="text-xs text-center max-w-xs px-4" style={{ color: 'rgba(100,116,139,0.6)' }}>
              Click "Start Camera" to begin real-time human detection and segmentation
            </p>
          </div>
        )}

        {/* Detection overlay */}
        {webcam.isActive && lastResult && (
          <DetectionOverlay
            detections={lastResult.detections}
            lastResult={lastResult}
            videoWidth={videoDims.width}
            videoHeight={videoDims.height}
            showSegmentation={showSegmentation}
          />
        )}

        {/* HUD overlays */}
        {webcam.isActive && (
          <>
            {/* Live indicator */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold"
              style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', backdropFilter: 'blur(4px)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE · {detection.inferFps} FPS
            </div>

            {/* Processing indicator */}
            {detection.isProcessing && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24', backdropFilter: 'blur(4px)' }}>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                Processing…
              </div>
            )}

            {/* Detection result banner */}
            <AnimatePresence mode="wait">
              {lastResult && (
                <motion.div
                  key={lastResult.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute bottom-3 left-3 right-3"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-xl text-sm font-semibold"
                    style={{
                      background: hasHuman ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)',
                      border: `1px solid ${hasHuman ? 'rgba(16,185,129,0.4)' : 'rgba(100,116,139,0.3)'}`,
                      backdropFilter: 'blur(8px)',
                      color: hasHuman ? '#34d399' : '#94a3b8',
                    }}>
                    <div className="flex items-center gap-2">
                      <Users size={14} />
                      <span>
                        {hasHuman
                          ? `${lastResult.people} Human${lastResult.people > 1 ? 's' : ''} Detected`
                          : 'No Human Found'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs opacity-80">
                      {hasHuman && (
                        <span>
                          {formatConfidence(
                            lastResult.detections.length > 0
                              ? Math.max(...lastResult.detections.map(d => d.confidence))
                              : null
                          )}
                        </span>
                      )}
                      <span>{formatMs(lastResult.processingTime)}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

        {/* Camera error */}
        {webcam.error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
            <AlertTriangle size={32} className="text-red-400" />
            <p className="text-sm font-semibold text-red-400 text-center">{webcam.error}</p>
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Start / Stop Camera */}
        {!webcam.isActive ? (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleStartCamera}
            id="btn-start-camera"
            className="btn-primary flex items-center gap-2"
          >
            <Camera size={15} />
            Start Camera
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleStopCamera}
            id="btn-stop-camera"
            className="btn-danger flex items-center gap-2"
          >
            <CameraOff size={15} />
            Stop Camera
          </motion.button>
        )}

        {/* Manual capture */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          disabled={!webcam.isActive || detection.isProcessing}
          onClick={handleManualCapture}
          id="btn-capture"
          className="btn-ghost border flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ borderColor: 'rgba(99,102,241,0.2)' }}
        >
          <Camera size={15} />
          Capture Now
        </motion.button>

        {/* Segmentation toggle */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowSegmentation((v) => !v)}
          className={`btn-ghost flex items-center gap-2 ml-auto ${showSegmentation ? 'text-brand-400' : ''}`}
        >
          {showSegmentation ? <Eye size={15} /> : <EyeOff size={15} />}
          Segmentation {showSegmentation ? 'ON' : 'OFF'}
        </motion.button>
      </div>

      {/* Detection error */}
      {detection.error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-400"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>{detection.error}</span>
        </motion.div>
      )}
    </div>
  );
}

/** Small metric badge component for the HUD bar */
function MetricBadge({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
      style={{
        background: 'rgba(18,18,26,0.8)',
        border: '1px solid rgba(99,102,241,0.15)',
        color: 'var(--color-text-muted)',
      }}>
      <span style={{ color }}>{icon}</span>
      <span className="opacity-60">{label}</span>
      <span className="font-mono font-bold" style={{ color }}>{value}</span>
    </div>
  );
}
