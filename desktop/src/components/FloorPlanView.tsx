import { useState, useEffect, useRef, useMemo } from "react";
import { Map as MapIcon, Car, Users, Activity, Eye, Box, Sparkles, Sliders, Layers } from "lucide-react";
import { getSupabase } from "../lib/session";
import type { SyncBundle } from "../lib/sync";
import { mjpegStreamUrl, getEngineAppStatus, type EngineAppStatus } from "../lib/localEngine";
import { TelemetrySession, type CameraTelemetry } from "../lib/telemetry";
import DigitalTwin3DView, { type CameraSpatialConfig, type CameraSlot } from "./DigitalTwin3DView";
import ErrorBoundary from "./ErrorBoundary";
import clsx from "clsx";

interface FloorPlanViewProps {
  bundle: SyncBundle;
  healthInfo?: any;
  onSelectCamera: (cameraId: string) => void;
}

function CleanStreamImg({ cameraId, name, className }: { cameraId: string; name?: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    return () => {
      if (ref.current) ref.current.src = "";
    };
  }, [cameraId]);
  return (
    <img
      ref={ref}
      key={cameraId}
      src={mjpegStreamUrl(cameraId)}
      alt={name || ""}
      className={className}
    />
  );
}

let leafletPromise: Promise<void> | null = null;
function loadLeaflet(): Promise<void> {
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    if ((window as any).L) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
  return leafletPromise;
}

export default function FloorPlanView({ bundle, healthInfo, onSelectCamera }: FloorPlanViewProps) {
  const isManager = bundle.profile?.role === "admin" || bundle.profile?.role === "manager";

  const [viewMode, setViewMode] = useState<"3d" | "2d">("2d");
  const gisMapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const [selectedGisCamId, setSelectedGisCamId] = useState<string | null>(null);
  const [selectedUnplacedGisCamId, setSelectedUnplacedGisCamId] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [appStatus, setAppStatus] = useState<EngineAppStatus | null>(null);
  const [telemetryMap, setTelemetryMap] = useState<Record<string, CameraTelemetry>>({});
  const [camHeadings, setCamHeadings] = useState<Record<string, number>>({});
  const markersRef = useRef<Map<string, any>>(new Map());
  const detMarkersRef = useRef<Map<string, any>>(new Map());

  // 3D Spatial Fusion configuration per camera (persisted in localStorage)
  const [spatialConfigs, setSpatialConfigs] = useState<Record<string, CameraSpatialConfig>>(() => {
    try {
      const saved = localStorage.getItem("camai.3d_spatial_configs");
      if (saved) {
        const parsed = JSON.parse(saved);
        let changed = false;
        Object.keys(parsed).forEach(k => {
          const cfg = parsed[k];
          if (cfg.heading === 180 || cfg.heading === 0 || cfg.slot === "north" || !cfg.posZ || Math.abs(cfg.posZ - 22.0) > 3) {
            parsed[k] = {
              ...cfg,
              slot: "south",
              spatial_sync: true,
              heading: 355,
              pitch: 23,
              height: 13.0,
              fov: 56,
              posX: 1.5,
              posZ: 22.0,
            };
            changed = true;
          }
        });
        if (changed) {
          try {
            localStorage.setItem("camai.3d_spatial_configs", JSON.stringify(parsed));
          } catch {}
        }
        return parsed;
      }
    } catch {}
    return {};
  });

  const updateSpatialConfig = (camId: string, updates: Partial<CameraSpatialConfig>) => {
    setSpatialConfigs((prev) => {
      const existing = prev[camId] || {
        id: camId,
        name: bundle.cameras.find((c: any) => c.id === camId)?.name || "Camera",
        slot: "south" as CameraSlot,
        spatial_sync: true,
        heading: 355,
        pitch: 23,
        height: 13.0,
        fov: 56,
        posX: 1.5,
        posZ: 22.0,
      };
      const next = {
        ...prev,
        [camId]: { ...existing, ...updates },
      };
      try {
        localStorage.setItem("camai.3d_spatial_configs", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Initialize default 4-side slots (North, South, East, West) for cameras if not already configured
  useEffect(() => {
    if (bundle.cameras.length > 0) {
      const slots: CameraSlot[] = ["north", "south", "east", "west"];
      setSpatialConfigs((prev) => {
        let changed = false;
        const next = { ...prev };
        bundle.cameras.forEach((cam: any, idx: number) => {
          const isTrafficCam = bundle.cameras.length === 1 ||
                               cam?.id === "02" || 
                               cam?.name === "02" ||
                               (cam?.name || "").toLowerCase().includes("traffic") || 
                               (cam?.name || "").toLowerCase().includes("coldwater") || 
                               (cam?.source || "").includes("1H0iTzv2jiQ") ||
                               idx === 0;

          // Auto-heal if unconfigured or has outdated reverse heading or wrong slot
          const cur = next[cam.id];
          if (!cur || (isTrafficCam && (cur.heading === 180 || cur.heading === 0 || cur.slot === "north" || cur.posZ == null || Math.abs(cur.posZ - 22.0) > 3))) {
            changed = true;
            if (isTrafficCam) {
              next[cam.id] = {
                id: cam.id,
                name: cam.name,
                slot: "south",
                spatial_sync: true,
                heading: 355,
                pitch: 23,
                height: 13.0,
                fov: 56,
                posX: 1.5,
                posZ: 22.0,
              };
            } else {
              const slot = slots[idx % slots.length];
              const defaultHeading = slot === "north" ? 180 : slot === "south" ? 0 : slot === "east" ? 270 : 90;
              const posX = slot === "west" ? -24 : slot === "east" ? 24 : 0;
              const posZ = slot === "north" ? -24 : slot === "south" ? 24 : 0;
              next[cam.id] = {
                id: cam.id,
                name: cam.name,
                slot,
                spatial_sync: true,
                heading: defaultHeading,
                pitch: 28,
                height: 11.0,
                fov: 60,
                posX,
                posZ,
              };
            }
          }
        });
        if (changed) {
          try {
            localStorage.setItem("camai.3d_spatial_configs", JSON.stringify(next));
          } catch {}
          return next;
        }
        return prev;
      });
    }
  }, [bundle.cameras]);

  // Poll local engine app status for real-time running flags
  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      const st = await getEngineAppStatus();
      if (active) setAppStatus(st);
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Merge real-time engine health status with bundle cameras (memoized to prevent re-render thrashing)
  const camerasWithStatus = useMemo(() => {
    const list: any[] = [...(bundle?.cameras || [])];
    if (appStatus?.cameras) {
      Object.entries(appStatus.cameras).forEach(([id, cam]: [string, any]) => {
        if (!list.some(c => c.id === id)) {
          list.push({
            id,
            name: cam.name || `Camera ${id.slice(0, 4)}`,
            source: cam.source || "",
            status: cam.running ? "online" : "offline",
          });
        }
      });
    }
    return list.map((c: any) => {
      const localInfo = appStatus?.cameras?.[c.id] || healthInfo?.cameras?.[c.id];
      const isOnline = localInfo ? localInfo.running : (c.status === "online" || appStatus !== null);
      return {
        ...c,
        status: isOnline ? "online" : "offline"
      };
    });
  }, [bundle?.cameras, appStatus, healthInfo]);

  const cameraIdsKey = useMemo(
    () => camerasWithStatus.map((c: any) => c.id).sort().join(","),
    [camerasWithStatus]
  );

  const gisPlacedCameras = useMemo(
    () => camerasWithStatus.filter((c: any) => c.lat != null && c.lng != null),
    [camerasWithStatus]
  );
  const gisUnplacedCameras = useMemo(
    () => camerasWithStatus.filter((c: any) => c.lat == null || c.lng == null),
    [camerasWithStatus]
  );

  // Auto-select first camera if none selected or if selected is no longer in list
  useEffect(() => {
    if (camerasWithStatus.length > 0) {
      if (!selectedGisCamId || !camerasWithStatus.some(c => c.id === selectedGisCamId)) {
        setSelectedGisCamId(camerasWithStatus[0].id);
        if (camerasWithStatus[0].lat != null && camerasWithStatus[0].lng != null) {
          setManualLat(camerasWithStatus[0].lat.toString());
          setManualLng(camerasWithStatus[0].lng.toString());
        }
      }
    }
  }, [camerasWithStatus, selectedGisCamId]);

  // High-performance throttled telemetry subscription (buffers fast updates to eliminate 60 FPS React churn)
  const telemetryBufferRef = useRef<Record<string, CameraTelemetry>>({});
  const telemetryThrottleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // STABLE: only re-subscribes when cameras are physically added or removed, NEVER on the 2000ms appStatus polling tick
  useEffect(() => {
    const sessions: TelemetrySession[] = [];
    camerasWithStatus.forEach((cam: any) => {
      const session = new TelemetrySession(cam.id, (t) => {
        telemetryBufferRef.current[cam.id] = t;
        if (!telemetryThrottleTimerRef.current) {
          telemetryThrottleTimerRef.current = setTimeout(() => {
            telemetryThrottleTimerRef.current = null;
            setTelemetryMap({ ...telemetryBufferRef.current });
          }, 60); // ~16 FPS throttle for React state updates is silky and uses ~80% less CPU
        }
      });
      session.start();
      sessions.push(session);
    });
    return () => {
      sessions.forEach((s) => s.stop());
      if (telemetryThrottleTimerRef.current) {
        clearTimeout(telemetryThrottleTimerRef.current);
        telemetryThrottleTimerRef.current = null;
      }
    };
  }, [cameraIdsKey]);

  // ResizeObserver to keep Leaflet map perfectly sized without grey borders
  useEffect(() => {
    if (!gisMapRef.current) return;
    const ro = new ResizeObserver(() => {
      if (leafletMapRef.current) {
        leafletMapRef.current.invalidateSize();
      }
    });
    ro.observe(gisMapRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-select unplaced GIS camera
  useEffect(() => {
    if (gisUnplacedCameras.length > 0 && !selectedUnplacedGisCamId) {
      setSelectedUnplacedGisCamId(gisUnplacedCameras[0].id);
    } else if (gisUnplacedCameras.length === 0) {
      setSelectedUnplacedGisCamId("");
    }
  }, [gisUnplacedCameras, selectedUnplacedGisCamId]);

  const activeGisCamera = camerasWithStatus.find((c: any) => c.id === selectedGisCamId);
  const selectedTelemetry = selectedGisCamId ? telemetryMap[selectedGisCamId] : null;

  // Helper to build real-time map marker HTML badge
  const createMarkerHtml = (name: string, isOnline: boolean, t?: CameraTelemetry) => {
    const vehicles = t?.vehicles ?? 0;
    const people = t?.people ?? 0;
    const statusColor = isOnline ? "#10b981" : "#ef4444";
    return `
      <div style="
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(15, 23, 42, 0.94);
        backdrop-filter: blur(8px);
        border: 1.5px solid ${statusColor};
        box-shadow: 0 4px 14px rgba(0,0,0,0.6);
        padding: 4px 9px;
        border-radius: 20px;
        color: #f3f4f6;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
      ">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 8px ${statusColor}"></span>
        <span style="color: #ffffff; font-weight: 700;">${name}</span>
        ${isOnline ? `
          <span style="background: rgba(6, 182, 212, 0.25); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.3); padding: 1px 6px; border-radius: 12px; font-size: 10px; font-weight: 700;">🚗 ${vehicles}</span>
          <span style="background: rgba(99, 102, 241, 0.25); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 1px 6px; border-radius: 12px; font-size: 10px; font-weight: 700;">👤 ${people}</span>
        ` : `
          <span style="background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 1px 6px; border-radius: 12px; font-size: 10px;">Offline</span>
        `}
      </div>
    `;
  };

  // Initialize and update GIS Leaflet Map (Desktop)
  useEffect(() => {
    if (!gisMapRef.current) return;

    let active = true;

    loadLeaflet().then(() => {
      if (!active || !gisMapRef.current) return;
      const L = (window as any).L;
      if (!L) return;

      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }

      const center: [number, number] = gisPlacedCameras.length > 0
        ? [gisPlacedCameras[0].lat, gisPlacedCameras[0].lng]
        : [28.6139, 77.2090]; // Default New Delhi Smart City

      const map = L.map(gisMapRef.current).setView(center, 13);
      leafletMapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors"
      }).addTo(map);

      // Force Leaflet to recalculate container size so the full map displays properly
      map.invalidateSize();
      setTimeout(() => {
        if (leafletMapRef.current) {
          leafletMapRef.current.invalidateSize();
        }
      }, 250);

      markersRef.current.clear();

      // Add markers
      gisPlacedCameras.forEach((cam: any) => {
        const t = telemetryMap[cam.id];
        const iconHtml = createMarkerHtml(cam.name, cam.status === "online", t);
        
        const customIcon = L.divIcon({
          html: iconHtml,
          className: "custom-leaflet-badge-icon",
          iconSize: [160, 30],
          iconAnchor: [80, 15]
        });

        const marker = L.marker([cam.lat, cam.lng], {
          draggable: isManager,
          icon: customIcon
        }).addTo(map);

        markersRef.current.set(cam.id, marker);

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 11px; color: #1f2937; min-width: 150px; padding: 4px;">
            <strong style="font-size: 13px; color: #111827;">${cam.name}</strong>
            <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${cam.status === 'online' ? '#10b981' : '#ef4444'}"></span>
              <span style="text-transform: capitalize; color: #4b5563; font-weight: 600;">${cam.status}</span>
            </div>
            ${cam.status === 'online' ? `
              <div style="margin-top: 6px; font-size: 10px; color: #374151; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-top: 1px solid #e5e7eb; padding-top: 6px;">
                <div>🚗 Vehicles: <strong>${t?.vehicles ?? 0}</strong></div>
                <div>👤 People: <strong>${t?.people ?? 0}</strong></div>
                <div>⚡ FPS: <strong>${(t?.fps || t?.decode_fps || t?.camera_fps) ? (t?.fps || t?.decode_fps || t?.camera_fps)!.toFixed(1) : '--'}</strong></div>
                <div>👁️ Dets: <strong>${t?.detections?.length ?? 0}</strong></div>
              </div>
            ` : ''}
          </div>
        `);

        marker.on("click", () => {
          setSelectedGisCamId(cam.id);
          setManualLat(cam.lat.toString());
          setManualLng(cam.lng.toString());
        });

        if (isManager) {
          marker.on("dragend", async () => {
            const latLng = marker.getLatLng();
            const sb = await getSupabase();
            await sb
              .from("cameras")
              .update({ lat: latLng.lat, lng: latLng.lng })
              .eq("id", cam.id);
          });
        }
      });

      // Handle map clicks for placing new cameras
      if (isManager && selectedUnplacedGisCamId) {
        map.on("click", async (e: any) => {
          const { lat, lng } = e.latlng;
          const sb = await getSupabase();
          await sb
            .from("cameras")
            .update({ lat, lng })
            .eq("id", selectedUnplacedGisCamId);
          setSelectedUnplacedGisCamId("");
        });
      }
    });

    return () => {
      active = false;
    };
  }, [gisPlacedCameras.map((c: any) => c.id).join(","), isManager]);

  // Synchronize dynamic live detection markers (cars/people moving on map) & camera badges
  useEffect(() => {
    if (!leafletMapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    const map = leafletMapRef.current;
    const activeKeys = new Set<string>();

    gisPlacedCameras.forEach((cam: any) => {
      // 1. Update main camera pin badge
      const marker = markersRef.current.get(cam.id);
      const t = telemetryMap[cam.id];
      if (marker) {
        const html = createMarkerHtml(cam.name, cam.status === "online", t);
        const customIcon = L.divIcon({
          html,
          className: "custom-leaflet-badge-icon",
          iconSize: [160, 30],
          iconAnchor: [80, 15]
        });
        marker.setIcon(customIcon);
      }

      if (!t || !t.detections) return;

      const fovScale = 0.0006; // ~60m scale area around camera position

      t.detections.forEach((det: any, idx: number) => {
        const trackId = det.track_id != null ? det.track_id : idx;
        const key = `${cam.id}_${trackId}_${det.class}`;
        activeKeys.add(key);

        const cx = (det.bbox.x1 + det.bbox.x2) / 2;
        const cy = det.bbox.y2; // Bottom center of bounding box (road surface contact)

        const heading = camHeadings[cam.id] ?? (cam.heading != null ? cam.heading : 0);
        const angleRad = (heading * Math.PI) / 180;

        const fovScale = 0.0006; // ~60m coverage distance
        const distForward = (1.0 - cy) * fovScale;
        const distLateral = (cx - 0.5) * fovScale * 1.3;

        const dLat = distForward * Math.cos(angleRad) - distLateral * Math.sin(angleRad);
        const dLng = distForward * Math.sin(angleRad) + distLateral * Math.cos(angleRad);

        const objLat = cam.lat + dLat;
        const objLng = cam.lng + dLng;

        const cls = (det.class || "").toLowerCase();
        const isPerson = cls.includes("person") || cls.includes("pedestrian") || cls.includes("human");
        const isBike = cls.includes("motor") || cls.includes("bike") || cls.includes("cycle");
        const isBus = cls.includes("bus") || cls.includes("truck") || cls.includes("van");

        const iconSymbol = isPerson ? "👤" : isBike ? "🏍️" : isBus ? "🚌" : "🚗";
        const borderColor = isPerson ? "#818cf8" : isBike ? "#f59e0b" : isBus ? "#a855f7" : "#06b6d4";
        const labelColor = isPerson ? "#c7d2fe" : isBike ? "#fde68a" : isBus ? "#e9d5ff" : "#cffafe";
        
        const classNameUpper = cls ? cls.toUpperCase() : "OBJ";
        const trackIdText = det.track_id != null ? `#${det.track_id}` : "";
        const confPercent = det.confidence != null ? `${Math.round(det.confidence * 100)}%` : "";
        const speedText = det.speed ? ` ${Math.round(det.speed)}km/h` : "";

        const html = `
          <div style="
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: rgba(10, 15, 30, 0.94);
            backdrop-filter: blur(6px);
            border: 1.5px solid ${borderColor};
            box-shadow: 0 0 12px ${borderColor}aa;
            padding: 3px 8px;
            border-radius: 14px;
            font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
            font-size: 10px;
            font-weight: 800;
            color: #ffffff;
            white-space: nowrap;
            letter-spacing: 0.02em;
            transition: all 0.35s cubic-bezier(0.25, 1, 0.5, 1);
            transform: translate(-50%, -50%);
          ">
            <span style="font-size: 11px;">${iconSymbol}</span>
            <span style="color: ${labelColor}; text-transform: uppercase;">${classNameUpper} ${trackIdText}</span>
            ${confPercent ? `<span style="color: #94a3b8; font-size: 9px; font-weight: 600;">${confPercent}</span>` : ''}
            ${speedText ? `<span style="color: #fbbf24; font-size: 9px; font-weight: 700;">${speedText}</span>` : ''}
          </div>
        `;

        const now = Date.now();
        const existingMarker = detMarkersRef.current.get(key);
        if (existingMarker) {
          existingMarker.setLatLng([objLat, objLng]);
          existingMarker.lastSeen = now;
          const customIcon = L.divIcon({
            html,
            className: "live-moving-object-icon",
            iconSize: [100, 26],
            iconAnchor: [50, 13]
          });
          existingMarker.setIcon(customIcon);
        } else {
          const customIcon = L.divIcon({
            html,
            className: "live-moving-object-icon",
            iconSize: [100, 26],
            iconAnchor: [50, 13]
          });
          const marker = L.marker([objLat, objLng], { icon: customIcon }).addTo(map);
          marker.lastSeen = now;
          detMarkersRef.current.set(key, marker);
        }
      });
    });

    // Clean up stale markers only if missing for more than 1.5 seconds (1500ms)
    // Prevents transient zero-drops or single-frame inference skips from flickering markers
    const now = Date.now();
    detMarkersRef.current.forEach((marker, key) => {
      const lastSeen = marker.lastSeen || 0;
      if (!activeKeys.has(key) && (now - lastSeen > 1500)) {
        try { map.removeLayer(marker); } catch { /* ignore */ }
        detMarkersRef.current.delete(key);
      }
    });
  }, [telemetryMap, gisPlacedCameras, camHeadings]);

  const handleSaveManualCoords = async () => {
    if (!selectedGisCamId) return;
    const latNum = parseFloat(manualLat);
    const lngNum = parseFloat(manualLng);
    if (isNaN(latNum) || isNaN(lngNum)) return;

    const sb = await getSupabase();
    await sb
      .from("cameras")
      .update({ lat: latNum, lng: lngNum })
      .eq("id", selectedGisCamId);
  };

  const handleRemoveFromGisMap = async (camId: string) => {
    const sb = await getSupabase();
    await sb
      .from("cameras")
      .update({ lat: null, lng: null })
      .eq("id", camId);
    if (selectedGisCamId === camId) {
      setSelectedGisCamId(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-80px)] gap-6">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {viewMode === "3d" ? "3D Twin Cameras" : "GIS Placed Cameras"}
          </h3>
          <span className="text-[10px] font-semibold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
            {camerasWithStatus.length} Cams
          </span>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
          {camerasWithStatus.map((c: any) => {
            const isSynced = spatialConfigs[c.id]?.spatial_sync ?? true;
            const slot = spatialConfigs[c.id]?.slot || "north";

            return (
              <div
                key={c.id}
                onClick={() => {
                  setSelectedGisCamId(c.id);
                  if (c.lat != null) setManualLat(c.lat.toString());
                  if (c.lng != null) setManualLng(c.lng.toString());
                  if (leafletMapRef.current && c.lat != null && c.lng != null) {
                    leafletMapRef.current.setView([c.lat, c.lng], 15);
                  }
                }}
                className={clsx(
                  "w-full text-left rounded-lg p-2 text-xs transition flex flex-col gap-1.5 border cursor-pointer",
                  selectedGisCamId === c.id
                    ? "bg-accent/15 border-accent/40 text-accent font-medium shadow-sm"
                    : "bg-surface-2/60 border-line/50 text-zinc-400 hover:bg-surface-2 hover:text-zinc-200"
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={clsx(
                      "inline-block h-2 w-2 rounded-full shrink-0",
                      c.status === "online" ? "bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-rose-400"
                    )} />
                    <span className="truncate font-semibold text-zinc-200 text-xs">{c.name}</span>
                  </div>

                  {/* 3D Spatial Sync Toggle */}
                  <button
                    type="button"
                    title={isSynced ? "3D Spatial Sync is ON (Detections fused in 3D)" : "3D Spatial Sync is OFF (Standby)"}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateSpatialConfig(c.id, { spatial_sync: !isSynced });
                    }}
                    className={clsx(
                      "text-[9px] font-bold px-2 py-0.5 rounded border transition flex items-center gap-1",
                      isSynced
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]"
                        : "bg-zinc-800/80 text-zinc-500 border-zinc-700 hover:text-zinc-300"
                    )}
                  >
                    <span className={clsx("h-1.5 w-1.5 rounded-full", isSynced ? "bg-emerald-400 animate-pulse" : "bg-zinc-600")} />
                    {isSynced ? "3D SYNC ON" : "3D OFF"}
                  </button>
                </div>

                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span className="capitalize font-mono text-zinc-400">Slot: {slot.toUpperCase()}</span>
                  {c.status === "online" && (
                    <span className="text-cyan-400 font-bold">
                      🚗 {telemetryMap[c.id]?.vehicles ?? 0} &nbsp;👤 {telemetryMap[c.id]?.people ?? 0}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {camerasWithStatus.length === 0 && (
            <div className="text-[11px] text-zinc-500 italic p-2 text-center">No cameras registered.</div>
          )}
        </div>

        {viewMode === "2d" && isManager && gisUnplacedCameras.length > 0 && (
          <div className="border-t border-line/60 pt-3 space-y-2 mt-auto">
            <h4 className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Place GIS Camera</h4>
            <select
              className="w-full bg-zinc-900 border border-line rounded px-2 py-1 text-xs text-zinc-200"
              value={selectedUnplacedGisCamId}
              onChange={(e) => setSelectedUnplacedGisCamId(e.target.value)}
            >
              {gisUnplacedCameras.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-[9px] text-zinc-500 leading-normal">
              Select camera and click on 2D map to place pin.
            </p>
          </div>
        )}
      </div>

      {/* Main Map / 3D Board */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Header with 3D vs 2D Toggle Switch */}
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-1 px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("3d")}
              className={clsx(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition",
                viewMode === "3d"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.2)]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-2"
              )}
            >
              <Box size={15} className={viewMode === "3d" ? "text-cyan-400 animate-pulse" : ""} />
              <span>3D Digital Twin (Three.js)</span>
            </button>
            <button
              onClick={() => setViewMode("2d")}
              className={clsx(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition",
                viewMode === "2d"
                  ? "bg-accent/20 text-accent border border-accent/40 shadow-[0_0_12px_rgba(59,130,246,0.2)]"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-2"
              )}
            >
              <MapIcon size={15} />
              <span>2D GIS Map (Leaflet)</span>
            </button>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            {viewMode === "3d" ? (
              <span className="flex items-center gap-1.5 text-cyan-400/90 font-medium">
                <Sparkles size={13} />
                Real-Time Multi-Camera 3D Intersection Fusion
              </span>
            ) : (
              <span className="text-zinc-500 italic">
                {isManager ? "⚙️ Manage Mode: Drag pins or click map to place" : "👁️ Viewer Mode: Inspect status and feeds"}
              </span>
            )}
          </div>
        </div>

        {/* Canvas & Inspector Grid */}
        <div className={clsx(
          "flex-1 min-h-0",
          viewMode === "3d" ? "flex flex-col h-full w-full" : "grid grid-cols-1 xl:grid-cols-4 gap-4"
        )}>
          {/* Main Visualizer Area */}
          <div className={clsx(
            "rounded-lg border border-line bg-zinc-950 relative min-h-[520px] h-full w-full overflow-hidden",
            viewMode === "2d" && "xl:col-span-3"
          )}>
            {viewMode === "3d" ? (
              <ErrorBoundary fallbackTitle="3D Digital Twin View">
                <DigitalTwin3DView
                  cameras={camerasWithStatus}
                  telemetryMap={telemetryMap}
                  spatialConfigs={spatialConfigs}
                  onUpdateSpatialConfig={updateSpatialConfig}
                  selectedCameraId={selectedGisCamId}
                  onSelectCamera={setSelectedGisCamId}
                />
              </ErrorBoundary>
            ) : (
              <div ref={gisMapRef} className="absolute inset-0 rounded-lg overflow-hidden z-0 h-full w-full" />
            )}
          </div>

          {/* Right Inspector Panel (Shown in 2D GIS mode) */}
          {viewMode === "2d" && (
            <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-1 p-4 justify-start overflow-y-auto max-h-[calc(100vh-160px)]">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                GIS Inspector
              </h4>

            {activeGisCamera ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-surface-2 p-3 border border-line/60">
                  <div className="text-xs font-semibold text-zinc-200 truncate">{activeGisCamera.name}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={clsx(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                      activeGisCamera.status === "online"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    )}>
                      <span className={clsx("h-1 w-1 rounded-full", activeGisCamera.status === "online" ? "bg-emerald-400" : "bg-rose-400")} />
                      {activeGisCamera.status === "online" ? "Online" : "Offline"}
                    </span>
                    <button
                      className="text-[10px] text-accent hover:underline font-semibold"
                      onClick={() => onSelectCamera(activeGisCamera.id)}
                    >
                      Open Live Feed
                    </button>
                  </div>
                </div>

                {activeGisCamera.status === "online" && (
                  <div className="rounded-lg overflow-hidden border border-line bg-black aspect-video relative">
                    <CleanStreamImg
                      cameraId={activeGisCamera.id}
                      name={activeGisCamera.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* 3D Spatial Integration Controls */}
                <div className="rounded-lg bg-surface-2 p-3 border border-cyan-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Box size={14} className="text-cyan-400" />
                        3D Spatial Fusion
                      </div>
                      <p className="text-[10px] text-zinc-400 mt-0.5">
                        Integrate camera into 3D twin
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const cur = spatialConfigs[activeGisCamera.id]?.spatial_sync ?? true;
                        updateSpatialConfig(activeGisCamera.id, { spatial_sync: !cur });
                      }}
                      className={clsx(
                        "px-3 py-1 rounded-md text-xs font-bold border transition shadow-sm",
                        (spatialConfigs[activeGisCamera.id]?.spatial_sync ?? true)
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200"
                      )}
                    >
                      {(spatialConfigs[activeGisCamera.id]?.spatial_sync ?? true) ? "ENABLED" : "DISABLED"}
                    </button>
                  </div>

                  {/* Slot selector around 4 sides */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      Intersection 3D Slot (4 Sides)
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {[
                        { id: "south", label: "Corner 1 (SE Live Cam)" },
                        { id: "north", label: "Corner 2 (NW Chicago St)" },
                        { id: "east", label: "Corner 3 (NE Downtown Park)" },
                        { id: "west", label: "Corner 4 (SW Clock Plaza)" },
                      ].map((slot) => {
                        const currentSlot = spatialConfigs[activeGisCamera.id]?.slot || "south";
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => {
                              const headingMap: Record<string, number> = { south: 320, north: 140, east: 230, west: 50 };
                              updateSpatialConfig(activeGisCamera.id, {
                                slot: slot.id as CameraSlot,
                                heading: headingMap[slot.id] || 0,
                              });
                            }}
                            className={clsx(
                              "px-2 py-1.5 rounded text-[10px] font-semibold border transition text-left truncate",
                              currentSlot === slot.id
                                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 shadow-sm"
                                : "bg-zinc-900/80 border-line/40 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                            )}
                          >
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Direction Heading Angle slider */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-zinc-400 uppercase">Compass Heading</span>
                      <span className="font-mono font-bold text-cyan-400">
                        {spatialConfigs[activeGisCamera.id]?.heading ?? 180}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      step="5"
                      value={spatialConfigs[activeGisCamera.id]?.heading ?? 180}
                      onChange={(e) => {
                        updateSpatialConfig(activeGisCamera.id, {
                          heading: parseInt(e.target.value, 10),
                        });
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  {/* Mount Height slider (meters) */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-zinc-400 uppercase">Mount Height</span>
                      <span className="font-mono font-bold text-cyan-400">
                        {(spatialConfigs[activeGisCamera.id]?.height ?? 8).toFixed(1)}m
                      </span>
                    </div>
                    <input
                      type="range"
                      min="3"
                      max="25"
                      step="0.5"
                      value={spatialConfigs[activeGisCamera.id]?.height ?? 8}
                      onChange={(e) => {
                        updateSpatialConfig(activeGisCamera.id, {
                          height: parseFloat(e.target.value),
                        });
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  {/* Camera Tilt / Pitch slider */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-zinc-400 uppercase">Tilt Angle (Pitch Down)</span>
                      <span className="font-mono font-bold text-cyan-400">
                        {spatialConfigs[activeGisCamera.id]?.pitch ?? 35}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="80"
                      step="2"
                      value={spatialConfigs[activeGisCamera.id]?.pitch ?? 35}
                      onChange={(e) => {
                        updateSpatialConfig(activeGisCamera.id, {
                          pitch: parseInt(e.target.value, 10),
                        });
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>

                  {/* Field of View (FOV) slider */}
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-zinc-400 uppercase">Field of View (FOV)</span>
                      <span className="font-mono font-bold text-cyan-400">
                        {spatialConfigs[activeGisCamera.id]?.fov ?? 65}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="90"
                      step="2"
                      value={spatialConfigs[activeGisCamera.id]?.fov ?? 65}
                      onChange={(e) => {
                        updateSpatialConfig(activeGisCamera.id, {
                          fov: parseInt(e.target.value, 10),
                        });
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
                    />
                  </div>
                </div>

                {/* Real-time Telemetry Stats Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded bg-surface-2 p-2 border border-line/40 flex items-center gap-2">
                    <Car size={14} className="text-cyan-400" />
                    <div>
                      <div className="text-[9px] text-zinc-400 uppercase font-semibold">Vehicles</div>
                      <div className="text-xs font-bold text-zinc-100">{selectedTelemetry?.vehicles ?? 0}</div>
                    </div>
                  </div>
                  <div className="rounded bg-surface-2 p-2 border border-line/40 flex items-center gap-2">
                    <Users size={14} className="text-indigo-400" />
                    <div>
                      <div className="text-[9px] text-zinc-400 uppercase font-semibold">People</div>
                      <div className="text-xs font-bold text-zinc-100">{selectedTelemetry?.people ?? 0}</div>
                    </div>
                  </div>
                  <div className="rounded bg-surface-2 p-2 border border-line/40 flex items-center gap-2">
                    <Activity size={14} className="text-emerald-400" />
                    <div>
                      <div className="text-[9px] text-zinc-400 uppercase font-semibold">AI FPS</div>
                      <div className="text-xs font-bold text-zinc-100">
                        {(selectedTelemetry?.fps || selectedTelemetry?.decode_fps || selectedTelemetry?.camera_fps)
                          ? (selectedTelemetry?.fps || selectedTelemetry?.decode_fps || selectedTelemetry?.camera_fps)!.toFixed(1)
                          : "--"}
                      </div>
                    </div>
                  </div>
                  <div className="rounded bg-surface-2 p-2 border border-line/40 flex items-center gap-2">
                    <Eye size={14} className="text-amber-400" />
                    <div>
                      <div className="text-[9px] text-zinc-400 uppercase font-semibold">Detections</div>
                      <div className="text-xs font-bold text-zinc-100">{selectedTelemetry?.detections?.length ?? 0}</div>
                    </div>
                  </div>
                </div>

                {viewMode === "2d" && (
                  <div className="space-y-3 pt-2 border-t border-line/60">
                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">
                        Latitude
                      </label>
                      <input
                        type="text"
                        className="w-full bg-zinc-900 border border-line rounded px-2 py-1 text-xs text-zinc-200 font-mono"
                        value={manualLat}
                        disabled={!isManager}
                        onChange={(e) => setManualLat(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-[9px] font-bold text-zinc-500 uppercase block mb-1">
                        Longitude
                      </label>
                      <input
                        type="text"
                        className="w-full bg-zinc-900 border border-line rounded px-2 py-1 text-xs text-zinc-200 font-mono"
                        value={manualLng}
                        disabled={!isManager}
                        onChange={(e) => setManualLng(e.target.value)}
                      />
                    </div>

                    {isManager && (
                      <div className="space-y-1.5 pt-2 border-t border-line/60">
                        <button
                          onClick={handleSaveManualCoords}
                          className="w-full bg-accent text-white rounded py-1.5 text-xs font-semibold hover:bg-accent/80 transition"
                        >
                          Save Coordinates
                        </button>
                        <button
                          onClick={() => handleRemoveFromGisMap(activeGisCamera.id)}
                          className="w-full bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded py-1.5 text-xs font-semibold hover:bg-rose-500/20 transition"
                        >
                          Remove from Map
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded border border-dashed border-line p-4 text-center text-zinc-500 text-xs leading-normal">
                Select a camera from the sidebar list or 3D scene to configure spatial fusion, inspect feeds, and calibrate angles.
              </div>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
