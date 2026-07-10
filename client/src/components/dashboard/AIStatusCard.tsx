import React from 'react';
import { motion } from 'framer-motion';
import { Brain, CheckCircle, AlertCircle, Clock, Activity } from 'lucide-react';
import { formatMs, formatConfidence } from '../../utils/formatters';
import type { DetectResponse } from '../../types';

interface AIStatusCardProps {
  lastResult: DetectResponse | null;
  isProcessing: boolean;
  error: string | null;
  totalDetections: number;
}

export function AIStatusCard({ lastResult, isProcessing, error, totalDetections }: AIStatusCardProps) {
  const status = isProcessing ? 'processing' : error ? 'error' : lastResult ? 'ready' : 'idle';

  const statusConfig = {
    processing: { label: 'Processing…', color: 'text-amber-400', dotClass: 'processing', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.25)' },
    error: { label: 'Error', color: 'text-red-400', dotClass: 'offline', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.25)' },
    ready: { label: 'Active', color: 'text-emerald-400', dotClass: 'online', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.25)' },
    idle: { label: 'Standby', color: 'text-slate-400', dotClass: 'offline', bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.2)' },
  }[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="glass-card p-5 col-span-full lg:col-span-2"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(99,102,241,0.12)' }}>
            <Brain size={17} className="text-brand-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">AI Engine Status</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>YOLO11n Seg local inference</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
          style={{ background: statusConfig.bg, border: `1px solid ${statusConfig.border}` }}>
          <div className={`status-dot ${statusConfig.dotClass}`} />
          <span className={statusConfig.color}>{statusConfig.label}</span>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-start gap-2 p-3 rounded-xl mb-4 text-sm text-red-400"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </motion.div>
      )}

      {/* Latest prediction details */}
      {lastResult && !isProcessing && (
        <motion.div
          key={lastResult.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-3"
        >
          {[
            {
              icon: lastResult.status === 'human_found' ? CheckCircle : AlertCircle,
              label: 'Detection',
              value: lastResult.status === 'human_found' ? `${lastResult.people} Person${lastResult.people > 1 ? 's' : ''}` : 'No Human',
              color: lastResult.status === 'human_found' ? 'text-emerald-400' : 'text-slate-400',
            },
            {
              icon: Activity,
              label: 'Confidence',
              value: lastResult.detections.length > 0
                ? formatConfidence(Math.max(...lastResult.detections.map(d => d.confidence)))
                : '—',
              color: 'text-brand-400',
            },
            {
              icon: Clock,
              label: 'YOLO Latency',
              value: formatMs(lastResult.yoloLatency),
              color: 'text-amber-400',
            },
            {
              icon: Clock,
              label: 'FPS',
              value: lastResult.fps > 0 ? `${lastResult.fps}` : '—',
              color: 'text-purple-400',
            },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="p-3 rounded-xl" style={{ background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.1)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Icon size={12} className={color} />
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
              </div>
              <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
            </div>
          ))}
        </motion.div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.06)' }}>
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400"
                animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
            ))}
          </div>
          <span className="text-sm text-amber-400 font-medium">Running AI inference…</span>
        </div>
      )}

      {!lastResult && !isProcessing && !error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--color-text-muted)' }}>
          Start the camera to begin detection
        </p>
      )}
    </motion.div>
  );
}
