import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Camera,
  Video,
  BarChart3,
  ListTree,
  ShieldAlert,
  Film,
  FileBarChart,
  Users,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/live', label: 'Live Monitoring', icon: Video },
  { to: '/cameras', label: 'Cameras', icon: Camera },
  { to: '/analytics', label: 'AI Analytics', icon: BarChart3 },
  { to: '/events', label: 'Events', icon: ListTree },
  { to: '/alerts', label: 'Alerts', icon: ShieldAlert },
  { to: '/recordings', label: 'Recordings', icon: Film },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
];

const COLLAPSE_KEY = 'camai:sidebar-collapsed';

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  return (
    <aside
      className={clsx(
        'flex-shrink-0 flex flex-col h-screen sticky top-0 overflow-hidden border-r border-white/[0.06] transition-[width] duration-200',
        collapsed ? 'w-[64px]' : 'w-[236px]'
      )}
      style={{ background: 'var(--color-canvas)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 h-14 px-4 shrink-0">
        <img src="/favicon.svg" alt="CamAI" className="w-7 h-7 rounded-lg shrink-0" />
        {!collapsed && <span className="text-[13px] font-bold text-white tracking-tight">CamAI</span>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2.5 py-2 space-y-0.5 overflow-y-auto custom-scrollbar">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            {({ isActive }) => (
              <div className={clsx('sidebar-item', isActive && 'active', collapsed && 'justify-center px-0')} title={collapsed ? label : undefined}>
                <Icon size={16} strokeWidth={2} />
                {!collapsed && <span className="flex-1 truncate">{label}</span>}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="p-2.5 border-t border-white/[0.06]">
        <button
          onClick={toggle}
          className={clsx('sidebar-item w-full', collapsed && 'justify-center px-0')}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
