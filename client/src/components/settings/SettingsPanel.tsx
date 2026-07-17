import React, { useState } from 'react';
import { Gauge, Cpu, Image as ImageIcon, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardBody } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { fetchStatus, updateCameraDisplay, fetchCameras } from '../../utils/api';
import api from '../../utils/api';
import { formatUptime } from '../../utils/formatters';

const PERFORMANCE_TIERS = [
  { key: 'yolox_tiny', name: 'Fast', description: 'Lowest latency, best for many simultaneous feeds' },
  { key: 'yolox_s', name: 'Balanced', description: 'Balances speed and detection accuracy' },
  { key: 'yolox_m', name: 'Accurate', description: 'Highest detection accuracy, more processing time' },
];

function tierName(modelFile?: string) {
  return PERFORMANCE_TIERS.find((t) => t.key === modelFile)?.name || 'Balanced';
}

const QUALITY_KEY = 'camai:default-preview-quality';

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number>(() => Number(localStorage.getItem(QUALITY_KEY)) || 960);
  const [applying, setApplying] = useState(false);

  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 5000,
  });

  const { data: cameras = [] } = useQuery({ queryKey: ['cameras'], queryFn: fetchCameras });

  const switchTier = async (modelFile: string) => {
    try {
      setSwitching(modelFile);
      await api.post('/model/select', { model_name: modelFile });
      await refetch();
    } catch (err) {
      console.error('Failed to switch performance tier:', err);
    } finally {
      setSwitching(null);
    }
  };

  const applyPreviewQuality = async () => {
    setApplying(true);
    localStorage.setItem(QUALITY_KEY, String(previewWidth));
    try {
      const runningIds = Object.keys(status?.cameras || {});
      await Promise.all(runningIds.map((id) => updateCameraDisplay(id, { max_width: previewWidth })));
    } finally {
      setApplying(false);
    }
  };

  const activeCamerasCount = status?.cameras ? Object.keys(status.cameras).length : 0;

  return (
    <div className="space-y-6 max-w-2xl">
      {status?.recommendation?.should_switch && (
        <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-200 text-[12px] flex flex-col md:flex-row items-start md:items-center gap-3">
          <AlertTriangle size={17} className="text-amber-400 shrink-0 mt-0.5 md:mt-0" />
          <div className="flex-1">
            <span className="font-semibold text-white block mb-0.5">Performance Recommendation</span>
            Detection latency is high for the current performance tier on this hardware. Switching to a faster tier will improve real-time responsiveness.
          </div>
          <Button
            size="sm"
            onClick={() => switchTier(status.recommendation.suggested_model)}
            disabled={switching !== null}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 shrink-0"
          >
            {switching === status.recommendation.suggested_model && <Loader2 size={12} className="animate-spin" />}
            Switch to {tierName(status.recommendation.suggested_model)}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>System Status</CardTitle>
          <Button size="icon" variant="ghost" onClick={() => refetch()}>
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          </Button>
        </CardHeader>
        <CardBody>
          {status ? (
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              {[
                ['Status', 'Online', 'success'],
                ['Detection Engine', status.modelLoaded ? `Active — ${tierName(status.selectedModel)}` : 'Starting…', status.modelLoaded ? 'success' : 'warning'],
                ['Uptime', formatUptime(status.uptime), 'neutral'],
                ['Active Camera Feeds', `${activeCamerasCount} running`, 'info'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className="flex justify-between items-center p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <span className="text-ink-400">{label}</span>
                  <Badge tone={tone as any}>{value}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-red-400">Cannot reach the CamAI system. Confirm it is running and reachable on this network.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detection Performance Tier</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p className="text-[12px] text-ink-400 mb-1">Choose how the detection engine balances speed against accuracy across all cameras.</p>
          {PERFORMANCE_TIERS.map((tier) => {
            const isSelected = status?.selectedModel === tier.key;
            const bench = status?.benchmark?.[tier.key.replace('.pt', '')];
            return (
              <div
                key={tier.key}
                className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                  isSelected ? 'border-brand-500/40 bg-brand-500/10' : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  <div>
                    <p className="text-[13px] font-semibold text-white">{tier.name}</p>
                    <p className="text-[11px] text-ink-500">{tier.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {bench?.avg_latency_ms && (
                    <span className="text-[11px] font-mono text-ink-400">{bench.avg_latency_ms.toFixed(0)}ms</span>
                  )}
                  {isSelected ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => switchTier(tier.key)} loading={switching === tier.key}>
                      Activate
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Live Preview Quality</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div>
            <label className="block mb-1.5 text-[12px] font-medium text-ink-300">
              Default preview resolution: <span className="text-brand-400 font-mono">{previewWidth}px wide</span>
            </label>
            <input
              type="range" min={480} max={1920} step={80}
              value={previewWidth}
              onChange={(e) => setPreviewWidth(Number(e.target.value))}
              className="w-full accent-brand-500 cursor-pointer"
            />
          </div>
          <Button size="sm" variant="secondary" onClick={applyPreviewQuality} loading={applying}>
            <ImageIcon size={13} />
            Apply to {Object.keys(status?.cameras || {}).length || 0} Active Feed{Object.keys(status?.cameras || {}).length === 1 ? '' : 's'}
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
