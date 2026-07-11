import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../../utils/api';
import { NotificationCenter } from './NotificationCenter';

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 15000,
  });

  const engineReady = status?.modelLoaded ?? false;

  return (
    <header className="flex items-center justify-between h-14 px-6 border-b border-white/[0.06] shrink-0">
      <div className="min-w-0">
        <h1 className="text-[15px] font-bold text-white leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-ink-400 truncate">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}

        <div className="hidden md:flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium bg-white/[0.04] border border-white/[0.06] text-ink-300">
          <span className={`status-dot ${status ? 'online' : 'offline'}`} />
          System {status ? 'Online' : 'Connecting'}
        </div>

        <div className="hidden lg:flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium bg-white/[0.04] border border-white/[0.06] text-ink-300">
          <span className={`status-dot ${engineReady ? 'online' : 'warn'}`} />
          Detection Engine {engineReady ? 'Active' : 'Starting'}
        </div>

        <button onClick={() => refetch()} className="h-8 w-8 flex items-center justify-center rounded-lg text-ink-300 hover:text-white hover:bg-white/[0.06] transition-colors" title="Refresh">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
        </button>

        <NotificationCenter />
      </div>
    </header>
  );
}
