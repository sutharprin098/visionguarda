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
  loading = false,
  index = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3, ease: 'easeOut' }}
      className="panel p-4 relative overflow-hidden"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.05]">
          <Icon size={15} className={iconColor} />
        </div>
        {trendValue && (
          <span
            className={clsx(
              'text-[10px] font-bold px-1.5 py-0.5 rounded',
              trend === 'up' && 'bg-emerald-400/10 text-emerald-400',
              trend === 'down' && 'bg-red-400/10 text-red-400',
              trend === 'neutral' && 'bg-white/[0.06] text-ink-400'
            )}
          >
            {trendValue}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-7 w-20 rounded-md animate-pulse bg-white/[0.06]" />
          <div className="h-3 w-28 rounded animate-pulse bg-white/[0.04]" />
        </div>
      ) : (
        <>
          <p className="text-xl font-bold mb-0.5 font-mono leading-none text-white">{value}</p>
          <p className="text-[12px] font-medium text-ink-300">{title}</p>
          {subtitle && <p className="text-[11px] text-ink-500 mt-0.5">{subtitle}</p>}
        </>
      )}
    </motion.div>
  );
}
