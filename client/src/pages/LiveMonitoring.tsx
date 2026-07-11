import React, { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Maximize2, Minimize2, LayoutGrid, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CameraGrid } from '../components/camera/CameraGrid';
import { AlertSidebar } from '../components/dashboard/AlertSidebar';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { fetchCameras, fetchAlerts, clearAllAlerts } from '../utils/api';

const GRID_SIZES = [1, 4, 9, 16];

export default function LiveMonitoring() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [gridSize, setGridSize] = useState<number>(4);
  const [showAlerts, setShowAlerts] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { data: cameras = [], refetch: refetchCameras } = useQuery({
    queryKey: ['cameras'],
    queryFn: fetchCameras,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => fetchAlerts(50),
    refetchInterval: 3000,
  });

  const clearAlertsMutation = useMutation({
    mutationFn: clearAllAlerts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar
        title="Live Monitoring"
        subtitle="Real-time multi-camera surveillance"
        actions={
          <Button size="sm" variant="outline" onClick={() => navigate('/cameras')}>
            <Settings2 size={13} />
            Manage Cameras
          </Button>
        }
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1 border border-white/[0.06]">
            {GRID_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => setGridSize(size)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                  gridSize === size ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-400 hover:text-white'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-ink-500 font-bold uppercase tracking-wider flex items-center gap-1">
            <LayoutGrid size={11} />
            Feed Layout
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowAlerts((v) => !v)}>
            {showAlerts ? 'Hide' : 'Show'} Alert Feed
          </Button>
          <Button size="sm" variant="outline" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      {/* Main Grid + Sidebar Container */}
      <div ref={containerRef} className="flex-1 flex min-h-0 overflow-hidden bg-[var(--color-canvas)]">
        <div className="flex-1 min-w-0 p-4 h-full">
          <CameraGrid cameras={cameras} gridSize={gridSize} onConfigChange={refetchCameras} />
        </div>

        {showAlerts && (
          <div className="w-80 border-l border-white/[0.06] h-full p-4 hidden lg:block">
            <AlertSidebar alerts={alerts} onClear={() => clearAlertsMutation.mutate()} />
          </div>
        )}
      </div>
    </div>
  );
}
