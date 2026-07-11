import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Trash2, Download, Eye, X, Navigation, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Topbar } from '../components/layout/Topbar';
import { Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchAlerts, deleteAlert, clearAllAlerts, fetchCameras } from '../utils/api';

export default function Alerts() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['alerts', 'page'],
    queryFn: () => fetchAlerts(200),
    refetchInterval: 4000,
  });

  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: fetchCameras });

  const deleteMutation = useMutation({
    mutationFn: deleteAlert,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const clearMutation = useMutation({
    mutationFn: clearAllAlerts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const rules = useMemo(() => {
    const rows: { camera: string; kind: 'Zone' | 'Line'; name: string }[] = [];
    cameras.forEach((cam) => {
      try {
        const zones = JSON.parse(cam.zones || '[]');
        const lines = JSON.parse(cam.lines || '[]');
        zones.forEach((z: any) => rows.push({ camera: cam.name, kind: 'Zone', name: z.name }));
        lines.forEach((l: any) => rows.push({ camera: cam.name, kind: 'Line', name: l.name }));
      } catch {
        // ignore malformed config
      }
    });
    return rows;
  }, [cameras]);

  const handleDownload = (url: string, cam: string, ts: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `alert_${cam.replace(/\s+/g, '_')}_${new Date(ts).getTime()}.jpg`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar
        title="Alerts"
        subtitle="Active security alerts and configured alert rules"
        actions={
          alerts.length > 0 ? (
            <Button size="sm" variant="danger" onClick={() => clearMutation.mutate()}>
              <Trash2 size={13} />
              Clear All
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Alert Rules — Zones & Line Crossings</CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate('/live')}>
              <Settings2 size={13} />
              Configure in Live Monitoring
            </Button>
          </CardHeader>
          <CardBody>
            {rules.length === 0 ? (
              <p className="text-[12px] text-ink-400">No zones or line crossings configured yet. Draw one from a camera's Control Center in Live Monitoring.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {rules.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05] text-[12px]">
                    {r.kind === 'Zone' ? <ShieldAlert size={13} className="text-red-400 shrink-0" /> : <Navigation size={13} className="text-blue-400 shrink-0 rotate-45" />}
                    <span className="text-white font-medium truncate">{r.name}</span>
                    <span className="text-ink-500 ml-auto shrink-0">{r.camera}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <div>
          <h3 className="text-[13px] font-bold text-white mb-3">Active Alerts</h3>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-48 rounded-xl animate-pulse bg-white/[0.04]" />)}
            </div>
          ) : alerts.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert size={20} />}
              title="No security alerts"
              description="Alerts with captured snapshots appear here when a zone intrusion or line crossing is triggered."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {alerts.map((alert) => (
                <motion.div key={alert.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="panel flex flex-col p-4">
                  <div className="flex items-center justify-between mb-3">
                    <Badge tone={alert.alert_type === 'intrusion' ? 'danger' : alert.alert_type === 'crossing' ? 'info' : 'warning'}>{alert.alert_type}</Badge>
                    <span className="text-[10px] font-bold text-ink-400 uppercase tracking-wider">{alert.camera_name}</span>
                  </div>

                  {alert.screenshot_path ? (
                    <div className="aspect-video bg-black/40 rounded-lg relative flex items-center justify-center overflow-hidden border border-white/[0.06] cursor-zoom-in group" onClick={() => setSelectedSnapshot(alert.screenshot_path!)}>
                      <img src={alert.screenshot_path} alt="Alert snapshot" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Eye size={18} className="text-white" />
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video bg-black/30 rounded-lg flex items-center justify-center border border-white/[0.06]">
                      <span className="text-[11px] text-ink-500">No image captured</span>
                    </div>
                  )}

                  <div className="mt-3 flex-1 flex flex-col justify-between">
                    <p className="text-[12px] font-medium text-ink-200 leading-normal mb-3 min-h-[32px]">{alert.message}</p>
                    <div className="pt-3 border-t border-white/[0.05] flex items-center justify-between text-[11px] text-ink-400">
                      <span>{new Date(alert.timestamp).toLocaleString()}</span>
                      <div className="flex gap-1">
                        {alert.screenshot_path && (
                          <Button size="icon" variant="ghost" onClick={() => handleDownload(alert.screenshot_path!, alert.camera_name, alert.timestamp)} title="Download">
                            <Download size={13} />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="hover:text-red-400" onClick={() => deleteMutation.mutate(alert.id)} title="Delete">
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedSnapshot && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedSnapshot(null)} className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 z-[999]">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="relative max-w-4xl max-h-[85vh] rounded-2xl overflow-hidden border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <img src={selectedSnapshot} alt="Snapshot preview" className="max-w-full max-h-[80vh] object-contain" />
              <button onClick={() => setSelectedSnapshot(null)} className="absolute top-3 right-3 p-2 rounded-full bg-black/70 text-white hover:bg-black border border-white/10">
                <X size={16} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
