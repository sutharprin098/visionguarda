import { useState, useEffect, useRef } from "react";
import { Map as MapIcon, Car, Users, Activity, Eye } from "lucide-react";
import { getSupabase } from "../lib/session";
import type { SyncBundle } from "../lib/sync";
import { mjpegStreamUrl, getEngineAppStatus, type EngineAppStatus } from "../lib/localEngine";
import { TelemetrySession, type CameraTelemetry } from "../lib/telemetry";
import clsx from "clsx";

interface FloorPlanViewProps {
  bundle: SyncBundle;
  healthInfo?: any;
  onSelectCamera: (cameraId: string) => void;
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

  const gisMapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const [selectedGisCamId, setSelectedGisCamId] = useState<string | null>(null);
  const [selectedUnplacedGisCamId, setSelectedUnplacedGisCamId] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [appStatus, setAppStatus] = useState<EngineAppStatus | null>(null);
  const [telemetryMap, setTelemetryMap] = useState<Record<string, CameraTelemetry>>({});
  const markersRef = useRef<Map<string, any>>(new Map());
  const detMarkersRef = useRef<Map<string, any>>(new Map());

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

  // Merge real-time engine health status with bundle cameras
  const camerasWithStatus = bundle.cameras.map((c: any) => {
    const localInfo = appStatus?.cameras?.[c.id] || healthInfo?.cameras?.[c.id];
    // If local engine is running or status is online, treat as online
    const isOnline = localInfo ? localInfo.running : (c.status === "online" || appStatus !== null);
    return {
      ...c,
      status: isOnline ? "online" : "offline"
    };
  });

  const gisPlacedCameras = camerasWithStatus.filter((c: any) => c.lat != null && c.lng != null);
  const gisUnplacedCameras = camerasWithStatus.filter((c: any) => c.lat == null || c.lng == null);

  // Auto-select first placed GIS camera if none selected
  useEffect(() => {
    if (gisPlacedCameras.length > 0 && !selectedGisCamId) {
      setSelectedGisCamId(gisPlacedCameras[0].id);
      setManualLat(gisPlacedCameras[0].lat?.toString() || "");
      setManualLng(gisPlacedCameras[0].lng?.toString() || "");
    }
  }, [gisPlacedCameras, selectedGisCamId]);

  // Subscribe to real-time telemetry for all placed cameras
  useEffect(() => {
    const sessions: TelemetrySession[] = [];
    gisPlacedCameras.forEach((cam: any) => {
      const session = new TelemetrySession(cam.id, (t) => {
        setTelemetryMap((prev) => ({ ...prev, [cam.id]: t }));
      });
      session.start();
      sessions.push(session);
    });
    return () => {
      sessions.forEach((s) => s.stop());
    };
  }, [gisPlacedCameras.map((c: any) => c.id).join(",")]);

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
                <div>⚡ FPS: <strong>${t?.fps ? t.fps.toFixed(1) : '--'}</strong></div>
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
        const cy = det.bbox.y2; // Bottom center of bounding box

        const objLat = cam.lat + (0.5 - cy) * fovScale;
        const objLng = cam.lng + (cx - 0.5) * (fovScale * 1.3);

        const cls = (det.class || "").toLowerCase();
        const isPerson = cls.includes("person") || cls.includes("pedestrian") || cls.includes("human");
        const isBike = cls.includes("motor") || cls.includes("bike") || cls.includes("cycle");
        const iconSymbol = isPerson ? "👤" : isBike ? "🏍️" : "🚗";
        const borderColor = isPerson ? "#818cf8" : isBike ? "#f59e0b" : "#22d3ee";
        const labelColor = isPerson ? "#c7d2fe" : isBike ? "#fde68a" : "#a5f3fc";
        const speedText = det.speed ? ` ${Math.round(det.speed)}km/h` : "";

        const html = `
          <div style="
            display: inline-flex;
            align-items: center;
            gap: 3px;
            background: rgba(10, 15, 30, 0.92);
            backdrop-filter: blur(4px);
            border: 1px solid ${borderColor};
            box-shadow: 0 0 10px ${borderColor}80;
            padding: 2px 6px;
            border-radius: 12px;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 10px;
            font-weight: 700;
            color: #ffffff;
            white-space: nowrap;
            transition: all 0.3s ease-out;
          ">
            <span>${iconSymbol}</span>
            <span style="color: ${labelColor}">${det.track_id ? `#${det.track_id}` : cls}</span>
            ${speedText ? `<span style="color: #fbbf24; font-size: 9px;">${speedText}</span>` : ''}
          </div>
        `;

        const existingMarker = detMarkersRef.current.get(key);
        if (existingMarker) {
          existingMarker.setLatLng([objLat, objLng]);
          const customIcon = L.divIcon({
            html,
            className: "live-moving-object-icon",
            iconSize: [80, 24],
            iconAnchor: [40, 12]
          });
          existingMarker.setIcon(customIcon);
        } else {
          const customIcon = L.divIcon({
            html,
            className: "live-moving-object-icon",
            iconSize: [80, 24],
            iconAnchor: [40, 12]
          });
          const marker = L.marker([objLat, objLng], { icon: customIcon }).addTo(map);
          detMarkersRef.current.set(key, marker);
        }
      });
    });

    // Remove stale detection markers
    detMarkersRef.current.forEach((marker, key) => {
      if (!activeKeys.has(key)) {
        try { map.removeLayer(marker); } catch { /* ignore */ }
        detMarkersRef.current.delete(key);
      }
    });
  }, [telemetryMap, gisPlacedCameras]);

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
      <div className="flex w-52 shrink-0 flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">GIS Placed Cameras</h3>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {gisPlacedCameras.map((c: any) => (
            <button
              key={c.id}
              onClick={() => {
                setSelectedGisCamId(c.id);
                setManualLat(c.lat.toString());
                setManualLng(c.lng.toString());
                if (leafletMapRef.current) {
                  leafletMapRef.current.setView([c.lat, c.lng], 15);
                }
              }}
              className={clsx(
                "w-full text-left rounded px-3 py-1.5 text-xs transition flex items-center justify-between",
                selectedGisCamId === c.id
                  ? "bg-accent/15 font-semibold text-accent"
                  : "text-zinc-400 hover:bg-surface-2 hover:text-zinc-200"
              )}
            >
              <span className="truncate mr-2">{c.name}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {c.status === "online" && (
                  <span className="text-[9px] font-bold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                    🚗 {telemetryMap[c.id]?.vehicles ?? 0}
                  </span>
                )}
                <span className={clsx(
                  "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                  c.status === "online" ? "bg-emerald-400" : "bg-rose-400"
                )} />
              </div>
            </button>
          ))}
          {gisPlacedCameras.length === 0 && (
            <div className="text-[11px] text-zinc-500 italic p-1 text-center">No GIS camera nodes.</div>
          )}
        </div>

        {isManager && gisUnplacedCameras.length > 0 && (
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
              Select a camera above and click on the map to place.
            </p>
          </div>
        )}
      </div>

      {/* Main Map Board */}
      <div className="flex-1 flex flex-col gap-4">
        {/* Map header */}
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-1 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <MapIcon size={16} className="text-accent animate-pulse" />
            <span className="text-sm font-semibold text-zinc-100">
              GIS Map (OpenStreetMap)
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 italic">
            {isManager ? "⚙️ Manage Mode: Drag pins or click map to place" : "👁️ Viewer Mode: Inspect status and feeds"}
          </span>
        </div>

        {/* Map Canvas Grid */}
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-4 gap-4 min-h-0">
          {/* GIS Map Display Area */}
          <div className="xl:col-span-3 rounded-lg border border-line bg-zinc-950 relative min-h-[500px] h-full w-full">
            <div ref={gisMapRef} className="absolute inset-0 rounded-lg overflow-hidden z-0 h-full w-full" />
          </div>

          {/* GIS Inspector */}
          <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-1 p-4 justify-start">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">GIS Inspector</h4>

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
                    <img
                      src={mjpegStreamUrl(activeGisCamera.id)}
                      alt={activeGisCamera.name}
                      className="w-full h-full object-cover"
                      key={activeGisCamera.id}
                    />
                  </div>
                )}

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
                      <div className="text-xs font-bold text-zinc-100">{selectedTelemetry?.fps ? selectedTelemetry.fps.toFixed(1) : "--"}</div>
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

                <div className="space-y-3">
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
              </div>
            ) : (
              <div className="rounded border border-dashed border-line p-4 text-center text-zinc-500 text-xs leading-normal">
                Select a camera marker on the GIS map or from the sidebar list to inspect status, edit coordinates, or view live feeds.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
