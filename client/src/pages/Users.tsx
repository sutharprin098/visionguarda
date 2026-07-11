import React, { useEffect, useState } from 'react';
import { UserCircle, MonitorSmartphone, ShieldCheck, Clock } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Card, CardHeader, CardTitle, CardBody } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

const SESSION_START_KEY = 'camai:session-start';

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown platform';
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown browser';
}

export default function Users() {
  const [sessionStart, setSessionStart] = useState<string>('');

  useEffect(() => {
    let stored = sessionStorage.getItem(SESSION_START_KEY);
    if (!stored) {
      stored = new Date().toISOString();
      sessionStorage.setItem(SESSION_START_KEY, stored);
    }
    setSessionStart(stored);
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Users" subtitle="Operator access and session information" />

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Current Operator</CardTitle>
            <Badge tone="success">Active</Badge>
          </CardHeader>
          <CardBody className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-300">
              <UserCircle size={28} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-white">Console Operator</p>
              <p className="text-[12px] text-ink-400">Full access to live monitoring, camera management, and system settings on this device.</p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Session Details</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {[
              { icon: <Clock size={14} className="text-cyan-400" />, label: 'Session started', value: sessionStart ? new Date(sessionStart).toLocaleString() : '—' },
              { icon: <MonitorSmartphone size={14} className="text-brand-300" />, label: 'Device', value: `${detectPlatform()} · ${detectBrowser()}` },
              { icon: <ShieldCheck size={14} className="text-emerald-400" />, label: 'Access level', value: 'Full operator access (local console)' },
            ].map((row, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
                <span className="flex items-center gap-2 text-[12px] text-ink-300">{row.icon}{row.label}</span>
                <span className="text-[12px] font-semibold text-white">{row.value}</span>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Access Model</CardTitle></CardHeader>
          <CardBody>
            <p className="text-[12px] text-ink-400 leading-relaxed">
              This deployment runs as a single-operator console — anyone with access to this device or network
              has full control of cameras, alerts, and recordings. Multi-account roles and permission tiers are
              not provisioned in this installation.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
