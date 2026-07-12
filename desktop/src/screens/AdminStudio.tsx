import { useEffect, useState, useRef } from "react";
import {
  Video,
  Play,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Plus,
  Compass,
  ArrowRight,
  Settings,
  Activity,
  Layers,
  Palette,
  AlertCircle,
  HelpCircle,
  ArrowLeftRight,
  Sparkles,
  ChevronRight,
  History,
  Send,
  Sliders,
  Eye,
  EyeOff,
  User,
  Shield,
  Trash
} from "lucide-react";
import clsx from "clsx";
import { getSupabase } from "../lib/session";
import { isEngineOnline, mjpegStreamUrl } from "../lib/localEngine";

interface Camera {
  id: string;
  name: string;
  source_type: string;
  status: string;
  zones?: string;
  lines?: string;
}

interface Drawing {
  id: string;
  org_id: string;
  camera_id: string;
  name: string;
  type: 'polygon' | 'rectangle' | 'circle' | 'free_draw' | 'polyline' | 'line' | 'arrow' | 'measurement';
  purpose: string;
  points: number[][]; // normalized 0..1
  properties: Record<string, any>;
  is_draft: boolean;
}

interface Rule {
  id: string;
  name: string;
  description?: string;
  camera_id?: string;
  trigger_type: string;
  trigger_source_id: string;
  conditions: Record<string, any>;
  actions: string[];
  is_draft: boolean;
  is_enabled: boolean;
}

interface ConfigVersion {
  id: string;
  version: number;
  comment?: string;
  published_at: string;
  status: 'active' | 'rolled_back';
}

const ZONE_PURPOSES = [
  { value: "intrusion_zone", label: "Intrusion Zone" },
  { value: "restricted_zone", label: "Restricted Area" },
  { value: "parking_slot", label: "Parking Slot" },
  { value: "lane", label: "Traffic Lane" },
  { value: "counting_line", label: "Counting Line" },
  { value: "privacy_mask", label: "Privacy Mask" },
  { value: "exclusion_zone", label: "Exclusion Zone" },
  { value: "dwell_area", label: "Dwell Area" },
  { value: "crowd_area", label: "Crowd Density Zone" },
  { value: "fire_zone", label: "Fire & Smoke Zone" },
];

const RULE_TRIGGERS = [
  { value: "zone_intrusion", label: "Intrusion Detection" },
  { value: "line_crossing", label: "Line Crossing" },
  { value: "loitering", label: "Loitering / Dwell Time" },
  { value: "speed_limit", label: "Speed Calibration Limit" },
  { value: "parking_occupancy", label: "Parking Space Occupancy" },
  { value: "fire_smoke", label: "Fire/Smoke Detection" },
];

const COCO_CLASSES = ["person", "bicycle", "car", "motorcycle", "bus", "truck", "backpack", "suitcase"];

export default function AdminStudio({ onDeactivated }: { onDeactivated: () => void }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCam, setSelectedCam] = useState<Camera | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  
  const [drawMode, setDrawMode] = useState<"view" | "polygon" | "rectangle" | "circle" | "line">("view");
  const [activePurpose, setActivePurpose] = useState<string>("intrusion_zone");
  const [activePoints, setActivePoints] = useState<number[][]>([]);
  const [editingDrawingId, setEditingDrawingId] = useState<string | null>(null);
  
  // Rule builder form state
  const [ruleName, setRuleName] = useState("");
  const [ruleTrigger, setRuleTrigger] = useState("zone_intrusion");
  const [ruleSourceId, setRuleSourceId] = useState("");
  const [ruleClass, setRuleClass] = useState("person");
  const [ruleAction, setRuleAction] = useState("alert");

  // Publishing comment
  const [publishComment, setPublishComment] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load initial organizational data
  useEffect(() => {
    async function loadData() {
      const sb = await getSupabase();
      
      // Load cameras
      const { data: cams } = await sb.from("cameras").select("*");
      if (cams) {
        setCameras(cams);
        if (cams.length > 0) setSelectedCam(cams[0]);
      }

      // Load config versions
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (vers) setVersions(vers);
    }
    loadData();

    // Check engine status
    isEngineOnline().then(setEngineOnline);
    const interval = setInterval(() => {
      isEngineOnline().then(setEngineOnline);
    }, 10_000);
    return () => clearInterval(interval);
  }, []);

  // Load drawings and rules for the selected camera
  useEffect(() => {
    if (!selectedCam) return;
    const cam = selectedCam;
    async function loadCamData() {
      const sb = await getSupabase();
      const { data: draws } = await sb.from("analytics_drawings").select("*").eq("camera_id", cam.id).is("deleted_at", null);
      if (draws) setDrawings(draws);

      const { data: ruleList } = await sb.from("rule_engine_rules").select("*").eq("camera_id", cam.id).is("deleted_at", null);
      if (ruleList) setRules(ruleList);
    }
    loadCamData();
    setActivePoints([]);
    setDrawMode("view");
  }, [selectedCam]);

  // Render drawings on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas dimensions based on display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw active drawing helper
    if (activePoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = "#38bdf8"; // bright blue sky
      ctx.fillStyle = "rgba(56, 189, 248, 0.15)";
      ctx.lineWidth = 2.5;

      activePoints.forEach(([nx, ny], idx) => {
        const x = nx * canvas.width;
        const y = ny * canvas.height;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        // draw handles
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      });

      if (drawMode !== "line" && activePoints.length > 2) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();
    }

    // Draw saved drawings
    drawings.forEach((d) => {
      if (d.points.length === 0) return;
      const isEditing = editingDrawingId === d.id;
      
      ctx.beginPath();
      ctx.strokeStyle = isEditing ? "#a855f7" : (d.properties?.color || "#f43f5e");
      ctx.fillStyle = isEditing ? "rgba(168, 85, 247, 0.2)" : (d.properties?.fillColor || "rgba(244, 63, 94, 0.1)");
      ctx.lineWidth = isEditing ? 3 : 2;

      d.points.forEach(([nx, ny], idx) => {
        const x = nx * canvas.width;
        const y = ny * canvas.height;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        if (isEditing) {
          ctx.fillStyle = "#a855f7";
          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      if (d.type !== "line" && d.type !== "arrow") {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();

      // Draw text tag
      const firstPt = d.points[0];
      if (firstPt) {
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.fillStyle = isEditing ? "#a855f7" : (d.properties?.color || "#f43f5e");
        ctx.fillText(
          `${d.name} (${ZONE_PURPOSES.find((p) => p.value === d.purpose)?.label || d.purpose})`,
          firstPt[0] * canvas.width,
          firstPt[1] * canvas.height - 8
        );
      }
    });
  }, [drawings, activePoints, drawMode, editingDrawingId]);

  // Click on canvas (drawing math)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === "view") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    // Normalizing coordinates safely
    const point = [Number(nx.toFixed(4)), Number(ny.toFixed(4))];

    if (drawMode === "line") {
      if (activePoints.length === 0) {
        setActivePoints([point]);
      } else {
        saveDrawing([...activePoints, point]);
      }
    } else if (drawMode === "rectangle") {
      if (activePoints.length === 0) {
        setActivePoints([point]);
      } else {
        const [start] = activePoints;
        const pts = [
          [start[0], start[1]],
          [point[0], start[1]],
          [point[0], point[1]],
          [start[0], point[1]],
        ];
        saveDrawing(pts);
      }
    } else if (drawMode === "polygon") {
      // Double click / select closes polygon. For simplicity, clicking near the start closes it.
      if (activePoints.length >= 3) {
        const [start] = activePoints;
        const dist = Math.hypot(start[0] - point[0], start[1] - point[1]);
        if (dist < 0.04) {
          saveDrawing(activePoints);
          return;
        }
      }
      setActivePoints([...activePoints, point]);
    }
  };

  const saveDrawing = async (pts: number[][]) => {
    if (!selectedCam) return;
    const sb = await getSupabase();
    
    const newDrawing = {
      org_id: selectedCam.zones ? JSON.parse(selectedCam.zones)[0]?.org_id || "7eb517df-1a2f-4e08-9dfc-2792e34ff6a6" : "7eb517df-1a2f-4e08-9dfc-2792e34ff6a6",
      camera_id: selectedCam.id,
      name: `${ZONE_PURPOSES.find((p) => p.value === activePurpose)?.label} ${drawings.length + 1}`,
      type: drawMode === "line" ? "line" : drawMode === "rectangle" ? "rectangle" : "polygon",
      purpose: activePurpose,
      points: pts,
      properties: {
        color: activePurpose === "privacy_mask" ? "#27272a" : activePurpose === "restricted_zone" ? "#ef4444" : "#10b981",
        fillColor: activePurpose === "privacy_mask" ? "rgba(39, 39, 42, 0.9)" : "rgba(16, 185, 129, 0.15)"
      },
      is_draft: true,
    };

    // Auto-resolve organization id
    const { data: profile } = await sb.from("profiles").select("org_id").single();
    if (profile?.org_id) {
      newDrawing.org_id = profile.org_id;
    }

    try {
      const { data, error } = await sb.from("analytics_drawings").insert([newDrawing]).select();
      if (error) throw error;
      if (data) {
        setDrawings([...drawings, data[0] as Drawing]);
      }
    } catch (e) {
      console.error("Failed to insert drawing:", e);
    }

    setActivePoints([]);
    setDrawMode("view");
  };

  const deleteDrawing = async (id: string) => {
    const sb = await getSupabase();
    try {
      await sb.from("analytics_drawings").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      setDrawings(drawings.filter((d) => d.id !== id));
      // Delete rules referencing it
      await sb.from("rule_engine_rules").update({ deleted_at: new Date().toISOString() }).eq("trigger_source_id", id);
      setRules(rules.filter((r) => r.trigger_source_id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  // Rule configuration
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCam || !ruleName.trim() || !ruleSourceId) return;

    const sb = await getSupabase();
    const { data: profile } = await sb.from("profiles").select("org_id").single();
    const org_id = profile?.org_id || "7eb517df-1a2f-4e08-9dfc-2792e34ff6a6";

    const newRule = {
      org_id,
      camera_id: selectedCam.id,
      name: ruleName,
      trigger_type: ruleTrigger,
      trigger_source_id: ruleSourceId,
      conditions: { class: ruleClass, confidence: 0.35 },
      actions: [ruleAction],
      is_draft: true,
      is_enabled: true
    };

    try {
      const { data, error } = await sb.from("rule_engine_rules").insert([newRule]).select();
      if (error) throw error;
      if (data) {
        setRules([...rules, data[0] as Rule]);
        setRuleName("");
        setRuleSourceId("");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const deleteRule = async (id: string) => {
    const sb = await getSupabase();
    try {
      await sb.from("rule_engine_rules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      setRules(rules.filter((r) => r.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  // Publish active draft configuration
  const publishConfig = async () => {
    setPublishing(true);
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.functions.invoke("publish-config", {
        body: { comment: publishComment || "Standard Configuration Update" }
      });
      if (error) throw error;

      // Reload config versions
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (vers) setVersions(vers);
      
      // Update drawings & rules flags locally
      setDrawings(drawings.map((d) => ({ ...d, is_draft: false })));
      setRules(rules.map((r) => ({ ...r, is_draft: false })));
      setPublishComment("");
      alert("Configuration published successfully! Cameras are hot-swapping live.");
    } catch (e: any) {
      alert(`Publishing failed: ${e.message}`);
    } finally {
      setPublishing(false);
    }
  };

  // Rollback configuration to version
  const rollbackConfig = async (version: number) => {
    if (!confirm(`Are you sure you want to rollback to version ${version}? This will overwrite drafts.`)) return;
    setPublishing(true);
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.functions.invoke("rollback-config", {
        body: { version }
      });
      if (error) throw error;

      // Reload all
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (vers) setVersions(vers);

      if (selectedCam) {
        const { data: draws } = await sb.from("analytics_drawings").select("*").eq("camera_id", selectedCam.id).is("deleted_at", null);
        if (draws) setDrawings(draws);
        const { data: ruleList } = await sb.from("rule_engine_rules").select("*").eq("camera_id", selectedCam.id).is("deleted_at", null);
        if (ruleList) setRules(ruleList);
      }
      alert(`Successfully rolled back to version ${version}.`);
    } catch (e: any) {
      alert(`Rollback failed: ${e.message}`);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex h-screen bg-surface-0 overflow-hidden font-sans">
      {/* Sidebar 1: Cameras and Publish/Rollback */}
      <aside className="w-64 border-r border-line bg-surface-1 flex flex-col justify-between shrink-0">
        <div className="flex flex-col flex-1 overflow-y-auto">
          <div className="flex items-center gap-2.5 px-4 py-4 border-b border-line">
            <img src="./favicon.svg" alt="CamAI" className="h-7 w-7 rounded-md" />
            <div>
              <div className="text-sm font-semibold text-zinc-100">CamAI Admin Studio</div>
              <div className="text-[10px] text-accent font-medium uppercase tracking-wider">Config Canvas</div>
            </div>
          </div>

          <div className="px-3 py-3">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
              <span>Cameras</span>
              <span className={`h-2 w-2 rounded-full ${engineOnline ? "bg-ok" : "bg-danger"}`} title={engineOnline ? "Engine Online" : "Engine Offline"} />
            </div>
            <div className="space-y-1">
              {cameras.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCam(c)}
                  className={clsx(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition text-left",
                    selectedCam?.id === c.id
                      ? "bg-accent/15 font-medium text-accent border-l-2 border-accent"
                      : "text-zinc-400 hover:bg-surface-2 hover:text-zinc-200"
                  )}
                >
                  <Video size={13} className="shrink-0" />
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sync/Publish Timeline */}
        <div className="border-t border-line p-3 bg-surface-2/30 space-y-3">
          <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Publish Timeline</div>
          <div className="max-h-40 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
            {versions.map((v) => (
              <div key={v.id} className="p-2 rounded bg-surface-0 border border-line text-[10px] space-y-1">
                <div className="flex justify-between font-mono font-semibold">
                  <span className="text-zinc-300">v{v.version}</span>
                  <span className={clsx("capitalize", v.status === "active" ? "text-ok" : "text-zinc-500")}>
                    {v.status}
                  </span>
                </div>
                {v.comment && <p className="text-zinc-400 truncate italic">"{v.comment}"</p>}
                {v.status === "active" && versions[0]?.version === v.version ? (
                  <span className="text-zinc-500 text-[9px] block">Currently Active</span>
                ) : (
                  <button
                    onClick={() => rollbackConfig(v.version)}
                    className="text-accent hover:underline text-[9px] font-medium flex items-center gap-0.5"
                  >
                    <RotateCcw size={9} /> Rollback here
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="Publish notes..."
              value={publishComment}
              onChange={(e) => setPublishComment(e.target.value)}
              className="w-full text-xs bg-surface-0 border border-line rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-accent"
            />
            <button
              onClick={publishConfig}
              disabled={publishing}
              className="w-full btn-accent flex items-center justify-center gap-1.5 py-1.5 text-xs"
            >
              <Send size={12} />
              {publishing ? "Publishing..." : "Publish Configs"}
            </button>
          </div>

          <button
            onClick={onDeactivated}
            className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 pt-1"
          >
            Exit Studio
          </button>
        </div>
      </aside>

      {/* Main Canvas Area */}
      <main className="flex-1 flex flex-col bg-surface-0 overflow-hidden relative">
        {/* Drawing Toolbar */}
        <div className="h-14 border-b border-line bg-surface-1 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">Drawing Tool:</span>
            <div className="flex rounded-md bg-surface-2 p-0.5 border border-line">
              {(["view", "polygon", "rectangle", "line"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setDrawMode(m);
                    setActivePoints([]);
                  }}
                  className={clsx(
                    "text-xs px-2.5 py-1 rounded capitalize transition",
                    drawMode === m ? "bg-surface-0 text-accent font-medium" : "text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-zinc-200">Zone Type:</span>
              <select
                value={activePurpose}
                onChange={(e) => setActivePurpose(e.target.value)}
                className="bg-surface-2 border border-line text-xs rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-accent"
              >
                {ZONE_PURPOSES.map((zp) => (
                  <option key={zp.value} value={zp.value}>
                    {zp.label}
                  </option>
                ))}
              </select>
            </div>
            {activePoints.length > 0 && (
              <button
                onClick={() => saveDrawing(activePoints)}
                className="btn-accent text-xs px-3 py-1 flex items-center gap-1"
              >
                <CheckCircle2 size={12} /> Save Shape
              </button>
            )}
          </div>
        </div>

        {/* Viewport Frame */}
        <div ref={containerRef} className="flex-1 relative bg-surface-0 flex items-center justify-center p-4">
          {selectedCam ? (
            <div className="relative aspect-video max-h-full max-w-full rounded border border-line overflow-hidden shadow-2xl bg-zinc-950">
              {engineOnline ? (
                <img
                  src={mjpegStreamUrl(selectedCam.id)}
                  alt="Live Studio Stream"
                  className="h-full w-full object-contain pointer-events-none"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/90 text-zinc-500">
                  <Video size={36} />
                  <span className="text-xs">Live stream disconnected (Engine Offline)</span>
                  <span className="text-[10px] text-zinc-600">Drawing functions operate normally on coordinate grid</span>
                </div>
              )}

              <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className={clsx(
                  "absolute inset-0 w-full h-full cursor-crosshair z-10",
                  drawMode === "view" ? "cursor-default" : "cursor-crosshair"
                )}
              />
            </div>
          ) : (
            <div className="text-xs text-zinc-500">Select a camera to configure.</div>
          )}
        </div>
      </main>

      {/* Sidebar 2: Shapes & Rules Config */}
      <aside className="w-80 border-l border-line bg-surface-1 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-4 border-b border-line">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Camera Analytics Drawings</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">Define trigger geometries on canvas.</p>
        </div>

        {/* Shapes List */}
        <div className="p-4 flex-1 border-b border-line max-h-64 overflow-y-auto">
          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
            <span>Geometries ({drawings.length})</span>
          </div>

          <div className="space-y-1.5">
            {drawings.length === 0 ? (
              <div className="text-xs text-zinc-500 italic">No shapes drawn. Select a tool to begin drawing.</div>
            ) : (
              drawings.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setEditingDrawingId(editingDrawingId === d.id ? null : d.id)}
                  className={clsx(
                    "p-2 rounded border transition text-xs flex justify-between items-center cursor-pointer",
                    editingDrawingId === d.id ? "bg-accent/10 border-accent" : "bg-surface-0 border-line hover:border-zinc-700"
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-200 truncate">{d.name}</div>
                    <div className="text-[9px] text-zinc-500 font-mono capitalize">
                      {d.type} • {ZONE_PURPOSES.find((p) => p.value === d.purpose)?.label || d.purpose}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDrawing(d.id);
                    }}
                    className="text-zinc-500 hover:text-danger p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Rule Builder Panel */}
        <div className="p-4 flex-1 flex flex-col">
          <div className="mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Rule Logic Builder</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Map drawn shapes to automated event notifications.</p>
          </div>

          <form onSubmit={handleAddRule} className="space-y-3 p-3 rounded border border-line bg-surface-0 mb-4">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-zinc-400 uppercase">Rule Name</label>
              <input
                type="text"
                placeholder="Alert Intruder..."
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="w-full text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-accent"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase">Trigger Event</label>
                <select
                  value={ruleTrigger}
                  onChange={(e) => setRuleTrigger(e.target.value)}
                  className="w-full text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none"
                >
                  {RULE_TRIGGERS.map((rt) => (
                    <option key={rt.value} value={rt.value}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase">Source Shape</label>
                <select
                  value={ruleSourceId}
                  onChange={(e) => setRuleSourceId(e.target.value)}
                  className="w-full text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none"
                  required
                >
                  <option value="">-- Choose --</option>
                  {drawings.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase">Detect Class</label>
                <select
                  value={ruleClass}
                  onChange={(e) => setRuleClass(e.target.value)}
                  className="w-full text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none"
                >
                  {COCO_CLASSES.map((cls) => (
                    <option key={cls} value={cls}>
                      {cls}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-zinc-400 uppercase">Action</label>
                <select
                  value={ruleAction}
                  onChange={(e) => setRuleAction(e.target.value)}
                  className="w-full text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none"
                >
                  <option value="alert">Send Alert</option>
                  <option value="record">Record Clip</option>
                  <option value="custom">WebHook Trigger</option>
                </select>
              </div>
            </div>

            <button type="submit" className="w-full btn-accent py-1.5 text-xs flex items-center justify-center gap-1 mt-1">
              <Plus size={12} /> Save Logic Rule
            </button>
          </form>

          {/* Active Rules List */}
          <div className="space-y-2 flex-1 overflow-y-auto pr-1">
            <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5">Active Logical Rules ({rules.length})</div>
            {rules.map((r) => (
              <div key={r.id} className="p-2 rounded bg-surface-0 border border-line text-xs flex justify-between items-start">
                <div className="min-w-0">
                  <div className="font-semibold text-zinc-200">{r.name}</div>
                  <p className="text-[9px] text-zinc-500 leading-normal">
                    IF <span className="font-mono text-zinc-400 font-bold">{r.conditions?.class || "any"}</span> triggers <span className="font-mono text-zinc-400">{RULE_TRIGGERS.find((rt) => rt.value === r.trigger_type)?.label}</span> on <span className="font-mono text-zinc-400">{drawings.find((d) => d.id === r.trigger_source_id)?.name || "Shape"}</span> THEN <span className="font-mono text-zinc-400">{r.actions.join(", ")}</span>.
                  </p>
                </div>
                <button
                  onClick={() => deleteRule(r.id)}
                  className="text-zinc-500 hover:text-danger p-1 shrink-0"
                >
                  <Trash size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
