import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './components/layout/Sidebar';
import Dashboard from './pages/Dashboard';
import LiveCamera from './pages/LiveCamera';
import ScreenShareDetection from './pages/ScreenShareDetection';
import HistoryPage from './pages/History';
import APILogsPage from './pages/APILogs';
import SettingsPage from './pages/Settings';
import { useTheme } from './hooks/useTheme';
import { TelemetryProvider } from './contexts/TelemetryContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5000,
    },
  },
});

function AppInner() {
  // Apply theme class to document root
  useTheme();

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/camera" element={<LiveCamera />} />
            <Route path="/screenshare" element={<ScreenShareDetection />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/logs" element={<APILogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TelemetryProvider>
        <AppInner />
      </TelemetryProvider>
    </QueryClientProvider>
  );
}
