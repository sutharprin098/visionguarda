import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Car, Activity, Gauge, BarChart3 } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { HeatmapViewer } from '../components/dashboard/HeatmapViewer';
import { EmptyState } from '../components/ui/EmptyState';
import { useTelemetry } from '../contexts/TelemetryContext';
import { fetchCameras } from '../utils/api';

export default function AIAnalytics() {
  const { telemetry } = useTelemetry();
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: fetchCameras });
  const [heatmapCameraId, setHeatmapCameraId] = useState<string>('');

  const activeCameraIds = Object.keys(telemetry);
  const selectedHeatmapId = heatmapCameraId || activeCameraIds[0] || '';
  const activeHeatmap = telemetry[selectedHeatmapId]?.heatmap || [];

  const maxPeople = Math.max(1, ...activeCameraIds.map((id) => telemetry[id]?.people || 0));
  const maxVehicles = Math.max(1, ...activeCameraIds.map((id) => telemetry[id]?.vehicles || 0));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="AI Analytics" subtitle="Live detection, tracking, and spatial activity insights" />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {activeCameraIds.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No live analytics yet"
            description="Activate a camera in Live Monitoring to start collecting detection, tracking, and heatmap data."
          />
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 h-[420px] flex flex-col">
                <CardHeader>
                  <CardTitle>Spatial Activity Heatmap</CardTitle>
                  <select
                    value={selectedHeatmapId}
                    onChange={(e) => setHeatmapCameraId(e.target.value)}
                    className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-white focus:outline-none"
                  >
                    {activeCameraIds.map((id) => (
                      <option key={id} value={id}>{cameras.find((c) => c.id === id)?.name || id}</option>
                    ))}
                  </select>
                </CardHeader>
                <div className="flex-1 min-h-0 p-4">
                  <HeatmapViewer heatmapData={activeHeatmap} />
                </div>
              </Card>

              <Card className="h-[420px] flex flex-col">
                <CardHeader>
                  <CardTitle>Per-Camera Load</CardTitle>
                </CardHeader>
                <CardBody className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
                  {activeCameraIds.map((id) => {
                    const t = telemetry[id];
                    const camName = cameras.find((c) => c.id === id)?.name || id;
                    return (
                      <div key={id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-white truncate">{camName}</span>
                          <span className="text-ink-500 font-mono">{t.fps} Hz</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Users size={11} className="text-pink-400 shrink-0" />
                          <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div className="h-full bg-pink-400" style={{ width: `${((t.people || 0) / maxPeople) * 100}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-ink-400 w-5 text-right">{t.people || 0}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Car size={11} className="text-teal-400 shrink-0" />
                          <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                            <div className="h-full bg-teal-400" style={{ width: `${((t.vehicles || 0) / maxVehicles) * 100}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-ink-400 w-5 text-right">{t.vehicles || 0}</span>
                        </div>
                        {t.crowd_stats && t.crowd_stats.density_level !== 'low' && (
                          <div className="flex items-center gap-1.5">
                            <Gauge size={11} className={{
                              moderate: 'text-amber-400',
                              high: 'text-orange-400',
                              critical: 'text-red-400',
                            }[t.crowd_stats.density_level] || 'text-ink-400'} />
                            <span className={`text-[10px] font-semibold capitalize ${{
                              moderate: 'text-amber-400',
                              high: 'text-orange-400',
                              critical: 'text-red-400',
                            }[t.crowd_stats.density_level] || 'text-ink-400'}`}>
                              {t.crowd_stats.density_level} density
                            </span>
                            <span className="text-[10px] font-mono text-ink-500">
                              ({t.crowd_stats.peak_cell_count} clustered)
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Tracked Objects — Live Detail</CardTitle>
              </CardHeader>
              <CardBody className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-[12px] min-w-[640px]">
                  <thead className="text-ink-400 uppercase text-[10px] tracking-wider border-b border-white/[0.06]">
                    <tr>
                      <th className="py-2 pr-4 font-semibold">Camera</th>
                      <th className="py-2 pr-4 font-semibold">Class</th>
                      <th className="py-2 pr-4 font-semibold">Track ID</th>
                      <th className="py-2 pr-4 font-semibold">Confidence</th>
                      <th className="py-2 pr-4 font-semibold">Speed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {activeCameraIds.flatMap((id) =>
                      (telemetry[id]?.detections || []).map((det, idx) => (
                        <tr key={`${id}-${idx}`}>
                          <td className="py-2 pr-4 text-ink-300">{cameras.find((c) => c.id === id)?.name || id}</td>
                          <td className="py-2 pr-4 text-white font-medium capitalize">{det.class}</td>
                          <td className="py-2 pr-4 font-mono text-ink-400">{det.track_id ?? '—'}</td>
                          <td className="py-2 pr-4 font-mono text-ink-400">{Math.round(det.confidence * 100)}%</td>
                          <td className="py-2 pr-4 font-mono text-amber-400">
                            {det.speed !== undefined && det.speed > 0
                              ? `${det.speed_calibrated ? '' : '~'}${det.speed.toFixed(1)} km/h${det.speed_calibrated ? ' ✓' : ''}`
                              : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                {activeCameraIds.every((id) => (telemetry[id]?.detections || []).length === 0) && (
                  <p className="text-center py-8 text-[12px] text-ink-500">No objects currently tracked.</p>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
