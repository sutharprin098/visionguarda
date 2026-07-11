import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileBarChart, Download, Users, ShieldAlert, TrendingUp } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { StatCard } from '../components/dashboard/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchAlerts, fetchHistoryRecords, fetchCameras } from '../utils/api';

export default function Reports() {
  const { data: alerts = [] } = useQuery({ queryKey: ['alerts', 'reports'], queryFn: () => fetchAlerts(1000) });
  const { data: history = [] } = useQuery({ queryKey: ['history', 'reports'], queryFn: () => fetchHistoryRecords(1000) });
  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: fetchCameras });

  const perCamera = useMemo(() => {
    return cameras.map((cam) => {
      const camHistory = history.filter((h) => h.camera_id === cam.id);
      const camAlerts = alerts.filter((a) => a.camera_id === cam.id);
      const detections = camHistory.filter((h) => h.status === 'human_found');
      const avgConfidence = detections.length
        ? detections.reduce((acc, h) => acc + (h.max_confidence || 0), 0) / detections.length
        : null;
      const lastActive = [...camHistory, ...camAlerts].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )[0]?.timestamp;
      return {
        name: cam.name,
        detections: detections.length,
        alerts: camAlerts.length,
        avgConfidence,
        lastActive,
      };
    });
  }, [cameras, history, alerts]);

  const alertTypeBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    alerts.forEach((a) => { counts[a.alert_type] = (counts[a.alert_type] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [alerts]);

  const totalDetections = history.filter((h) => h.status === 'human_found').length;
  const mostActive = [...perCamera].sort((a, b) => (b.detections + b.alerts) - (a.detections + a.alerts))[0];

  const exportCsv = () => {
    const rows = [
      ['Camera', 'Detections', 'Alerts', 'Avg Confidence', 'Last Active'],
      ...perCamera.map((c) => [c.name, String(c.detections), String(c.alerts), c.avgConfidence != null ? `${(c.avgConfidence * 100).toFixed(1)}%` : '—', c.lastActive || '—']),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `camai_report_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxAlertCount = Math.max(1, ...alertTypeBreakdown.map(([, v]) => v));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar
        title="Reports"
        subtitle="Aggregated detection and alert summaries across all cameras"
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={perCamera.length === 0}>
            <Download size={13} />
            Export CSV
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard index={0} title="Total Detections" value={totalDetections} subtitle="All recorded history" icon={Users} iconColor="text-pink-400" />
          <StatCard index={1} title="Total Alerts" value={alerts.length} subtitle="Zone & line events" icon={ShieldAlert} iconColor="text-red-400" />
          <StatCard index={2} title="Cameras Reporting" value={cameras.length} subtitle="Configured sources" icon={FileBarChart} iconColor="text-brand-400" />
          <StatCard index={3} title="Most Active Camera" value={mostActive?.name || '—'} subtitle={mostActive ? `${mostActive.detections + mostActive.alerts} total events` : 'No data yet'} icon={TrendingUp} iconColor="text-cyan-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Per-Camera Summary</CardTitle></CardHeader>
            <CardBody className="overflow-x-auto custom-scrollbar">
              {perCamera.length === 0 ? (
                <EmptyState icon={<FileBarChart size={20} />} title="No data to report yet" />
              ) : (
                <table className="w-full text-left text-[12px] min-w-[520px]">
                  <thead className="text-ink-400 uppercase text-[10px] tracking-wider border-b border-white/[0.06]">
                    <tr>
                      <th className="py-2 pr-4 font-semibold">Camera</th>
                      <th className="py-2 pr-4 font-semibold">Detections</th>
                      <th className="py-2 pr-4 font-semibold">Alerts</th>
                      <th className="py-2 pr-4 font-semibold">Avg Confidence</th>
                      <th className="py-2 pr-4 font-semibold">Last Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {perCamera.map((c) => (
                      <tr key={c.name}>
                        <td className="py-2 pr-4 font-semibold text-white">{c.name}</td>
                        <td className="py-2 pr-4 font-mono text-ink-300">{c.detections}</td>
                        <td className="py-2 pr-4 font-mono text-ink-300">{c.alerts}</td>
                        <td className="py-2 pr-4 font-mono text-ink-300">{c.avgConfidence != null ? `${(c.avgConfidence * 100).toFixed(1)}%` : '—'}</td>
                        <td className="py-2 pr-4 text-ink-400">{c.lastActive ? new Date(c.lastActive).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Alert Type Breakdown</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              {alertTypeBreakdown.length === 0 ? (
                <p className="text-[12px] text-ink-400">No alerts recorded yet.</p>
              ) : (
                alertTypeBreakdown.map(([type, count]) => (
                  <div key={type} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="capitalize text-ink-200 font-medium">{type}</span>
                      <span className="font-mono text-ink-400">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full bg-brand-400" style={{ width: `${(count / maxAlertCount) * 100}%` }} />
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
