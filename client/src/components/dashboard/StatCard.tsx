import React from 'react';
import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  highlight?: boolean;
  loading?: boolean;
  index?: number;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-brand-400',
  trend,
  trendValue,
  highlight = false,
  loading = false,
  index = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: 'easeOut' }}
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={clsx(
        'glass-card p-5 relative overflow-hidden group cursor-default',
        highlight && 'border-glow'
      )}
    >
      {/* Background glow on hover */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at top left, rgba(99,102,241,0.08) 0%, transparent 60%)' }} />

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={clsx(
            'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
          )} style={{ background: 'rgba(99,102,241,0.12)' }}>
            <Icon size={17} className={clsx(iconColor)} />
          </div>
        </div>
        {trendValue && (
          <span className={clsx(
            'text-xs font-semibold px-2 py-0.5 rounded-full',
            trend === 'up' && 'bg-emerald-400/10 text-emerald-400',
            trend === 'down' && 'bg-red-400/10 text-red-400',
            trend === 'neutral' && 'bg-slate-400/10 text-slate-400',
          )}>
            {trendValue}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-8 w-24 rounded-lg animate-pulse" style={{ background: 'rgba(99,102,241,0.15)' }} />
          <div className="h-3 w-32 rounded animate-pulse" style={{ background: 'rgba(99,102,241,0.08)' }} />
        </div>
      ) : (
        <>
          <p className="text-2xl font-bold mb-1 font-mono leading-none" style={{ color: 'var(--color-text)' }}>{value}</p>
          <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--color-text-muted)' }}>{title}</p>
          {subtitle && (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.8 }}>{subtitle}</p>
          )}
        </>
      )}
    </motion.div>
  );
}
