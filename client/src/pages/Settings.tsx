import React from 'react';
import { Header } from '../components/layout/Header';
import { SettingsPanel } from '../components/settings/SettingsPanel';

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Settings" subtitle="Configure CamAI detection parameters" />
      <div className="flex-1 overflow-y-auto p-6">
        <SettingsPanel />
      </div>
    </div>
  );
}
