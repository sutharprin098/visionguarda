import React from 'react';
import { motion } from 'framer-motion';
import { Sun, Moon, RefreshCw } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useQuery } from '@tanstack/react-query';
import { fetchStatus } from '../../utils/api';
import { formatUptime } from '../../utils/formatters';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { theme, toggle } = useTheme();

  const { data: status, refetch, isFetching } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: 15000,
  });

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b"
      style={{ borderColor: 'rgba(99,102,241,0.12)', background: 'rgba(10,10,15,0.6)', backdropFilter: 'blur(8px)' }}>
      
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{subtitle}</p>
        )}
      </div>

      {/* Status + Controls */}
      <div className="flex items-center gap-4">
        {/* Server status pill */}
        {status && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}
          >
            <div className="status-dot online" />
            <span>Server Online · {formatUptime(status.uptime)}</span>
          </motion.div>
        )}

        {/* Local model status */}
        {status && (
          <div className="hidden md:flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full"
            style={{
              background: status.modelLoaded ? 'rgba(99,102,241,0.1)' : 'rgba(239,68,68,0.1)',
              border: `1px solid ${status.modelLoaded ? 'rgba(99,102,241,0.25)' : 'rgba(239,68,68,0.25)'}`,
              color: status.modelLoaded ? '#818cf8' : '#f87171',
            }}>
            <div className={`status-dot ${status.modelLoaded ? 'online' : 'offline'}`} />
            {status.modelLoaded ? 'Local Model Ready' : 'Model Unavailable'}
          </div>
        )}

        {/* Refresh */}
        <button onClick={() => refetch()} className="btn-ghost p-2 rounded-xl" title="Refresh status">
          <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
        </button>

        {/* Theme toggle */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={toggle}
          className="btn-ghost p-2 rounded-xl"
          title="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </motion.button>
      </div>
    </header>
  );
}
