import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './components/layout/Sidebar';
import Dashboard from './pages/Dashboard';
import LiveMonitoring from './pages/LiveMonitoring';
import Cameras from './pages/Cameras';
import AIAnalytics from './pages/AIAnalytics';
import Events from './pages/Events';
import Alerts from './pages/Alerts';
import Recordings from './pages/Recordings';
import Reports from './pages/Reports';
import Users from './pages/Users';
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
  useTheme();

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/live" element={<LiveMonitoring />} />
            <Route path="/cameras" element={<Cameras />} />
            <Route path="/analytics" element={<AIAnalytics />} />
            <Route path="/events" element={<Events />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/recordings" element={<Recordings />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/users" element={<Users />} />
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
