import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Plus, Video, Trash2, LayoutGrid, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { CameraGrid } from '../components/camera/CameraGrid';
import { AlertSidebar } from '../components/dashboard/AlertSidebar';
import { Header } from '../components/layout/Header';

interface Camera {
  id: string;
  name: string;
  type: string;
  source: string;
  is_active: number;
  zones: string;
  lines: string;
}

export default function LiveCamera() {
  const queryClient = useQueryClient();
  const [gridSize, setGridSize] = useState<number>(4); // default 2x2 grid
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Form states
  const [camId, setCamId] = useState('');
  const [camName, setCamName] = useState('');
  const [camType, setCamType] = useState('webcam');
  const [camSource, setCamSource] = useState('0');

  // Fetch cameras list
  const { data: cameras = [], refetch: refetchCameras } = useQuery<Camera[]>({
    queryKey: ['cameras'],
    queryFn: async () => {
      const { data } = await axios.get('/api/cameras');
      return data;
    },
  });

  // Fetch alerts
  const { data: alerts = [], refetch: refetchAlerts } = useQuery<any[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await axios.get('/api/alerts');
      return data;
    },
    refetchInterval: 3000, // pull alerts timeline every 3 seconds
  });

  // Add camera mutation
  const addCameraMutation = useMutation({
    mutationFn: async (newCam: any) => {
      await axios.post('/api/cameras', newCam);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
      setIsModalOpen(false);
      // Reset form
      setCamId('');
      setCamName('');
      setCamType('webcam');
      setCamSource('0');
    },
  });

  // Delete camera mutation
  const deleteCameraMutation = useMutation({
    mutationFn: async (id: string) => {
      await axios.delete(`/api/cameras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });

  // Clear alerts mutation
  const clearAlertsMutation = useMutation({
    mutationFn: async () => {
      await axios.delete('/api/alerts');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const handleAddCamera = (e: React.FormEvent) => {
    e.preventDefault();
    if (!camId || !camName || !camSource) return;
    addCameraMutation.mutate({
      id: camId,
      name: camName,
      type: camType,
      source: camSource,
      is_active: true,
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
      <Header title="Control Room" subtitle="Multi-Camera Real-time AI Analytics" />
      
      {/* Action bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-slate-900/60" style={{ borderColor: 'rgba(99,102,241,0.1)' }}>
        <div className="flex items-center gap-3">
          {/* Grid Selection */}
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1 border border-brand-500/10">
            {[1, 4, 9, 16, 25, 36, 64].map((size) => (
              <button
                key={size}
                onClick={() => setGridSize(size)}
                className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                  gridSize === size ? 'bg-brand-500 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Feeds Layout</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Add camera button */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-brand-500 hover:bg-brand-600 transition-colors shadow-md shadow-brand-500/20"
          >
            <Plus size={14} />
            Add Camera
          </button>
        </div>
      </div>

      {/* Main Grid + Sidebar Container */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Side: Camera Grid */}
        <div className="flex-1 min-w-0 p-4 h-full">
          <CameraGrid cameras={cameras} gridSize={gridSize} onConfigChange={refetchCameras} />
        </div>

        {/* Right Side: Alerts Sidebar */}
        <div className="w-80 border-l border-brand-500/10 h-full p-4 hidden lg:block">
          <AlertSidebar alerts={alerts} onClear={() => clearAlertsMutation.mutate()} />
        </div>
      </div>

      {/* Add Camera Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[999] backdrop-blur-sm">
          <div className="glass-card w-full max-w-md border border-brand-500/20 shadow-2xl p-6 relative">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Video size={18} className="text-brand-400" />
              Configure New CCTV Stream
            </h3>

            <form onSubmit={handleAddCamera} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Camera ID (Unique slug)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. entrance_cam"
                  value={camId}
                  onChange={(e) => setCamId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  className="w-full bg-slate-900 border border-brand-500/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Front Gate Entrance"
                  value={camName}
                  onChange={(e) => setCamName(e.target.value)}
                  className="w-full bg-slate-900 border border-brand-500/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Stream Type
                </label>
                <select
                  value={camType}
                  onChange={(e) => {
                    setCamType(e.target.value);
                    setCamSource(e.target.value === 'webcam' ? '0' : e.target.value === 'screenshare' ? 'screen' : '');
                  }}
                  className="w-full bg-slate-900 border border-brand-500/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                >
                  <option value="webcam">Local Webcam</option>
                  <option value="usb">USB Camera Hardware</option>
                  <option value="rtsp">IP/RTSP Network Source</option>
                  <option value="screenshare">Screen Share Source</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  Source Address
                </label>
                <input
                  type="text"
                  required
                  placeholder={camType === 'webcam' ? '0 (system default webcam)' : 'rtsp://user:pass@ip:port/stream'}
                  value={camSource}
                  onChange={(e) => setCamSource(e.target.value)}
                  className="w-full bg-slate-900 border border-brand-500/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                />
              </div>

              {/* Existing Cameras List inside Modal to allow removal */}
              {cameras.length > 0 && (
                <div className="border-t border-brand-500/10 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Active Profiles</p>
                  <div className="max-h-24 overflow-y-auto space-y-1.5 pr-1">
                    {cameras.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-900/60 border border-brand-500/5">
                        <span className="truncate">{c.name} ({c.id})</span>
                        <button
                          type="button"
                          onClick={() => deleteCameraMutation.mutate(c.id)}
                          className="text-red-400 hover:text-red-500"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer buttons */}
              <div className="flex items-center justify-end gap-2 border-t border-brand-500/10 pt-4 mt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={addCameraMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-xs font-bold shadow-lg shadow-brand-500/20 disabled:opacity-40"
                >
                  Save Camera
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
