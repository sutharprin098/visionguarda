import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Check,
  Sparkles,
  Trash2,
  Layers,
  Car,
  Trees,
  Sliders,
  Info,
  ShieldAlert,
  Columns,
  AppWindow,
  Maximize2,
  Activity,
} from "lucide-react";
import clsx from "clsx";
import { mjpegStreamUrl } from "../lib/localEngine";
import type { SceneArchetype } from "../lib/autoSceneDetector";
import {
  type TwinCustomZone,
  type TwinZoneType,
  generateAiDefaultZones,
  saveCameraTwinZones,
} from "../lib/twinZoneManager";

export interface TwinZoneEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  camId: string;
  camName: string;
  archetype: SceneArchetype;
  initialZones: TwinCustomZone[];
  onSaveZones: (zones: TwinCustomZone[]) => void;
  onLiveChange?: (zones: TwinCustomZone[]) => void;
  layoutMode?: "split" | "floating" | "modal";
  onChangeLayoutMode?: (mode: "split" | "floating" | "modal") => void;
}

const ZONE_TYPE_META: Record<
  TwinZoneType,
  { label: string; icon: any; defaultColor: string; description: string }
> = {
  road: {
    label: "Road Corridor",
    icon: Car,
    defaultColor: "#06b6d4",
    description: "Asphalt lanes where vehicles travel. Vehicles strictly stay inside this polygon.",
  },
  green_area: {
    label: "Green Area / Grass",
    icon: Trees,
    defaultColor: "#10b981",
    description: "Roadside verges, medians, and parks. Vehicles will NEVER drive into these areas.",
  },
  signal_pole: {
    label: "Signal / Mast Pole",
    icon: Sliders,
    defaultColor: "#f43f5e",
    description: "CCTV mast poles and overhead traffic signal locations.",
  },
  stop_line: {
    label: "Stop Bar Line",
    icon: ShieldAlert,
    defaultColor: "#ffffff",
    description: "Painted stop bar line where vehicles stop at red signals.",
  },
};

export const TwinZoneEditorModal: React.FC<TwinZoneEditorModalProps> = ({
  isOpen,
  onClose,
  camId,
  camName,
  archetype,
  initialZones,
  onSaveZones,
  onLiveChange,
  layoutMode = "split",
  onChangeLayoutMode,
}) => {
  const [zones, setZones] = useState<TwinCustomZone[]>(initialZones);
  const [activeZoneType, setActiveZoneType] = useState<TwinZoneType>("road");
  const [currentDraftPoints, setCurrentDraftPoints] = useState<[number, number][]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<{ zoneId: string; ptIndex: number } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<"canvas" | "zones">("canvas");

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync initial zones when opened: Start clean with no pre-baked zones unless already saved!
  useEffect(() => {
    if (isOpen) {
      if (initialZones && initialZones.length > 0) {
        setZones(initialZones);
      } else {
        setZones([]);
        if (onLiveChange) onLiveChange([]);
      }
      setCurrentDraftPoints([]);
      setSelectedZoneId(null);
    }
  }, [isOpen, initialZones]);

  if (!isOpen) return null;

  // Helper to update zones and trigger live 3D sync
  const updateZonesAndSync = (
    newZonesOrFn: TwinCustomZone[] | ((prev: TwinCustomZone[]) => TwinCustomZone[])
  ) => {
    setZones((prev) => {
      const next = typeof newZonesOrFn === "function" ? newZonesOrFn(prev) : newZonesOrFn;
      if (onLiveChange) {
        onLiveChange(next);
      }
      return next;
    });
  };

  // Convert client mouse click coordinates to normalized [0..1, 0..1]
  const getNormalizedCoords = (e: React.MouseEvent<SVGSVGElement>): [number, number] | null => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    return [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000];
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingPoint) return;
    const pt = getNormalizedCoords(e);
    if (!pt) return;

    if (activeZoneType === "signal_pole") {
      const newZone: TwinCustomZone = {
        id: `zone-${Date.now()}`,
        type: "signal_pole",
        label: `Traffic Pole #${zones.filter((z) => z.type === "signal_pole").length + 1}`,
        points: [pt],
        color: ZONE_TYPE_META.signal_pole.defaultColor,
      };
      updateZonesAndSync((prev) => [...prev, newZone]);
      setSelectedZoneId(newZone.id);
      return;
    }

    if (activeZoneType === "stop_line") {
      if (currentDraftPoints.length === 0) {
        setCurrentDraftPoints([pt]);
      } else {
        const newZone: TwinCustomZone = {
          id: `zone-${Date.now()}`,
          type: "stop_line",
          label: `Stop Line #${zones.filter((z) => z.type === "stop_line").length + 1}`,
          points: [currentDraftPoints[0], pt],
          color: ZONE_TYPE_META.stop_line.defaultColor,
        };
        updateZonesAndSync((prev) => [...prev, newZone]);
        setCurrentDraftPoints([]);
        setSelectedZoneId(newZone.id);
      }
      return;
    }

    // Polygon drawing (Road or Green Area)
    if (currentDraftPoints.length >= 3) {
      const start = currentDraftPoints[0];
      const dist = Math.hypot(pt[0] - start[0], pt[1] - start[1]);
      if (dist < 0.035) {
        completeCurrentPolygon();
        return;
      }
    }

    setCurrentDraftPoints((prev) => [...prev, pt]);
  };

  const completeCurrentPolygon = () => {
    if (currentDraftPoints.length < 3) return;
    const typeMeta = ZONE_TYPE_META[activeZoneType];
    const newZone: TwinCustomZone = {
      id: `zone-${Date.now()}`,
      type: activeZoneType,
      label: `${typeMeta.label} #${zones.filter((z) => z.type === activeZoneType).length + 1}`,
      points: currentDraftPoints,
      color: typeMeta.defaultColor,
    };
    updateZonesAndSync((prev) => [...prev, newZone]);
    setCurrentDraftPoints([]);
    setSelectedZoneId(newZone.id);
  };

  const handlePointerDownHandle = (
    e: React.PointerEvent,
    zoneId: string,
    ptIndex: number
  ) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDraggingPoint({ zoneId, ptIndex });
    setSelectedZoneId(zoneId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingPoint) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const newPt: [number, number] = [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000];

    updateZonesAndSync((prev) =>
      prev.map((z) => {
        if (z.id !== draggingPoint.zoneId) return z;
        const pts = [...z.points];
        pts[draggingPoint.ptIndex] = newPt;
        return { ...z, points: pts };
      })
    );
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingPoint) {
      try {
        (e.target as Element).releasePointerCapture(e.pointerId);
      } catch {}
      setDraggingPoint(null);
      if (onLiveChange) onLiveChange(zones);
    }
  };

  const handleDeleteZone = (id: string) => {
    updateZonesAndSync((prev) => prev.filter((z) => z.id !== id));
    if (selectedZoneId === id) setSelectedZoneId(null);
  };

  const handleAiAutoGenerate = () => {
    const aiZones = generateAiDefaultZones(archetype);
    updateZonesAndSync(aiZones);
    setCurrentDraftPoints([]);
    if (aiZones.length > 0) setSelectedZoneId(aiZones[0].id);
  };

  const handleSaveAndApply = () => {
    saveCameraTwinZones(camId, zones);
    onSaveZones(zones);
    onClose();
  };

  // -------------------------------------------------------------
  // Content Components: Minimal, uncluttered UI
  // -------------------------------------------------------------
  const renderHeader = () => (
    <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-cyan-500/20 bg-zinc-900/90 gap-2 shrink-0">
      <div className="flex items-center gap-2 truncate">
        <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
          <Car className="w-4 h-4" />
        </div>
        <div className="truncate">
          <div className="flex items-center gap-1.5 truncate">
            <h2 className="text-xs font-bold text-white tracking-wide truncate">
              3D Road & Zone Drawer
            </h2>
            <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold text-emerald-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE 3D</span>
            </div>
          </div>
          <p className="text-[10px] text-zinc-400 truncate">
            {camName} • Click video to map roads & zones
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleSaveAndApply}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-black shadow-md transition"
          title="Save 3D Road Configuration"
        >
          <Check className="w-3.5 h-3.5" />
          <span>Save</span>
        </button>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
          title="Close Drawer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  const renderToolBar = () => (
    <div className="flex items-center justify-between px-3 py-2 border-b border-line bg-zinc-900/60 gap-2 shrink-0">
      <div className="inline-flex rounded-lg bg-zinc-950 p-0.5 border border-zinc-800">
        {[
          { type: "road", label: "Road", icon: Car, color: "#06b6d4" },
          { type: "green_area", label: "Grass", icon: Trees, color: "#10b981" },
          { type: "signal_pole", label: "Pole", icon: Sliders, color: "#f43f5e" },
          { type: "stop_line", label: "Stop Line", icon: ShieldAlert, color: "#ffffff" },
        ].map(({ type, label, icon: Icon, color }) => {
          const isActive = activeZoneType === type;
          return (
            <button
              key={type}
              onClick={() => {
                setActiveZoneType(type as TwinZoneType);
                setCurrentDraftPoints([]);
              }}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition",
                isActive
                  ? "bg-cyan-500/25 text-cyan-200 border border-cyan-500/40 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        {currentDraftPoints.length > 0 && (
          <button
            onClick={() => setCurrentDraftPoints((prev) => prev.slice(0, -1))}
            className="px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
            title="Undo last point"
          >
            Undo
          </button>
        )}
        <button
          onClick={() => {
            updateZonesAndSync([]);
            setCurrentDraftPoints([]);
          }}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition border border-transparent hover:border-rose-500/30"
          title="Clear all drawn zones"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );

  const renderCanvas = () => (
    <div
      ref={containerRef}
      className="flex-1 relative bg-black flex items-center justify-center select-none overflow-hidden min-h-[260px]"
    >
      {/* Live Camera Video Feed in Background */}
      <img
        src={mjpegStreamUrl(camId)}
        alt="Camera Feed"
        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
      />

      {/* Interactive SVG Overlay */}
      <svg
        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        onClick={handleSvgClick}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Existing Polygons & Lines */}
        {zones.map((zone) => {
          const isSelected = selectedZoneId === zone.id;
          const strokeColor = zone.color || "#06b6d4";

          if (zone.type === "signal_pole") {
            const pt = zone.points[0];
            if (!pt) return null;
            return (
              <g key={zone.id}>
                <circle
                  cx={pt[0] * 1000}
                  cy={pt[1] * 1000}
                  r={12}
                  fill="#ef4444"
                  stroke="#ffffff"
                  strokeWidth={3}
                  className="cursor-move"
                  onPointerDown={(e) => handlePointerDownHandle(e, zone.id, 0)}
                />
                <text
                  x={pt[0] * 1000 + 16}
                  y={pt[1] * 1000 + 5}
                  fill="#ffffff"
                  fontSize={16}
                  fontWeight="bold"
                  className="pointer-events-none drop-shadow"
                >
                  🚦 {zone.label}
                </text>
              </g>
            );
          }

          if (zone.type === "stop_line") {
            if (zone.points.length < 2) return null;
            const [p1, p2] = zone.points;
            return (
              <g key={zone.id}>
                <line
                  x1={p1[0] * 1000}
                  y1={p1[1] * 1000}
                  x2={p2[0] * 1000}
                  y2={p2[1] * 1000}
                  stroke="#ffffff"
                  strokeWidth={8}
                  strokeDasharray="14,10"
                />
                {zone.points.map((p, idx) => (
                  <circle
                    key={idx}
                    cx={p[0] * 1000}
                    cy={p[1] * 1000}
                    r={8}
                    fill="#ffffff"
                    stroke="#ef4444"
                    strokeWidth={2}
                    className="cursor-move"
                    onPointerDown={(e) => handlePointerDownHandle(e, zone.id, idx)}
                  />
                ))}
              </g>
            );
          }

          // Polygons (Road or Green Area)
          const ptsString = zone.points.map((p) => `${p[0] * 1000},${p[1] * 1000}`).join(" ");
          const fillColor =
            zone.type === "road" ? "rgba(6, 182, 212, 0.28)" : "rgba(16, 185, 129, 0.28)";

          return (
            <g key={zone.id}>
              <polygon
                points={ptsString}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isSelected ? 4 : 2}
                strokeDasharray={zone.type === "road" ? "8,4" : undefined}
                className="cursor-pointer transition"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedZoneId(zone.id);
                }}
              />
              {zone.points.map((p, idx) => (
                <circle
                  key={idx}
                  cx={p[0] * 1000}
                  cy={p[1] * 1000}
                  r={isSelected ? 9 : 6}
                  fill={strokeColor}
                  stroke="#ffffff"
                  strokeWidth={2}
                  className="cursor-move hover:scale-125 transition"
                  onPointerDown={(e) => handlePointerDownHandle(e, zone.id, idx)}
                />
              ))}
            </g>
          );
        })}

        {/* Current Drawing Draft */}
        {currentDraftPoints.length > 0 && (
          <g>
            {currentDraftPoints.length >= 2 && (
              <polyline
                points={currentDraftPoints.map((p) => `${p[0] * 1000},${p[1] * 1000}`).join(" ")}
                fill="none"
                stroke={ZONE_TYPE_META[activeZoneType].defaultColor}
                strokeWidth={3}
                strokeDasharray="6,4"
              />
            )}
            {currentDraftPoints.map((p, idx) => (
              <circle
                key={idx}
                cx={p[0] * 1000}
                cy={p[1] * 1000}
                r={idx === 0 ? 10 : 7}
                fill={idx === 0 ? "#10b981" : "#38bdf8"}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>

      {/* Floating Instructions Banner */}
      <div className="absolute bottom-3 left-3 z-20 pointer-events-none flex items-center gap-1.5 px-2.5 py-1 bg-zinc-950/90 backdrop-blur-md border border-cyan-500/30 rounded-lg text-[11px] text-zinc-300 shadow-xl">
        <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="truncate max-w-[340px]">
          {activeZoneType === "signal_pole"
            ? "Click on camera to place mast pole."
            : activeZoneType === "stop_line"
            ? "Click 2 points to draw stop line."
            : currentDraftPoints.length === 0
            ? "Click to start road polygon."
            : currentDraftPoints.length < 3
            ? `Adding corners (${currentDraftPoints.length})...`
            : "Click green dot or Finish button to close."}
        </span>
      </div>

      {/* Complete Polygon Floating Button */}
      {currentDraftPoints.length >= 3 && (
        <div className="absolute bottom-3 right-3 z-20 pointer-events-auto">
          <button
            onClick={completeCurrentPolygon}
            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl shadow-2xl transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Finish ({currentDraftPoints.length} pts)</span>
          </button>
        </div>
      )}
    </div>
  );

  const renderZoneList = () => (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
        <span>Drawn Zones ({zones.length})</span>
      </div>

      {zones.length === 0 ? (
        <div className="text-center py-5 text-xs text-zinc-500">
          <Layers className="w-5 h-5 mx-auto text-zinc-600 mb-1" />
          <p className="font-semibold text-zinc-400">No zones drawn yet</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Click "Road" above, then click on the video feed to draw your first 3D road.</p>
        </div>
      ) : (
        zones.map((zone) => {
          const isSelected = selectedZoneId === zone.id;
          const meta = ZONE_TYPE_META[zone.type];
          const Icon = meta.icon;

          return (
            <div
              key={zone.id}
              onClick={() => setSelectedZoneId(zone.id)}
              className={clsx(
                "flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition",
                isSelected
                  ? "bg-cyan-500/15 border-cyan-500/50 text-white shadow-md"
                  : "bg-zinc-950/60 border-line text-zinc-300 hover:bg-zinc-800/60"
              )}
            >
              <div className="flex items-center gap-2 truncate">
                <Icon
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: zone.color || meta.defaultColor }}
                />
                <div className="truncate">
                  <p className="font-semibold text-[11px] truncate">{zone.label}</p>
                  <p className="text-[9px] text-zinc-400">
                    {zone.points.length} {zone.points.length === 1 ? "pt" : "pts"} • {meta.label}
                  </p>
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteZone(zone.id);
                }}
                className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
                title="Delete zone"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })
      )}
    </div>
  );

  // -------------------------------------------------------------
  // Layout Modes
  // -------------------------------------------------------------
  if (layoutMode === "split") {
    return (
      <div className="relative h-full w-[460px] lg:w-[500px] xl:w-[560px] bg-zinc-950 border-r border-cyan-500/30 flex flex-col overflow-hidden text-zinc-100 shrink-0 z-20 shadow-2xl">
        {renderHeader()}
        {renderToolBar()}
        {renderCanvas()}
        {/* Bottom Drawer for mapped zones */}
        <div className="h-44 border-t border-line bg-zinc-900/90 flex flex-col shrink-0">
          {renderZoneList()}
        </div>
      </div>
    );
  }

  if (layoutMode === "floating") {
    return (
      <div className="absolute top-16 left-4 z-30 w-[540px] h-[540px] max-h-[calc(100%-80px)] bg-zinc-950/95 backdrop-blur-xl border border-cyan-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100 pointer-events-auto">
        {renderHeader()}
        {renderToolBar()}
        {renderCanvas()}
        <div className="h-36 border-t border-line bg-zinc-900/90 flex flex-col shrink-0">
          {renderZoneList()}
        </div>
      </div>
    );
  }

  // Full Modal mode
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200 pointer-events-auto">
      <div className="relative w-full max-w-6xl h-[90vh] bg-zinc-950 border border-line rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {renderHeader()}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            {renderToolBar()}
            {renderCanvas()}
          </div>
          <div className="w-80 border-l border-line bg-zinc-900/95 flex flex-col">
            {renderZoneList()}
            <div className="p-3 border-t border-line bg-zinc-950/60 text-[11px] text-zinc-400 space-y-1.5">
              <div className="flex justify-between items-center">
                <span>Road Polygons:</span>
                <span className="font-bold text-cyan-400">
                  {zones.filter((z) => z.type === "road").length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Green / Grass Verges:</span>
                <span className="font-bold text-emerald-400">
                  {zones.filter((z) => z.type === "green_area").length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span>Signal Poles & Stop Lines:</span>
                <span className="font-bold text-rose-400">
                  {zones.filter((z) => z.type === "signal_pole" || z.type === "stop_line").length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
