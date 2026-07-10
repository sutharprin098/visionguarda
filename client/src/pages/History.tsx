import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Video, List, Play, Clock, Calendar, ShieldAlert, FileVideo, X, Trash2, Download, Eye, AlertCircle } from 'lucide-react';
import { Header } from '../components/layout/Header';
import { HistoryTable } from '../components/history/HistoryTable';
import { formatDate } from '../utils/formatters';

interface Recording {
  id: string;
  camera_id: string;
  camera_name: string;
  start_time: string;
  end_time: string | null;
  recording_type: 'continuous' | 'event';
  file_path: string;
}

export default function HistoryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'detections' | 'recordings' | 'alerts'>('detections');
  const [selectedVideo, setSelectedVideo] = useState<Recording | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  
  // Fetch recordings list
  const { data: recordings = [], isLoading: recsLoading } = useQuery<Recording[]>({
    queryKey: ['recordings'],
    queryFn: async () => {
      const { data } = await axios.get('/api/recordings');
      return data;
    },
    refetchInterval: 5000, // poll for new recordings every 5s
  });

  // Fetch alerts list
  const { data: alerts = [], isLoading: alertsLoading } = useQuery<any[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await axios.get('/api/alerts');
      return data;
    },
    refetchInterval: 5000,
  });

  // Delete alert mutation
  const deleteAlertMutation = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/alerts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  // Clear all alerts mutation
  const clearAlertsMutation = useMutation({
    mutationFn: async () => {
      await axios.delete('/api/alerts');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const handleDownloadSnapshot = (url: string, cameraName: string, timestamp: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `alert_${cameraName.replace(/\s+/g, '_')}_${new Date(timestamp).getTime()}.jpg`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
      <Header title="Surveillance Archive" subtitle="Browse detection history and CCTV recordings" />

      {/* Tab select bar */}
      <div className="flex items-center justify-between px-6 py-2 border-b bg-slate-900/60" style={{ borderColor: 'rgba(99,102,241,0.1)' }}>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('detections')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'detections'
                ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <List size={13} />
            Detection Logs
          </button>
          <button
            onClick={() => setActiveTab('recordings')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'recordings'
                ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Video size={13} />
            CCTV Playback
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'alerts'
                ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ShieldAlert size={13} />
            Security Alerts
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'detections' ? (
          <HistoryTable />
        ) : activeTab === 'recordings' ? (
          <div className="space-y-4">
            {recsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse bg-slate-900" />
                ))}
              </div>
            ) : recordings.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <FileVideo size={40} className="mx-auto mb-3 opacity-30 animate-pulse" />
                <p className="text-sm font-semibold">No recordings found</p>
                <p className="text-xs max-w-sm mx-auto mt-1 opacity-60">
                  Recordings will appear once cameras are active and triggering events.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {recordings.map((rec) => (
                  <motion.div
                    key={rec.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="glass-card flex flex-col p-4 border border-brand-500/10 hover:border-brand-500/30 transition-all group cursor-pointer"
                    onClick={() => setSelectedVideo(rec)}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                        rec.recording_type === 'event'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}>
                        {rec.recording_type}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {rec.camera_name}
                      </span>
                    </div>

                    <div className="aspect-video bg-slate-950 rounded-lg relative flex items-center justify-center group-hover:bg-slate-900 transition-colors border border-brand-500/5">
                      <Play size={28} className="text-brand-400 group-hover:scale-110 transition-transform opacity-70 group-hover:opacity-100" />
                      <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] font-bold text-slate-400">
                        <Clock size={11} />
                        {rec.end_time ? 'Completed Segment' : 'Recording Live'}
                      </div>
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-slate-400">
                      <div className="flex justify-between">
                        <span>Started:</span>
                        <span className="font-semibold text-white">{new Date(rec.start_time).toLocaleString()}</span>
                      </div>
                      {rec.end_time && (
                        <div className="flex justify-between">
                          <span>Ended:</span>
                          <span className="font-semibold text-white">{new Date(rec.end_time).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {alertsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl animate-pulse bg-slate-900" />
                ))}
              </div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <ShieldAlert size={40} className="mx-auto mb-3 opacity-30 animate-pulse text-brand-400" />
                <p className="text-sm font-semibold">No security alerts found</p>
                <p className="text-xs max-w-sm mx-auto mt-1 opacity-60">
                  Alerts with captured images will appear here when line crossings or zone intrusions are triggered.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <p className="text-xs font-semibold text-slate-400">
                    Showing {alerts.length} security alerts
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => clearAlertsMutation.mutate()}
                    className="btn-danger flex items-center gap-1.5 text-xs shadow-lg shadow-red-500/10"
                  >
                    <Trash2 size={13} />
                    Clear All Alerts
                  </motion.button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {alerts.map((alert: any) => (
                    <motion.div
                      key={alert.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="glass-card flex flex-col p-4 border border-brand-500/10 hover:border-brand-500/30 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                          alert.alert_type === 'intrusion'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : alert.alert_type === 'crossing'
                            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}>
                          {alert.alert_type}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {alert.camera_name}
                        </span>
                      </div>

                      {alert.screenshot_path ? (
                        <div
                          className="aspect-video bg-slate-950 rounded-lg relative flex items-center justify-center overflow-hidden border border-brand-500/5 cursor-zoom-in group"
                          onClick={() => setSelectedSnapshot(alert.screenshot_path)}
                        >
                          <img
                            src={alert.screenshot_path}
                            alt="Alert snapshot"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Eye size={20} className="text-white" />
                          </div>
                        </div>
                      ) : (
                        <div className="aspect-video bg-slate-950 rounded-lg relative flex items-center justify-center border border-brand-500/5">
                          <span className="text-xs text-slate-600">No Image Captured</span>
                        </div>
                      )}

                      <div className="mt-3 flex-1 flex flex-col justify-between">
                        <p className="text-xs font-semibold text-white/95 leading-normal mb-4 min-h-[32px]">
                          {alert.message}
                        </p>
                        
                        <div className="pt-3 border-t border-brand-500/5 flex items-center justify-between text-xs text-slate-400">
                          <div className="flex items-center gap-1 text-[10px] text-slate-500">
                            <Clock size={11} />
                            <span>{new Date(alert.timestamp).toLocaleString()}</span>
                          </div>
                          
                          <div className="flex gap-1.5">
                            {alert.screenshot_path && (
                              <button
                                onClick={() => handleDownloadSnapshot(alert.screenshot_path, alert.camera_name, alert.timestamp)}
                                className="p-1.5 rounded-lg bg-slate-900 border border-brand-500/5 hover:border-brand-500/20 text-slate-400 hover:text-white transition-colors"
                                title="Download Image"
                              >
                                <Download size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => deleteAlertMutation.mutate(alert.id)}
                              className="p-1.5 rounded-lg bg-slate-900 border border-brand-500/5 hover:border-red-500/30 hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
                              title="Delete Alert"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Video Player Modal */}
      <AnimatePresence>
        {selectedVideo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedVideo(null)}
            className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[999]"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="relative w-full max-w-3xl rounded-2xl overflow-hidden border border-brand-500/20 shadow-2xl bg-slate-950"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-brand-500/10 bg-slate-900">
                <span className="text-sm font-semibold text-white">
                  {selectedVideo.camera_name} - {selectedVideo.recording_type.toUpperCase()} Segment
                </span>
                <button
                  onClick={() => setSelectedVideo(null)}
                  className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Video Player */}
              <div className="p-4 bg-black">
                <video
                  controls
                  autoPlay
                  className="w-full max-h-[60vh] rounded-lg border border-brand-500/10 shadow-2xl"
                  src={selectedVideo.file_path}
                >
                  Your browser does not support HTML5 video player.
                </video>
              </div>

              {/* Info footer */}
              <div className="px-4 py-3 bg-slate-900 text-xs text-slate-400 flex justify-between">
                <span>Start: {new Date(selectedVideo.start_time).toLocaleString()}</span>
                {selectedVideo.end_time && <span>End: {new Date(selectedVideo.end_time).toLocaleString()}</span>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Snapshot Preview Modal */}
      <AnimatePresence>
        {selectedSnapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedSnapshot(null)}
            className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[999] backdrop-blur-sm"
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
