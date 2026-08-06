import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Map as MapIcon, Video } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, Field } from "../../components/ui";
import clsx from "clsx";

// Lazy-load Leaflet dynamic script & styles to avoid loading on initial page render
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

export default function MapsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const isManager = can("maps.manage");

  const gisMapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const [selectedGisCamId, setSelectedGisCamId] = useState<string | null>(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [selectedUnplacedGisCamId, setSelectedUnplacedGisCamId] = useState("");

  // Fetch all cameras to find placed/unplaced ones
  const { data: allCameras = [], refetch } = useQuery<any[]>({
    queryKey: ["cameras-brief"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cameras")
        .select("id, name, status, lat, lng, heading_deg, is_enabled")
        .eq("is_enabled", true)
        .order("name");
      return data ?? [];
    },
  });

  const gisPlacedCameras = allCameras.filter(c => c.lat != null && c.lng != null);
  const gisUnplacedCameras = allCameras.filter(c => c.lat == null || c.lng == null);

  // Set default unplaced camera selection
  useEffect(() => {
    if (gisUnplacedCameras.length > 0 && !selectedUnplacedGisCamId) {
      setSelectedUnplacedGisCamId(gisUnplacedCameras[0].id);
    } else if (gisUnplacedCameras.length === 0) {
      setSelectedUnplacedGisCamId("");
    }
  }, [gisUnplacedCameras, selectedUnplacedGisCamId]);

  // Auto-select placed camera if none selected
  useEffect(() => {
    if (gisPlacedCameras.length > 0 && !selectedGisCamId) {
      setSelectedGisCamId(gisPlacedCameras[0].id);
      setManualLat(gisPlacedCameras[0].lat?.toString() || "");
      setManualLng(gisPlacedCameras[0].lng?.toString() || "");
    }
  }, [gisPlacedCameras, selectedGisCamId]);

  const activeGisCamera = allCameras.find(c => c.id === selectedGisCamId);

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

  // Initialize and update GIS Leaflet Map
  useEffect(() => {
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
        : [28.6139, 77.2090]; // Default Smart City Center: New Delhi

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

      // Add markers
      gisPlacedCameras.forEach(cam => {
        const isOnline = cam.status === "online";
        const statusColor = isOnline ? "#10b981" : "#ef4444";
        const iconHtml = `
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
            <span style="color: #ffffff; font-weight: 700;">${cam.name}</span>
            <span style="background: ${isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${isOnline ? '#34d399' : '#f87171'}; padding: 1px 6px; border-radius: 12px; font-size: 10px;">${isOnline ? 'Online' : 'Offline'}</span>
          </div>
        `;
        
        const customIcon = L.divIcon({
          html: iconHtml,
          className: "custom-leaflet-badge-icon",
          iconSize: [140, 30],
          iconAnchor: [70, 15]
        });

        const marker = L.marker([cam.lat, cam.lng], {
          draggable: isManager,
          icon: customIcon
        }).addTo(map);

        marker.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; color: #1f2937; min-width: 150px; padding: 4px;">
            <strong style="font-size: 13px;">${cam.name}</strong>
            <div style="margin-top: 4px; display: flex; align-items: center; gap: 4px;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: ${cam.status === 'online' ? '#10b981' : '#ef4444'}"></span>
              <span style="text-transform: capitalize; color: #4b5563;">${cam.status}</span>
            </div>
            <div style="margin-top: 8px; font-size: 10px; color: #6b7280;">Coords: ${cam.lat.toFixed(6)}, ${cam.lng.toFixed(6)}</div>
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
            const { error: updateError } = await supabase
              .from("cameras")
              .update({ lat: latLng.lat, lng: latLng.lng })
              .eq("id", cam.id);

            if (updateError) {
              console.error(updateError.message);
            } else {
              audit("cameras.update_gis", "cameras", cam.id, { module: "maps", detail: { lat: latLng.lat, lng: latLng.lng } });
              refetch();
            }
          });
        }
      });

      // Handle map clicks for placing new cameras
      if (isManager && selectedUnplacedGisCamId) {
        map.on("click", async (e: any) => {
          const { lat, lng } = e.latlng;
          const { error: updateError } = await supabase
            .from("cameras")
            .update({ lat, lng })
            .eq("id", selectedUnplacedGisCamId);

          if (updateError) {
            console.error(updateError.message);
          } else {
            audit("cameras.place_gis", "cameras", selectedUnplacedGisCamId, { module: "maps", detail: { lat, lng } });
            setSelectedUnplacedGisCamId("");
            refetch();
          }
        });
      }
    });

    return () => {
      active = false;
    };
  }, [allCameras, isManager, selectedUnplacedGisCamId]);

  // Handle manual coordinates submission
  const handleSaveManualCoords = async () => {
    if (!selectedGisCamId) return;
    const latNum = parseFloat(manualLat);
    const lngNum = parseFloat(manualLng);
    if (isNaN(latNum) || isNaN(lngNum)) return;

    const { error: updateError } = await supabase
      .from("cameras")
      .update({ lat: latNum, lng: lngNum })
      .eq("id", selectedGisCamId);

    if (updateError) {
      console.error(updateError.message);
    } else {
      audit("cameras.update_gis", "cameras", selectedGisCamId, { module: "maps", detail: { lat: latNum, lng: lngNum } });
      refetch();
    }
  };

  // Remove camera from GIS map
  const handleRemoveFromGisMap = async (camId: string) => {
    const { error: updateError } = await supabase
      .from("cameras")
      .update({ lat: null, lng: null })
      .eq("id", camId);

    if (updateError) {
      console.error(updateError.message);
    } else {
      audit("cameras.remove_gis", "cameras", camId, { module: "maps" });
      if (selectedGisCamId === camId) {
        setSelectedGisCamId(null);
      }
      refetch();
    }
  };

  const mjpegStreamUrl = (camId: string) => {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    return `${baseUrl}/functions/v1/desktop-sync?mjpeg=true&camera_id=${camId}`;
  };

  return (
    <>
      <PageHeader
        title="Map"
        subtitle="Geospatial camera placement, live feeds, and real-time status overview."
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar - Camera List & Placement */}
        <div className="card space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 px-1">GIS Placed Cameras</h3>
          <div className="space-y-1">
            {gisPlacedCameras.map(c => (
              <div
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
                  "flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold cursor-pointer transition-all duration-150 border",
                  selectedGisCamId === c.id
                    ? "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink-1 border-transparent"
                )}
              >
                <span className="truncate mr-2">{c.name}</span>
                <span className={clsx(
                  "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                  c.status === "online" ? "bg-emerald-500" : "bg-rose-500"
                )} />
              </div>
            ))}
            {gisPlacedCameras.length === 0 && (
              <div className="text-xs text-ink-3 italic p-2 text-center">No cameras placed on map.</div>
            )}
          </div>

          {/* Place unplaced camera */}
          {isManager && gisUnplacedCameras.length > 0 && (
            <div className="border-t border-line/60 pt-4 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 px-1">Place Camera</h3>
              <select
                className="input text-xs"
                value={selectedUnplacedGisCamId}
                onChange={(e) => setSelectedUnplacedGisCamId(e.target.value)}
              >
                {gisUnplacedCameras.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink-3 leading-relaxed px-1">
                Select a camera and click anywhere on the map to set its coordinates.
              </p>
            </div>
          )}
        </div>

        {/* Map Display & Inspector */}
        <div className="lg:col-span-3 grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 card p-0 overflow-hidden border border-line relative min-h-[550px] h-[600px] w-full">
            <div ref={gisMapRef} className="absolute inset-0 z-0 h-full w-full bg-surface-2" />
          </div>

          {/* Camera Inspector Sidebar */}
          <div className="card space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-3 px-1">Camera Inspector</h3>
            
            {activeGisCamera ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-surface-2 p-3.5 border border-line/45">
                  <div className="text-xs font-bold text-ink-1 truncate">{activeGisCamera.name}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge tone={activeGisCamera.status === "online" ? "ok" : "default"} pulse={activeGisCamera.status === "online"}>
                      {activeGisCamera.status}
                    </Badge>
                  </div>
                </div>

                {activeGisCamera.status === "online" && (
                  <div className="rounded-xl overflow-hidden border border-line bg-black aspect-video relative">
                    <img
                      src={mjpegStreamUrl(activeGisCamera.id)}
                      alt={activeGisCamera.name}
                      className="w-full h-full object-cover"
                      key={activeGisCamera.id}
                    />
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  <Field label="Latitude">
                    <input
                      type="text"
                      className="input font-mono text-xs"
                      value={manualLat}
                      disabled={!isManager}
                      onChange={(e) => setManualLat(e.target.value)}
                    />
                  </Field>

                  <Field label="Longitude">
                    <input
                      type="text"
                      className="input font-mono text-xs"
                      value={manualLng}
                      disabled={!isManager}
                      onChange={(e) => setManualLng(e.target.value)}
                    />
                  </Field>

                  {isManager && (
                    <div className="flex gap-2 pt-2">
                      <button
                        className="btn-primary btn-sm flex-1 text-xs"
                        onClick={handleSaveManualCoords}
                      >
                        Save
                      </button>
                      <button
                        className="btn-danger btn-sm text-xs"
                        onClick={() => handleRemoveFromGisMap(activeGisCamera.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-ink-3 italic p-4 border border-dashed border-line rounded-xl text-center">
                Select a camera node pin on the map to inspect status and stream live feed.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
