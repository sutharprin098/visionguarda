import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListTree, ShieldAlert, ScanEye, Clock, Search, X } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Tabs } from '../components/ui/Tabs';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { fetchAlerts, fetchHistoryRecords, fetchCameras } from '../utils/api';
import { formatDate, formatRelative } from '../utils/formatters';

type UnifiedEvent = {
  id: string;
  kind: 'alert' | 'detection';
  timestamp: string;
  cameraName: string;
  title: string;
  detail: string;
  tone: 'danger' | 'info' | 'warning' | 'neutral';
};

export default function Events() {
  const [filter, setFilter] = useState<'all' | 'alert' | 'detection'>('all');
  const [cameraFilter, setCameraFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: fetchCameras });
  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', 'events'],
    queryFn: () => fetchAlerts(200),
    refetchInterval: 5000,
  });
  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['history', 'events'],
    queryFn: () => fetchHistoryRecords(200),
    refetchInterval: 5000,
  });

  const events: UnifiedEvent[] = useMemo(() => {
    // camera_name can be null: it's a LEFT JOIN against the cameras table
    // server-side, so alerts/history rows outlive a deleted camera (its
    // events remain, orphaned) rather than being cascade-deleted with it.
    const alertEvents: UnifiedEvent[] = alerts.map((a) => ({
      id: `alert_${a.id}`,
      kind: 'alert',
      timestamp: a.timestamp,
      cameraName: a.camera_name || 'Deleted Camera',
      title: a.alert_type.charAt(0).toUpperCase() + a.alert_type.slice(1),
      detail: a.message,
      tone: a.alert_type === 'intrusion' ? 'danger' : a.alert_type === 'crossing' ? 'info' : 'warning',
    }));

    const detectionEvents: UnifiedEvent[] = history
      .filter((h) => h.status === 'human_found')
      .map((h) => ({
        id: `hist_${h.id}`,
        kind: 'detection',
        timestamp: h.timestamp,
        cameraName: h.camera_name || 'Deleted Camera',
        title: `${h.people_count} ${h.people_count === 1 ? 'person' : 'people'} detected`,
        detail: h.max_confidence != null ? `Peak confidence ${(h.max_confidence * 100).toFixed(0)}% · ${h.processing_time}ms` : `${h.processing_time}ms processing`,
        tone: 'neutral',
      }));

    return [...alertEvents, ...detectionEvents].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [alerts, history]);

  const query = search.trim().toLowerCase();
  const filtered = events
    .filter((e) => filter === 'all' || e.kind === filter)
    .filter((e) => cameraFilter === 'all' || e.cameraName === cameraFilter)
    .filter((e) =>
      !query ||
      e.title.toLowerCase().includes(query) ||
      e.detail.toLowerCase().includes(query) ||
      e.cameraName.toLowerCase().includes(query)
    );

  const isLoading = alertsLoading || historyLoading;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Events" subtitle="Unified timeline of detections and security alerts" />

      <div className="flex items-center justify-between gap-3 px-6 py-2.5 border-b border-white/[0.06] shrink-0">
        <Tabs
          active={filter}
          onChange={(v) => setFilter(v as any)}
          tabs={[
            { value: 'all', label: 'All Events' },
            { value: 'alert', label: 'Alerts', icon: <ShieldAlert size={12} /> },
            { value: 'detection', label: 'Detections', icon: <ScanEye size={12} /> },
          ]}
        />
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events…"
              className="bg-white/[0.04] border border-white/[0.08] rounded-lg pl-8 pr-7 py-1.5 text-xs text-white placeholder:text-ink-500 focus:outline-none w-48"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 hover:text-white"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <select
            value={cameraFilter}
            onChange={(e) => setCameraFilter(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
          >
            <option value="all">All Cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl animate-pulse bg-white/[0.04]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<ListTree size={20} />} title="No events found" description="Detections and alerts will appear here as cameras go live." />
        ) : (
          <div className="panel divide-y divide-white/[0.05] overflow-hidden">
            {filtered.map((e) => (
              <div key={e.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                  {e.kind === 'alert' ? <ShieldAlert size={14} className="text-red-400" /> : <ScanEye size={14} className="text-brand-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-white truncate">{e.title}</span>
                    <Badge tone={e.tone}>{e.cameraName}</Badge>
                  </div>
                  <p className="text-[12px] text-ink-400 truncate">{e.detail}</p>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-ink-500 shrink-0" title={formatDate(e.timestamp)}>
                  <Clock size={11} />
                  {formatRelative(e.timestamp)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
