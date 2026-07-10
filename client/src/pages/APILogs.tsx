import React from 'react';
import { Header } from '../components/layout/Header';
import { APILogs } from '../components/logs/APILogs';

export default function APILogsPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="API Logs" subtitle="Backend request and response log" />
      <div className="flex-1 overflow-y-auto p-6">
        <APILogs />
      </div>
    </div>
  );
}
