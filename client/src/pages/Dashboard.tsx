import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Users, ShieldAlert, Activity, Clock, Zap, Database, TrendingUp, Car } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { StatCard } from '../components/dashboard/StatCard';
import { Header } from '../components/layout/Header';
import { HeatmapViewer } from '../components/dashboard/HeatmapViewer';
import { useTelemetry } from '../contexts/TelemetryContext';
import { formatUptime, formatMs } from '../utils/formatters';

export default function Dashboard() {
  const { telemetry } = useTelemetry();
  const queryClient = useQueryClient();
  const [heatmapCameraId, setHeatmapCameraId] = useState<string>('cam_default');

  // Fetch status
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const { data } = await axios.get('/api/status');
      return data;
    },
    refetchInterval: 5000,
  });

  // Fetch cameras
  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: async () => {
      const { data } = await axios.get('/api/cameras');
      return data;
    },
  });

  // Fetch recent alerts
  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await axios.get('/api/alerts');
      return data;
    },
    refetchInterval: 3000,
  });

  // Total active camera threads
  const activeCamerasCount = Object.keys(telemetry).length;

  // Aggregate stats across all cameras in telemetry
  const totalPeopleFound = Object.values(telemetry).reduce((acc, cam) => acc + (cam.people || 0), 0);
  const totalVehiclesFound = Object.values(telemetry).reduce((acc, cam) => acc + (cam.vehicles || 0), 0);
  const maxLatency = Object.values(telemetry).reduce((acc, cam) => Math.max(acc, cam.latency || 0), 0);
  
  // Calculate avg FPS
  const telemetryList = Object.values(telemetry);
  const avgFps = telemetryList.length > 0 
    ? (telemetryList.reduce((acc, cam) => acc + (cam.fps || 0), 0) / telemetryList.length).toFixed(1)
    : '0.0';

  // Get heatmap data for selected camera
  const activeHeatmap = telemetry[heatmapCameraId]?.heatmap || [];

  return (
    <div className="flex flex-col h-full bg-slate-950 text-white overflow-hidden">
      <Header title="Dashboard" subtitle="Surveillance Operations & AI Performance Metrics" />
      
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Real-time Telemetry HUD Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            index={0}
            title="System Status"
            value={status?.server === 'online' ? 'Online' : 'Offline'}
            subtitle={status ? `Uptime: ${formatUptime(status.uptime)}` : 'Connecting...'}
            icon={Zap}
            iconColor="text-emerald-400"
            loading={statusLoading}
          />
          <StatCard
            index={1}
            title="Active Feeds"
            value={`${activeCamerasCount} / ${cameras.length}`}
            subtitle="Cameras online"
            icon={Camera}
            iconColor="text-brand-400"
          />
          <StatCard
            index={2}
            title="Avg Processing FPS"
            value={`${avgFps} Hz`}
            subtitle="Real-time performance"
            icon={Activity}
            iconColor="text-cyan-400"
          />
          <StatCard
            index={3}
            title="Max Model Latency"
            value={maxLatency > 0 ? `${maxLatency} ms` : '—'}
            subtitle="YOLO11 CPU Inference"
            icon={Clock}
            iconColor="text-purple-400"
          />
        </div>

        {/* Second Row of stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            index={4}
            title="Humans Tracked"
            value={totalPeopleFound}
            subtitle="Current live count"
            icon={Users}
            iconColor="text-pink-400"
          />
          <StatCard
            index={5}
            title="Total Events Logged"
            value={alerts.length}
            subtitle="Security timelines"
            icon={ShieldAlert}
            iconColor="text-red-400"
          />
          <StatCard
            index={6}
            title="YOLO11 Model"
            value="YOLO11n-seg"
            subtitle="Local PyTorch Backend"
            icon={Database}
            iconColor="text-amber-400"
          />
          <StatCard
            index={7}
            title="Vehicles Tracked"
            value={totalVehiclesFound}
            subtitle="Current live count"
            icon={Car}
            iconColor="text-teal-400"
          />
        </div>

        {/* Heatmap & Alerts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Heatmap panel */}
          <div className="lg:col-span-2 glass-card p-5 border border-brand-500/10 flex flex-col h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Spatial Activity Heatmap</h3>
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Feed:</span>
                <select
                  value={heatmapCameraId}
                  onChange={(e) => setHeatmapCameraId(e.target.value)}
                  className="bg-slate-900 border border-brand-500/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
                >
                  {cameras.map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex-1 min-h-0">
              <HeatmapViewer heatmapData={activeHeatmap} />
            </div>
          </div>

          {/* Recent Events sidebar box */}
          <div className="glass-card p-5 border border-brand-500/10 flex flex-col h-[400px]">
            <h3 className="text-sm font-semibold text-white mb-3">Timeline Events</h3>
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {alerts.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs">
                  No alerts recorded today.
                </div>
              ) : (
                alerts.slice(0, 15).map((a: any) => (
                  <div key={a.id} className="p-2.5 rounded-lg bg-slate-900/50 border border-brand-500/5 flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-brand-300 uppercase">{a.camera_name}</span>
                      <span className="text-slate-500 font-mono">{new Date(a.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-white/90 leading-tight">{a.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
