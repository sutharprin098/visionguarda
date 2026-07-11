import React, { useState } from 'react';
import { Camera, Users, ShieldAlert, Activity, Clock, Zap, Car, Circle, Cpu, MonitorPlay, Layers, Gauge } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { StatCard } from '../components/dashboard/StatCard';
import { Topbar } from '../components/layout/Topbar';
import { HeatmapViewer } from '../components/dashboard/HeatmapViewer';
import { useTelemetry } from '../contexts/TelemetryContext';
import { formatUptime } from '../utils/formatters';
import { fetchStatus, fetchCameras, fetchAlerts } from '../utils/api';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';

function avgOf(values: number[]): number {
  const filtered = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (filtered.length === 0) return 0;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

export default function Dashboard() {
  const { telemetry, renderFps } = useTelemetry();
  const [heatmapCameraId, setHeatmapCameraId] = useState<string>('cam_default');

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 5000,
  });

  const { data: cameras = [] } = useQuery({
    queryKey: ['cameras'],
    queryFn: fetchCameras,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => fetchAlerts(15),
    refetchInterval: 3000,
  });

  const activeCamerasCount = Object.keys(telemetry).length;
  const telemetryList = Object.values(telemetry);

  const totalPeopleFound = telemetryList.reduce((acc, cam) => acc + (cam.people || 0), 0);
  const totalVehiclesFound = telemetryList.reduce((acc, cam) => acc + (cam.vehicles || 0), 0);
  const maxLatency = telemetryList.reduce((acc, cam) => Math.max(acc, cam.latency || 0), 0);
  const recordingCount = telemetryList.filter((cam) => cam.recording).length;

  const avgFps = telemetryList.length > 0
    ? (telemetryList.reduce((acc, cam) => acc + (cam.fps || 0), 0) / telemetryList.length).toFixed(1)
    : '0.0';

  const activeHeatmap = telemetry[heatmapCameraId]?.heatmap || [];

  // Pipeline performance aggregates — GPU/CPU/RAM are process-wide (one AI
  // process serving every camera), so peak across cameras is the true system
  // reading rather than an average of what's really the same number sampled
  // at slightly different instants.
  const avgDetectionFps = avgOf(telemetryList.map((c) => c.inference_fps || 0));
  const avgTrackingFps = avgOf(telemetryList.map((c) => c.tracking_fps || 0));
  const peakGpu = telemetryList.reduce((acc, cam) => Math.max(acc, cam.gpu || 0), 0);
  const peakCpu = telemetryList.reduce((acc, cam) => Math.max(acc, cam.cpu || 0), 0);
  const peakMem = telemetryList.reduce((acc, cam) => Math.max(acc, cam.memory || 0), 0);
  const maxQueueDepth = telemetryList.reduce((acc, cam) => Math.max(acc, cam.queue_depth || 0), 0);
  const totalVehiclesEver = telemetryList.reduce(
    (acc, cam) => acc + (cam.counters?.vehicles_in || 0) + (cam.counters?.vehicles_out || 0), 0
  );
  const avgCaptureLatency = avgOf(telemetryList.map((c) => c.capture_latency || 0));
  const avgDecodeLatency = avgOf(telemetryList.map((c) => c.decode_latency || 0));
  const avgDetectionLatency = avgOf(telemetryList.map((c) => c.inference_latency || 0));
  const avgTrackingLatency = avgOf(telemetryList.map((c) => c.tracking_latency || 0));
  const avgRenderLatency = avgOf(telemetryList.map((c) => c.rendering_latency || 0));

  // AI backend/device/resolution — one shared AI process serves every
  // camera, so any camera's reading represents the whole system.
  const aiBackend = telemetryList[0]?.backend;
  const aiDevice = telemetryList[0]?.device;
  const aiImgsz = telemetryList[0]?.imgsz;

  const slowestCamera = telemetryList.reduce(
    (slowest, cam) => (cam.latency || 0) > (slowest?.latency || 0) ? cam : slowest,
    telemetryList[0]
  );
  const worstBottleneck = slowestCamera?.bottleneck || '—';
  const totalStageErrors = telemetryList.reduce(
    (acc, cam) => acc + Object.values(cam.stage_errors || {}).reduce((a, b) => a + b, 0), 0
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Dashboard" subtitle="Surveillance operations & AI performance overview" />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            index={0}
            title="System Status"
            value={status?.server === 'online' ? 'Online' : 'Offline'}
            subtitle={status ? `Uptime ${formatUptime(status.uptime)}` : 'Connecting...'}
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
            subtitle="Real-time detection rate"
            icon={Activity}
            iconColor="text-cyan-400"
          />
          <StatCard
            index={3}
            title="Peak Detection Latency"
            value={maxLatency > 0 ? `${maxLatency} ms` : '—'}
            subtitle="Across active feeds"
            icon={Clock}
            iconColor="text-purple-400"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            index={4}
            title="People Tracked"
            value={totalPeopleFound}
            subtitle="Current live count"
            icon={Users}
            iconColor="text-pink-400"
          />
          <StatCard
            index={5}
            title="Vehicles Tracked"
            value={totalVehiclesFound}
            subtitle="Current live count"
            icon={Car}
            iconColor="text-teal-400"
          />
          <StatCard
            index={6}
            title="Recent Alerts"
            value={alerts.length}
            subtitle="Security timeline events"
            icon={ShieldAlert}
            iconColor="text-red-400"
          />
          <StatCard
            index={7}
            title="Recording Now"
            value={recordingCount}
            subtitle="Cameras actively recording"
            icon={Circle}
            iconColor="text-amber-400"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            index={8}
            title="Detection / Tracking FPS"
            value={`${avgDetectionFps.toFixed(1)} / ${avgTrackingFps.toFixed(1)}`}
            subtitle={`Render ${renderFps.toFixed(1)} FPS`}
            icon={Gauge}
            iconColor="text-lime-400"
          />
          <StatCard
            index={9}
            title="GPU / CPU / RAM"
            value={`${peakGpu.toFixed(0)}% / ${peakCpu.toFixed(0)}% / ${peakMem.toFixed(0)}%`}
            subtitle="Peak across active feeds"
            icon={Cpu}
            iconColor="text-orange-400"
          />
          <StatCard
            index={10}
            title="Capture Queue Depth"
            value={maxQueueDepth}
            subtitle="Frames buffered (target: 0-1)"
            icon={Layers}
            iconColor="text-sky-400"
          />
          <StatCard
            index={11}
            title="Total Vehicles (Session)"
            value={totalVehiclesEver}
            subtitle="Cumulative line crossings"
            icon={MonitorPlay}
            iconColor="text-teal-300"
          />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            index={12}
            title="AI Backend"
            value={aiBackend ? `${aiBackend} / ${aiDevice}` : '—'}
            subtitle={aiImgsz ? `Inference @ ${aiImgsz}px` : 'No active inference'}
            icon={Cpu}
            iconColor="text-violet-400"
          />
          <StatCard
            index={13}
            title="Pipeline Bottleneck"
            value={worstBottleneck}
            subtitle="Slowest stage, worst feed"
            icon={Gauge}
            iconColor="text-yellow-400"
          />
          <StatCard
            index={14}
            title="Stage Errors"
            value={totalStageErrors}
            subtitle="Recovered errors, all stages/feeds"
            icon={ShieldAlert}
            iconColor={totalStageErrors > 0 ? 'text-red-400' : 'text-emerald-400'}
          />
        </div>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Pipeline Latency Breakdown</CardTitle>
          </CardHeader>
          <div className="p-4 grid grid-cols-2 lg:grid-cols-6 gap-4 text-center">
            {[
              { label: 'Capture', value: avgCaptureLatency },
              { label: 'Decode', value: avgDecodeLatency },
              { label: 'Detection', value: avgDetectionLatency },
              { label: 'Tracking', value: avgTrackingLatency },
              { label: 'Render', value: avgRenderLatency },
              { label: 'Total', value: maxLatency },
            ].map((row) => (
              <div key={row.label} className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <div className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">{row.label}</div>
                <div className="text-lg font-mono font-bold text-white">{row.value.toFixed(1)} ms</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 flex flex-col h-[400px]">
            <CardHeader>
              <CardTitle>Spatial Activity Heatmap</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-ink-500 font-bold uppercase tracking-wider">Feed</span>
                <select
                  value={heatmapCameraId}
                  onChange={(e) => setHeatmapCameraId(e.target.value)}
                  className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                >
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </CardHeader>
            <div className="flex-1 min-h-0 p-4">
              <HeatmapViewer heatmapData={activeHeatmap} />
            </div>
          </Card>

          <Card className="flex flex-col h-[400px]">
            <CardHeader>
              <CardTitle>Timeline Events</CardTitle>
            </CardHeader>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
              {alerts.length === 0 ? (
                <EmptyState icon={<ShieldAlert size={20} />} title="No alerts recorded today" />
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05] flex flex-col gap-1 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-brand-300 uppercase">{a.camera_name}</span>
                      <span className="text-ink-500 font-mono">{new Date(a.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-ink-200 leading-tight">{a.message}</p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
