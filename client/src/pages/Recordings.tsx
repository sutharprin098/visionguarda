import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Clock, FileVideo, X } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchRecordings, fetchCameras, RecordingRecord } from '../utils/api';

export default function Recordings() {
  const [cameraFilter, setCameraFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'continuous' | 'event'>('all');
  const [selectedVideo, setSelectedVideo] = useState<RecordingRecord | null>(null);

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ['recordings'],
    queryFn: fetchRecordings,
    refetchInterval: 5000,
  });

  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: fetchCameras });

  const filtered = useMemo(
    () =>
      recordings
        .filter((r) => cameraFilter === 'all' || r.camera_name === cameraFilter)
        .filter((r) => typeFilter === 'all' || r.recording_type === typeFilter),
    [recordings, cameraFilter, typeFilter]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Recordings" subtitle="Browse and play back continuous and event-triggered footage" />

      <div className="flex items-center gap-2 px-6 py-2.5 border-b border-white/[0.06] shrink-0">
        <select value={cameraFilter} onChange={(e) => setCameraFilter(e.target.value)} className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none">
          <option value="all">All Cameras</option>
          {cameras.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none">
          <option value="all">All Types</option>
          <option value="continuous">Continuous</option>
          <option value="event">Event-Triggered</option>
        </select>
        <span className="ml-auto text-[11px] text-ink-500">{filtered.length} recording{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 rounded-xl animate-pulse bg-white/[0.04]" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<FileVideo size={20} />} title="No recordings found" description="Recordings appear once cameras are active and capturing footage." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((rec) => (
              <motion.div
                key={rec.id}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="panel flex flex-col p-4 cursor-pointer hover:border-white/20 transition-colors"
                onClick={() => setSelectedVideo(rec)}
              >
                <div className="flex items-center justify-between mb-3">
                  <Badge tone={rec.recording_type === 'event' ? 'danger' : 'success'}>{rec.recording_type}</Badge>
                  <span className="text-[10px] font-mono text-ink-500">{rec.camera_name}</span>
                </div>

                <div className="aspect-video bg-black/40 rounded-lg relative flex items-center justify-center border border-white/[0.06] group">
                  <Play size={26} className="text-brand-400 group-hover:scale-110 transition-transform opacity-70 group-hover:opacity-100" />
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 text-[10px] font-bold text-ink-400">
                    <Clock size={11} />
                    {rec.end_time ? 'Completed' : 'Recording live'}
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-[11px] text-ink-400">
                  <div className="flex justify-between"><span>Started</span><span className="font-semibold text-white">{new Date(rec.start_time).toLocaleString()}</span></div>
                  {rec.end_time && <div className="flex justify-between"><span>Ended</span><span className="font-semibold text-white">{new Date(rec.end_time).toLocaleString()}</span></div>}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedVideo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedVideo(null)} className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[999]">
            <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} className="relative w-full max-w-3xl rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-[var(--color-surface)]" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                <span className="text-sm font-semibold text-white">{selectedVideo.camera_name} — {selectedVideo.recording_type.toUpperCase()} Segment</span>
                <button onClick={() => setSelectedVideo(null)} className="p-1.5 rounded-full hover:bg-white/10 text-ink-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-4 bg-black">
                <video controls autoPlay className="w-full max-h-[60vh] rounded-lg border border-white/10" src={selectedVideo.file_path}>
                  Your browser does not support HTML5 video playback.
                </video>
              </div>
              <div className="px-4 py-3 text-xs text-ink-400 flex justify-between">
                <span>Start: {new Date(selectedVideo.start_time).toLocaleString()}</span>
                {selectedVideo.end_time && <span>End: {new Date(selectedVideo.end_time).toLocaleString()}</span>}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
