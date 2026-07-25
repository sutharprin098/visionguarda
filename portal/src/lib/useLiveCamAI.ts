import { useState, useEffect } from "react";
import { supabase } from "./supabase";

export interface LiveSystemStatus {
  server: string;
  uptime: number;
  modelLoaded: boolean;
  cameraThreadsActive: number;
  selectedModel: string;
  engine: {
    cpu_percent: number;
    memory_mb: number;
    gpu_percent: number;
    device: string;
    avg_fps: number;
    avg_latency_ms: number;
    active_cameras: number;
  };
  cameras: Record<string, {
    name: string;
    running: boolean;
    fps: number;
    latency: number;
    counters: { in: number; out: number };
    health_status: string;
    resolution: [number, number];
    recording: boolean;
  }>;
}

export interface LiveAlert {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  snapshot_path: string | null;
  created_at: string;
  camera_id: string | null;
  detail?: Record<string, any>;
}

export interface LiveCamera {
  id: string;
  name: string;
  source_type: string;
  status: string;
  is_enabled: boolean;
  created_at: string;
}

export interface LiveDevice {
  id: string;
  name: string;
  is_online: boolean;
  last_seen_at: string | null;
  hardware?: { cpu?: string; ram_gb?: number; gpu?: string };
}

export function useLiveCamAI() {
  const [systemStatus, setSystemStatus] = useState<LiveSystemStatus | null>(null);
  const [cameras, setCameras] = useState<LiveCamera[]>([]);
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [stats, setStats] = useState<{
    totalCameras: number;
    onlineCameras: number;
    totalAlerts: number;
    activeDevices: number;
  }>({
    totalCameras: 0,
    onlineCameras: 0,
    totalAlerts: 0,
    activeDevices: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchBackendStatus = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch("http://localhost:8000/api/status", { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
      }
    } catch (_) {
      // Local engine server offline or unreachable
    }
  };

  const fetchSupabaseData = async () => {
    try {
      const [camsRes, alertsRes, devRes] = await Promise.all([
        supabase.from("cameras").select("id, name, source_type, status, is_enabled, created_at").order("name"),
        supabase.from("alerts").select("id, kind, severity, title, snapshot_path, created_at, camera_id, detail").order("created_at", { ascending: false }).limit(20),
        supabase.from("devices").select("id, name, is_online, last_seen_at, hardware").order("created_at", { ascending: false }).limit(10),
      ]);

      const fetchedCameras = (camsRes.data || []) as LiveCamera[];
      const fetchedAlerts = (alertsRes.data || []) as LiveAlert[];
      const fetchedDevices = (devRes.data || []) as LiveDevice[];

      setCameras(fetchedCameras);
      setAlerts(fetchedAlerts);
      setDevices(fetchedDevices);

      setStats({
        totalCameras: fetchedCameras.length,
        onlineCameras: fetchedCameras.filter((c) => c.status === "online" || c.is_enabled).length,
        totalAlerts: fetchedAlerts.length,
        activeDevices: fetchedDevices.filter((d) => d.is_online).length,
      });
    } catch (e) {
      console.warn("Failed fetching live Supabase data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    fetchBackendStatus();
    fetchSupabaseData();

    // Polling interval for live telemetry
    const interval = setInterval(() => {
      if (isMounted) {
        fetchBackendStatus();
        fetchSupabaseData();
      }
    }, 5000);

    // Supabase Realtime Listener for Alerts & Cameras
    const channelName = `landing-live-${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        if (isMounted) fetchSupabaseData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, () => {
        if (isMounted) fetchSupabaseData();
      });

    channel.subscribe();

    return () => {
      isMounted = false;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    systemStatus,
    cameras,
    alerts,
    devices,
    stats,
    loading,
  };
}
