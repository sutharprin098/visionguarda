import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Camera,
  History,
  FileJson,
  Settings,
  Zap,
  ChevronRight,
  Monitor,
} from 'lucide-react';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/camera', label: 'Live Camera', icon: Camera },
  { to: '/screenshare', label: 'Screen Share', icon: Monitor },
  { to: '/history', label: 'Detection History', icon: History },
  { to: '/logs', label: 'API Logs', icon: FileJson },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-screen sticky top-0 overflow-hidden"
      style={{ background: 'rgba(10,10,15,0.95)', borderRight: '1px solid rgba(99,102,241,0.12)' }}>
      
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-6">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 0 20px rgba(99,102,241,0.5)' }}>
          <Zap size={18} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white leading-tight">CamAI</p>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Human Detection</p>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 mb-4 h-px" style={{ background: 'rgba(99,102,241,0.12)' }} />

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: 'var(--color-text-muted)' }}>Navigation</p>
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
          const isActive = to === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(to);

          return (
            <NavLink key={to} to={to}>
              <motion.div
                whileHover={{ x: 2 }}
                className={clsx('sidebar-item', isActive && 'active')}
              >
                <Icon size={16} />
                <span className="flex-1">{label}</span>
                {isActive && <ChevronRight size={12} className="opacity-60" />}
              </motion.div>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 mx-3 mb-4 rounded-xl" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)' }}>
        <p className="text-xs font-semibold text-white mb-1">YOLO11n Seg</p>
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          Powered by local model inference
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <div className="status-dot online" />
          <span className="text-[11px] text-emerald-400">Model Ready</span>
        </div>
      </div>
    </aside>
  );
}
