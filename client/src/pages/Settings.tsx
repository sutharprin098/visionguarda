import React from 'react';
import { Topbar } from '../components/layout/Topbar';
import { SettingsPanel } from '../components/settings/SettingsPanel';

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Topbar title="Settings" subtitle="Configure detection performance and system preferences" />
      <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
        <SettingsPanel />
      </div>
    </div>
  );
}
