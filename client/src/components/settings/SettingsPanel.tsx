import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Save, Key, Server, Cpu, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { formatUptime } from '../../utils/formatters';

interface Settings {
  jpegQuality: number;
  showBoundingBoxes: boolean;
  showSegmentation: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  jpegQuality: 85,
  showBoundingBoxes: true,
  showSegmentation: true,
};

const SETTINGS_KEY = 'camai-settings';

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [saved, setSaved] = useState(false);
  const [swapping, setSwapping] = useState<string | null>(null);

  // Fetch status
  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const { data } = await axios.get('/api/status');
      return data;
    },
    refetchInterval: 5000, // Refresh status telemetry every 5s to check latency recommendations
  });

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSwapModel = async (modelFile: string) => {
    try {
      setSwapping(modelFile);
      await axios.post('/api/model/select', { model_name: modelFile });
      await refetch();
    } catch (err) {
      console.error("Failed to swap model:", err);
      alert("Failed to swap active model. Please ensure the backend server is running.");
    } finally {
      setSwapping(null);
    }
  };

  const handleChange = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  const activeCamerasCount = status?.cameras ? Object.keys(status.cameras).length : 0;

  return (
    <div className="space-y-6 max-w-2xl text-white">
      {/* Performance Recommendation Alert */}
      {status?.recommendation?.should_switch && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-300 text-xs flex flex-col md:flex-row items-start md:items-center gap-3 shadow-lg shadow-amber-500/5"
        >
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5 md:mt-0" />
          <div className="flex-1 col-span-1">
            <span className="font-semibold text-white block mb-0.5">Hardware Performance Recommendation</span>
            {status.recommendation.message}
          </div>
          <button
            onClick={() => handleSwapModel(status.recommendation.suggested_model)}
            disabled={swapping !== null}
            className="btn-primary py-1.5 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-500 hover:bg-amber-600 border-none text-slate-950 shrink-0 self-end md:self-auto flex items-center gap-1.5 transition-all"
          >
            {swapping === status.recommendation.suggested_model && (
              <Loader2 size={11} className="animate-spin" />
            )}
            Switch to {status.recommendation.suggested_model.replace('-seg.pt', '').toUpperCase()}
          </button>
        </motion.div>
      )}

      {/* Server Status */}
      <div className="glass-card p-5 border border-brand-500/10">
        <div className="flex items-center gap-2 mb-4">
          <Server size={16} className="text-brand-400" />
          <h3 className="font-semibold text-sm text-white">Server Status</h3>
          <button onClick={() => refetch()} className="ml-auto btn-ghost p-1.5 rounded-lg">
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
        {status ? (
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              ['Server Status', 'Online', 'text-emerald-400'],
              ['YOLO11 Model', status.selectedModel || (status.modelLoaded ? 'Loaded (CPU)' : 'Loading...'), status.modelLoaded ? 'text-emerald-400' : 'text-amber-400'],
              ['Uptime', formatUptime(status.uptime), 'text-brand-400'],
              ['Active Camera Threads', `${activeCamerasCount} Running`, 'text-cyan-400'],
            ].map(([label, value, color]) => (
              <div key={label} className="flex justify-between items-center p-2.5 rounded-lg bg-slate-900 border border-brand-500/5">
                <span className="text-slate-400">{label}</span>
                <span className={`font-semibold font-mono ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-red-400">
            Cannot reach FastAPI server at http://localhost:8000
          </p>
        )}
      </div>

      {/* YOLO11 Model Benchmarks */}
      {status && (
        <div className="glass-card p-5 border border-brand-500/10">
          <div className="flex items-center gap-2 mb-4">
            <Cpu size={16} className="text-brand-400" />
            <h3 className="font-semibold text-sm text-white">YOLO11 Hardware Benchmarks</h3>
            {status.benchmark?.status === 'running' && (
              <span className="flex items-center gap-1.5 ml-auto text-xs font-semibold text-amber-400 animate-pulse">
                <Loader2 size={12} className="animate-spin" />
                Profiling Hardware...
              </span>
            )}
            {status.benchmark?.status === 'complete' && (
              <span className="ml-auto text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Profiled on {status.benchmark.device.toUpperCase()}
              </span>
            )}
          </div>
          
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              The platform automatically benchmarks inference speeds on startup and provides recommendations for optimal performance.
            </p>

            <div className="overflow-hidden rounded-xl border border-brand-500/10 bg-slate-950/40">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/60 text-slate-400 uppercase text-[9px] tracking-wider border-b border-brand-500/5">
                  <tr>
                    <th className="p-3">Model</th>
                    <th className="p-3">Avg Latency</th>
                    <th className="p-3">Load Time</th>
                    <th className="p-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-500/5">
                  {['yolo11n-seg', 'yolo11s-seg', 'yolo11m-seg'].map((modelKey) => {
                    const mData = status.benchmark?.[modelKey];
                    const isSelected = status.selectedModel === `${modelKey}.pt`;
                    
                    return (
                      <tr key={modelKey} className={`hover:bg-slate-900/30 transition-colors ${isSelected ? 'bg-brand-500/5' : ''}`}>
                        <td className="p-3 font-semibold text-white flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50 animate-pulse' : 'bg-slate-600'}`} />
                          {modelKey}
                        </td>
                        <td className="p-3">
                          {mData ? (
                            <span className={`font-mono font-bold ${
                              mData.avg_latency_ms < 100 ? 'text-emerald-400' :
                              mData.avg_latency_ms < 250 ? 'text-amber-400' : 'text-red-400'
                            }`}>
                              {mData.avg_latency_ms.toFixed(1)} ms
                            </span>
                          ) : (
                            <span className="text-slate-500 italic animate-pulse">Testing...</span>
                          )}
                        </td>
                        <td className="p-3 font-mono text-slate-400">
                          {mData ? `${mData.load_time_s.toFixed(2)}s` : '—'}
                        </td>
                        <td className="p-3 text-right">
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                              Active
                            </span>
                          ) : mData ? (
                            <button
                              onClick={() => handleSwapModel(`${modelKey}.pt`)}
                              disabled={swapping !== null}
                              className="text-[10px] text-brand-300 hover:text-white bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 px-2.5 py-1 rounded-md uppercase tracking-wider transition-all disabled:opacity-50 flex items-center gap-1 ml-auto"
                            >
                              {swapping === `${modelKey}.pt` && <Loader2 size={10} className="animate-spin" />}
                              Activate
                            </button>
                          ) : (
                            <span className="text-[10px] text-amber-500 bg-amber-500/5 border border-amber-500/10 px-2 py-0.5 rounded-md uppercase tracking-wider animate-pulse">
                              Pending
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Local Model Details */}
      <div className="glass-card p-5 border border-brand-500/10">
        <div className="flex items-center gap-2 mb-4">
          <Key size={16} className="text-brand-400" />
          <h3 className="font-semibold text-sm text-white">Surveillance Engine</h3>
        </div>
        <div className="space-y-3 text-xs text-slate-400">
          <p>
            The CCTV Analytics Platform runs PyTorch <strong className="text-white">{status?.selectedModel || 'YOLO11'}</strong> with ByteTrack dynamically on your local device.
          </p>
          <div className="p-3 rounded-xl font-mono text-xs bg-black/60 border border-brand-500/10 text-brand-300">
            uvicorn app.main:app --port 8000 --reload
          </div>
          <p>Active Models & Tracks:</p>
          <ul className="space-y-1 ml-2 text-brand-300">
            <li>• <strong className="text-white">{status?.selectedModel || 'YOLO11'}</strong> — Class 0: Person Segmenter & Classes 1-7: Vehicles</li>
            <li>• <strong className="text-white">ByteTrack</strong> — Object motion association and track ID preservation</li>
          </ul>
        </div>
      </div>

      {/* Visual Stream Settings */}
      <div className="glass-card p-5 border border-brand-500/10">
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={16} className="text-brand-400" />
          <h3 className="font-semibold text-sm text-white">Visual Stream Settings</h3>
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <label className="block mb-1.5 text-xs font-medium text-slate-400">
              MJPEG Streaming Quality: <span className="text-brand-400">{settings.jpegQuality}%</span>
            </label>
            <input
              type="range" min={50} max={100} step={5}
              value={settings.jpegQuality}
              onChange={(e) => handleChange('jpegQuality', Number(e.target.value))}
              className="w-full accent-brand-500 cursor-pointer"
            />
          </div>

          <div className="space-y-2">
            {(Object.entries({
              showBoundingBoxes: 'Overlay Bounding Boxes',
              showSegmentation: 'Overlay Segmentation Outlines',
            }) as [keyof Settings, string][]).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs text-slate-400">{label}</span>
                <div
                  onClick={() => handleChange(key, !settings[key] as any)}
                  className={`relative w-10 h-5 rounded-full transition-all duration-200 cursor-pointer ${
                    settings[key] ? 'bg-brand-500' : 'bg-slate-700'
                  }`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                    settings[key] ? 'translate-x-5' : 'translate-x-0.5'
                  }`} />
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Save button */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleSave}
        className="btn-primary flex items-center gap-2 shadow-lg shadow-brand-500/20"
      >
        <Save size={15} />
        {saved ? 'Saved!' : 'Save Settings'}
      </motion.button>
    </div>
  );
}
