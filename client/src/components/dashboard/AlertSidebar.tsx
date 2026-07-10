import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Navigation, Clock, Eye, AlertCircle, X } from 'lucide-react';
import { formatMs } from '../../utils/formatters';

interface Alert {
  id: string;
  timestamp: string;
  camera_id: string;
  camera_name: string;
  alert_type: string;
  message: string;
  screenshot_path?: string;
}

interface AlertSidebarProps {
  alerts: Alert[];
  onClear: () => void;
}

export function AlertSidebar({ alerts, onClear }: AlertSidebarProps) {
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);

  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'intrusion':
        return <ShieldAlert className="text-red-400" size={16} />;
      case 'crossing':
        return <Navigation className="text-blue-400 rotate-45" size={16} />;
      case 'loitering':
        return <Clock className="text-amber-400" size={16} />;
      default:
        return <AlertCircle className="text-slate-400" size={16} />;
    }
  };

  const getAlertBorderColor = (type: string) => {
    switch (type) {
      case 'intrusion':
        return 'border-red-500/30 bg-red-500/5';
      case 'crossing':
        return 'border-blue-500/30 bg-blue-500/5';
      case 'loitering':
        return 'border-amber-500/30 bg-amber-500/5';
      default:
        return 'border-slate-800 bg-slate-900/20';
    }
  };

  return (
    <div className="glass-card flex flex-col h-full border border-brand-500/10 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b bg-slate-900/60" style={{ borderColor: 'rgba(99,102,241,0.1)' }}>
        <h3 className="text-sm font-semibold text-white">Live Event Timeline</h3>
        {alerts.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] font-bold text-slate-400 hover:text-red-400 transition-colors uppercase tracking-wider"
          >
            Clear All
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-12 gap-2">
            <ShieldAlert size={28} className="opacity-30" />
            <span className="text-xs font-semibold">No alerts logged</span>
            <span className="text-[10px] text-center max-w-[160px] opacity-60">System monitoring zones and line crossings.</span>
          </div>
        ) : (
          <AnimatePresence>
            {alerts.map((alert) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={`p-3 rounded-xl border flex gap-3 ${getAlertBorderColor(alert.alert_type)}`}
              >
                <div className="mt-0.5">{getAlertIcon(alert.alert_type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-brand-300 uppercase truncate max-w-[100px]">
                      {alert.camera_name}
                    </span>
                    <span className="text-[9px] font-mono text-slate-500">
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-xs text-white/95 mt-1 font-medium leading-relaxed">
                    {alert.message}
                  </p>
                </div>
                {alert.screenshot_path && (
                  <div
                    className="relative group cursor-zoom-in w-16 h-10 rounded border border-brand-500/10 overflow-hidden flex-shrink-0"
                    onClick={() => setSelectedSnapshot(alert.screenshot_path!)}
                  >
                    <img
                      src={alert.screenshot_path}
                      alt="Alert Screenshot"
                      className="w-full h-full object-cover transition-transform group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Eye size={10} className="text-white" />
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Snapshot Preview Modal */}
      <AnimatePresence>
        {selectedSnapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedSnapshot(null)}
            className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[999]"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="relative max-w-4xl max-h-[85vh] rounded-2xl overflow-hidden border border-brand-500/20 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={selectedSnapshot} alt="Snapshot Preview" className="max-w-full max-h-[80vh] object-contain" />
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="absolute top-3 right-3 p-2 rounded-full bg-slate-950/80 text-white hover:bg-slate-900 border border-white/10"
              >
                <X size={16} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
