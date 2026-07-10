import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchLogs, clearLogs } from '../../utils/api';
import { Trash2, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { formatDate, formatMs, formatBytes } from '../../utils/formatters';
import clsx from 'clsx';

export function APILogs() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logs'],
    queryFn: fetchLogs,
    refetchInterval: 5000,
  });

  const clearMutation = useMutation({
    mutationFn: clearLogs,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logs'] }),
  });

  const logs = data?.logs ?? [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {logs.length} request{logs.length !== 1 ? 's' : ''} logged
        </p>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-ghost flex items-center gap-1.5 text-xs">
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => clearMutation.mutate()}
            disabled={logs.length === 0 || clearMutation.isPending}
            className="btn-danger flex items-center gap-1.5 text-xs disabled:opacity-40"
          >
            <Trash2 size={13} />
            Clear Logs
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-xl animate-pulse" style={{ background: 'rgba(99,102,241,0.08)' }} />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--color-text-muted)' }}>
          <Clock size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No API requests logged yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid rgba(99,102,241,0.12)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'rgba(99,102,241,0.06)', borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
                {['Status', 'Method', 'Endpoint', 'Duration', 'Req Size', 'Time'].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <motion.tr
                  key={log.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i < 20 ? i * 0.01 : 0 }}
                  className="border-b transition-colors hover:bg-brand-500/5"
                  style={{ borderColor: 'rgba(99,102,241,0.06)' }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {log.statusCode < 400
                        ? <CheckCircle size={12} className="text-emerald-400" />
                        : <XCircle size={12} className="text-red-400" />
                      }
                      <span className={clsx(
                        'font-mono font-bold',
                        log.statusCode < 400 ? 'text-emerald-400' : 'text-red-400'
                      )}>
                        {log.statusCode}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-1.5 py-0.5 rounded font-mono font-bold"
                      style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', fontSize: '10px' }}>
                      {log.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono" style={{ color: 'var(--color-text)' }}>{log.endpoint}</td>
                  <td className="px-4 py-3 font-mono" style={{ color: 'var(--color-text-muted)' }}>{formatMs(log.duration)}</td>
                  <td className="px-4 py-3 font-mono" style={{ color: 'var(--color-text-muted)' }}>{formatBytes(log.requestSize)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>{formatDate(log.timestamp)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
