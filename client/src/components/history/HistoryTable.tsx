import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Download, ChevronDown, ChevronUp, Users, Clock, Activity } from 'lucide-react';
import { useHistory } from '../../hooks/useHistory';
import { formatDate, formatMs, formatConfidence, formatRelative } from '../../utils/formatters';

export function HistoryTable() {
  const { history, count, isLoading, clearHistory, isClearing } = useHistory();
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleDownloadJSON = () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `camai_history_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'rgba(99,102,241,0.08)' }} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {count} detection{count !== 1 ? 's' : ''} recorded
        </p>
        <div className="flex gap-2">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={handleDownloadJSON}
            disabled={count === 0}
            className="btn-ghost flex items-center gap-1.5 text-xs border disabled:opacity-40"
            style={{ borderColor: 'rgba(99,102,241,0.2)' }}
          >
            <Download size={13} />
            Download JSON
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={clearHistory}
            disabled={count === 0 || isClearing}
            className="btn-danger flex items-center gap-1.5 text-xs disabled:opacity-40"
          >
            <Trash2 size={13} />
            {isClearing ? 'Clearing…' : 'Clear All'}
          </motion.button>
        </div>
      </div>

      {/* Records */}
      {count === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--color-text-muted)' }}>
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No detections yet. Start the camera to begin.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {history.map((record, idx) => (
              <motion.div
                key={record.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ delay: idx < 10 ? idx * 0.02 : 0 }}
                className="glass-card overflow-hidden"
              >
                {/* Row */}
                <button
                  className="w-full flex items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-brand-500/5"
                  onClick={() => setExpanded(expanded === record.id ? null : record.id)}
                >
                  {/* Thumbnail */}
                  {record.imageBase64 ? (
                    <img
                      src={`data:image/jpeg;base64,${record.imageBase64.slice(0, 8) === '/9j/' || true ? record.imageBase64 : record.imageBase64}`}
                      alt="capture"
                      className="w-14 h-10 object-cover rounded-lg flex-shrink-0"
                      style={{ border: '1px solid rgba(99,102,241,0.2)' }}
                    />
                  ) : (
                    <div className="w-14 h-10 rounded-lg flex-shrink-0 bg-brand-900/30" />
                  )}

                  {/* Status badge */}
                  <div className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    record.status === 'human_found'
                      ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20'
                      : 'bg-slate-400/10 text-slate-400 border border-slate-400/20'
                  }`}>
                    {record.status === 'human_found' ? `${record.peopleCount} Human` : 'No Human'}
                  </div>

                  {/* Confidence */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Activity size={11} />
                    {formatConfidence(record.confidence)}
                  </div>

                  {/* Time */}
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <Clock size={11} />
                    {formatRelative(record.timestamp)}
                  </div>

                  {/* Processing time */}
                  <span className="text-xs font-mono ml-auto" style={{ color: 'var(--color-text-muted)' }}>
                    {formatMs(record.processingTime)}
                  </span>

                  {expanded === record.id
                    ? <ChevronUp size={14} className="text-brand-400 ml-2" />
                    : <ChevronDown size={14} className="opacity-40 ml-2" />
                  }
                </button>

                {/* Expanded detail */}
                <AnimatePresence>
                  {expanded === record.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Captured frame */}
                        <div>
                          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>Captured Frame</p>
                          {record.imageBase64 && (
                            <img
                              src={`data:image/jpeg;base64,${record.imageBase64}`}
                              alt="Detection frame"
                              className="w-full rounded-xl object-cover"
                              style={{ border: '1px solid rgba(99,102,241,0.2)', maxHeight: 200 }}
                            />
                          )}
                        </div>
                        {/* Metadata */}
                        <div className="space-y-2 text-xs">
                          <p className="font-semibold mb-2" style={{ color: 'var(--color-text-muted)' }}>Details</p>
                          {[
                            ['ID', record.id.slice(0, 8) + '…'],
                            ['Timestamp', formatDate(record.timestamp)],
                            ['People Count', String(record.peopleCount)],
                            ['Confidence', formatConfidence(record.confidence)],
                            ['Total Time', formatMs(record.processingTime)],
                            ['YOLO Latency', formatMs(record.yoloLatency)],
                            ['Inference Latency', record.samLatency > 0 ? formatMs(record.samLatency) : '—'],
                          ].map(([k, v]) => (
                            <div key={k} className="flex justify-between py-1 border-b" style={{ borderColor: 'rgba(99,102,241,0.08)' }}>
                              <span style={{ color: 'var(--color-text-muted)' }}>{k}</span>
                              <span className="font-mono text-white">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
