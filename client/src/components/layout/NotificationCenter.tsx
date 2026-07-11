import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, ShieldAlert, ArrowRightLeft, Clock3 } from 'lucide-react';
import axios from 'axios';
import { formatRelative } from '../../utils/formatters';

interface Alert {
  id: string;
  timestamp: string;
  camera_id: string;
  camera_name: string;
  alert_type: 'intrusion' | 'crossing' | 'loitering' | string;
  message: string;
}

const LAST_SEEN_KEY = 'camai:notifications-last-seen';

const ICONS: Record<string, React.ReactNode> = {
  intrusion: <ShieldAlert size={13} className="text-red-400" />,
  crossing: <ArrowRightLeft size={13} className="text-blue-400" />,
  loitering: <Clock3 size={13} className="text-amber-400" />,
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(() => Number(localStorage.getItem(LAST_SEEN_KEY) || 0));
  const ref = useRef<HTMLDivElement>(null);

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts', 'notification-center'],
    queryFn: async () => {
      const { data } = await axios.get('/api/alerts?limit=20');
      return data;
    },
    refetchInterval: 5000,
  });

  const unreadCount = alerts.filter((a) => new Date(a.timestamp).getTime() > lastSeen).length;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      setLastSeen(now);
      localStorage.setItem(LAST_SEEN_KEY, String(now));
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleToggle}
        className="relative h-8 w-8 flex items-center justify-center rounded-lg text-ink-300 hover:text-white hover:bg-white/[0.06] transition-colors"
        title="Notifications"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute right-0 mt-2 w-80 panel-raised overflow-hidden z-50"
          >
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <span className="text-[12px] font-bold text-white uppercase tracking-wider">Notifications</span>
              <span className="text-[10px] text-ink-400">{alerts.length} recent</span>
            </div>
            <div className="max-h-96 overflow-y-auto custom-scrollbar">
              {alerts.length === 0 ? (
                <div className="py-10 text-center text-[12px] text-ink-400">No notifications yet.</div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      {ICONS[a.alert_type] || <ShieldAlert size={13} className="text-ink-400" />}
                      <span className="text-[11px] font-bold text-ink-200 uppercase tracking-wide">{a.camera_name}</span>
                      <span className="ml-auto text-[10px] text-ink-500">{formatRelative(a.timestamp)}</span>
                    </div>
                    <p className="text-[12px] text-ink-300 leading-snug">{a.message}</p>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
