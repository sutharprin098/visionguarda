import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { PageHeader, Badge } from "../../components/ui";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export default function GisPage() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => (await supabase.from("sites").select("id, name, kind")).data ?? [],
  });
  const { data: layers } = useQuery({
    queryKey: ["gis-layers"],
    queryFn: async () => (await supabase.from("gis_layers").select("*")).data ?? [],
  });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [72.5714, 23.0225],
      zoom: 11,
      attributionControl: false,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), "top-right");
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="GIS Dashboard"
        subtitle="Sites, zones, ROI and speed limits. Layers are assigned per user."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div ref={containerRef} className="card h-[540px] overflow-hidden" />
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Sites</h3>
            <div className="mt-2 space-y-1.5">
              {!sites?.length && <p className="text-sm text-zinc-500">No sites yet.</p>}
              {sites?.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-200">{s.name}</span>
                  <Badge>{s.kind}</Badge>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Layers</h3>
            <div className="mt-2 space-y-1.5">
              {!layers?.length && <p className="text-sm text-zinc-500">No layers yet.</p>}
              {layers?.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-200">{l.name}</span>
                  <Badge tone={l.kind === "restricted_area" ? "danger" : l.kind === "speed_zone" ? "warn" : "default"}>
                    {l.kind.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
