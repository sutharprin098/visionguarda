import React, { useState, useEffect, useRef } from 'react';
import {
  Video, RotateCcw, CheckCircle2, Trash2, ChevronDown, ChevronRight,
  PenTool, Square, Circle as CircleIcon, Minus, MousePointer2,
  Car, Shield, Factory, Boxes, ShoppingBag, Building2, Eye,
  Sliders, Send, Bell, ArrowLeft, Pencil, Lock, Unlock,
  Trash, Copy as CopyIcon, Undo2, Redo2, Youtube, Camera
} from 'lucide-react';
import clsx from 'clsx';
import CamAILogo from '../components/CamAILogo';
import TargetMatcherUI from '../components/TargetMatcherUI';
import {
  ZONE_PROFILES,
  PROFILE_ORDER,
  type ZoneProfileKey,
  type ProfileFeatures,
  type FeatureDef,
} from '../lib/zoneProfiles';
import {
  type EditableShape,
  isHidden,
  isLocked,
  isInteractive,
} from '../lib/zoneEditor';
import {
  ConfigVersion,
  getCameraStreamUrl,
  getCameraSnapshotUrl,
  loadShapesFromStorage,
  saveShapesToStorage,
  loadActiveProfile,
  saveActiveProfile,
  loadFeatures,
  saveFeatures,
  loadVersions,
  publishConfigLocally,
  rollbackConfigLocally,
  getLicenseStatus,
} from '../lib/cameraEngine';

type DrawMode = "view" | "polygon" | "rectangle" | "circle" | "line";

interface DrawBinding {
  featureKey: string | null;
  featureLabel: string;
  purpose: string;
}

const PROFILE_ICON: Record<ZoneProfileKey, React.ComponentType<any>> = {
  traffic: Car,
  security: Shield,
  factory: Factory,
  retail: ShoppingBag,
  smart_city: Building2,
  micro_motion: Eye,
  custom: Boxes,
};

// Light theme color accents
const LIGHT_ACCENT: Record<string, { text: string; bg: string; border: string }> = {
  sky: { text: "text-sky-700", bg: "bg-sky-50", border: "border-sky-300" },
  rose: { text: "text-rose-700", bg: "bg-rose-50", border: "border-rose-300" },
  amber: { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-300" },
  emerald: { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-300" },
  violet: { text: "text-purple-700", bg: "bg-purple-50", border: "border-purple-300" },
};

function getProfileLightAccent(profileKey?: ZoneProfileKey | string | null) {
  if (profileKey && ZONE_PROFILES[profileKey as ZoneProfileKey]) {
    const hue = ZONE_PROFILES[profileKey as ZoneProfileKey].accent;
    if (LIGHT_ACCENT[hue]) return LIGHT_ACCENT[hue];
  }
  return LIGHT_ACCENT.sky;
}

export interface AdminStudioProps {
  onBackToWorkspace: () => void;
}

export const AdminStudio: React.FC<AdminStudioProps> = ({ onBackToWorkspace }) => {
  const [activeProfile, setActiveProfile] = useState<ZoneProfileKey>(loadActiveProfile());
  const [features, setFeatures] = useState<ProfileFeatures>(loadFeatures());
  const [shapes, setShapes] = useState<EditableShape[]>(loadShapesFromStorage());
  const [versions, setVersions] = useState<ConfigVersion[]>(loadVersions());
  const [publishComment, setPublishComment] = useState('Edge AI zones and rules updated');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Drawing state
  const [drawMode, setDrawMode] = useState<DrawMode>("view");
  const [drawBinding, setDrawBinding] = useState<DrawBinding | null>(null);
  const [activePoints, setActivePoints] = useState<number[][]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [history, setHistory] = useState<EditableShape[][]>([]);
  const [future, setFuture] = useState<EditableShape[][]>([]);

  // Viewport stream
  const [streamSource, setStreamSource] = useState<'youtube' | 'axis'>('youtube');
  const [streamFailed, setStreamFailed] = useState(false);
  const [streamPaused, setStreamPaused] = useState(false);
  const [zonesVisible, setZonesVisible] = useState(true);
  const [fps, setFps] = useState('29.8');

  // Accordion collapsed state
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<[number, number] | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2800);
  };

  useEffect(() => {
    saveShapesToStorage(shapes);
  }, [shapes]);

  useEffect(() => {
    saveActiveProfile(activeProfile);
  }, [activeProfile]);

  useEffect(() => {
    saveFeatures(features);
  }, [features]);

  useEffect(() => {
    const interval = setInterval(() => {
      setFps((29.7 + Math.random() * 0.4).toFixed(1));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const pushHistory = (currentShapes: EditableShape[]) => {
    setHistory((prev) => [...prev.slice(-20), currentShapes]);
    setFuture([]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setFuture((prev) => [shapes, ...prev]);
    setHistory((prev) => prev.slice(0, -1));
    setShapes(previous);
    setSelectedShapeId(null);
    showToast('Undo.');
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setHistory((prev) => [...prev, shapes]);
    setFuture((prev) => prev.slice(1));
    setShapes(next);
    setSelectedShapeId(null);
    showToast('Redo.');
  };

  const handleDuplicate = () => {
    const sel = shapes.find((s) => s.id === selectedShapeId) || shapes[shapes.length - 1];
    if (!sel) return;
    pushHistory(shapes);
    const offset = 0.04;
    const newPts = sel.points.map((pt) => [Math.min(0.96, pt[0] + offset), Math.min(0.96, pt[1] + offset)]);
    const clone: EditableShape = {
      ...sel,
      id: 'shape_' + Date.now(),
      name: `${sel.name} (Copy)`,
      points: newPts,
    };
    setShapes([...shapes, clone]);
    setSelectedShapeId(clone.id);
    showToast('Shape duplicated.');
  };

  const handleDelete = () => {
    if (!selectedShapeId && shapes.length === 0) return;
    const targetId = selectedShapeId || shapes[shapes.length - 1].id;
    pushHistory(shapes);
    setShapes(shapes.filter((s) => s.id !== targetId));
    if (selectedShapeId === targetId) setSelectedShapeId(null);
    showToast('Shape deleted.');
  };

  const handlePublish = async () => {
    try {
      const compiled = await publishConfigLocally(
        shapes,
        activeProfile,
        features,
        publishComment
      );
      setVersions(loadVersions());
      setPublishComment('');
      showToast(`🚀 Config v${compiled.version} published locally to camera (0 Cloud). Live engine updated.`);
    } catch (e) {
      showToast('Local publish failed.');
    }
  };

  const handleRollback = (verNum: number) => {
    const restored = rollbackConfigLocally(verNum);
    if (restored) {
      setShapes(restored.shapes);
      setActiveProfile(restored.profile);
      setFeatures(restored.features);
      setVersions(loadVersions());
      showToast(`Restored local configuration snapshot v${verNum}.`);
    }
  };

  // Canvas interaction & rendering
  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!zonesVisible) return;

    shapes.forEach((s) => {
      if (isHidden(s)) return;
      const isSel = s.id === selectedShapeId;

      if (s.type === 'polygon' && s.points.length >= 3) {
        ctx.strokeStyle = isSel ? '#2563eb' : '#0284c7';
        ctx.lineWidth = isSel ? 3 : 2;
        ctx.fillStyle = isSel ? 'rgba(37, 99, 235, 0.22)' : 'rgba(2, 132, 199, 0.15)';
        ctx.beginPath();
        s.points.forEach((pt, idx) => {
          const px = pt[0] * canvas.width;
          const py = pt[1] * canvas.height;
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Vertex handles
        s.points.forEach((pt) => {
          ctx.fillStyle = isSel ? '#2563eb' : '#ffffff';
          ctx.beginPath();
          ctx.arc(pt[0] * canvas.width, pt[1] * canvas.height, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#0284c7';
          ctx.stroke();
        });

        // Label
        ctx.fillStyle = isSel ? '#2563eb' : '#0284c7';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(s.name, s.points[0][0] * canvas.width + 6, s.points[0][1] * canvas.height - 6);
      } else if (s.type === 'line' && s.points.length >= 2) {
        ctx.strokeStyle = isSel ? '#2563eb' : '#d97706';
        ctx.lineWidth = isSel ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(s.points[0][0] * canvas.width, s.points[0][1] * canvas.height);
        ctx.lineTo(s.points[1][0] * canvas.width, s.points[1][1] * canvas.height);
        ctx.stroke();

        ctx.fillStyle = '#d97706';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(s.name, s.points[0][0] * canvas.width + 6, s.points[0][1] * canvas.height - 6);
      } else if (s.type === 'circle' && s.points.length >= 2) {
        const cx = s.points[0][0] * canvas.width;
        const cy = s.points[0][1] * canvas.height;
        const cr = s.points[1][0] * canvas.width;
        ctx.strokeStyle = isSel ? '#2563eb' : '#7c3aed';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(124, 58, 237, 0.16)';
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#7c3aed';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(s.name, cx - cr, cy - cr - 6);
      }
    });

    // Active in-progress points
    if (activePoints.length > 0) {
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      activePoints.forEach((pt, idx) => {
        const px = pt[0] * canvas.width;
        const py = pt[1] * canvas.height;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      activePoints.forEach((pt) => {
        ctx.fillStyle = '#dc2626';
        ctx.beginPath();
        ctx.arc(pt[0] * canvas.width, pt[1] * canvas.height, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  };

  useEffect(() => {
    redrawCanvas();
  }, [shapes, selectedShapeId, activePoints, zonesVisible]);

  useEffect(() => {
    const handleResize = () => redrawCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [shapes]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / canvas.width;
    const y = (e.clientY - r.top) / canvas.height;

    isDraggingRef.current = true;
    dragStartRef.current = [x, y];

    if (drawMode === 'polygon') {
      setActivePoints((prev) => [...prev, [x, y]]);
    } else if (drawMode === 'view') {
      const found = shapes.find((s) => {
        if (!isInteractive(s)) return false;
        if (s.points.some((pt) => Math.hypot(pt[0] - x, pt[1] - y) < 0.05)) return true;
        return false;
      });
      setSelectedShapeId(found ? found.id : null);
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas || !dragStartRef.current) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / canvas.width;
    const y = (e.clientY - r.top) / canvas.height;
    const start = dragStartRef.current;

    if (drawMode === 'rectangle') {
      const x1 = Math.min(start[0], x);
      const y1 = Math.min(start[1], y);
      const x2 = Math.max(start[0], x);
      const y2 = Math.max(start[1], y);
      if (Math.abs(x2 - x1) > 0.02 && Math.abs(y2 - y1) > 0.02) {
        pushHistory(shapes);
        const newShape: EditableShape = {
          id: 'rect_' + Date.now(),
          name: `${drawBinding?.featureLabel || 'Zone'} ${shapes.length + 1}`,
          type: 'polygon',
          points: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]],
          properties: { featureKey: drawBinding?.featureKey || null },
        };
        setShapes([...shapes, newShape]);
        setSelectedShapeId(newShape.id);
        setDrawMode('view');
        showToast('Rectangle zone created.');
      }
    } else if (drawMode === 'circle') {
      const radius = Math.hypot(x - start[0], y - start[1]);
      if (radius > 0.02) {
        pushHistory(shapes);
        const newShape: EditableShape = {
          id: 'circ_' + Date.now(),
          name: `Circle Zone ${shapes.length + 1}`,
          type: 'circle',
          points: [[start[0], start[1]], [radius, 0]],
          properties: { featureKey: drawBinding?.featureKey || null },
        };
        setShapes([...shapes, newShape]);
        setSelectedShapeId(newShape.id);
        setDrawMode('view');
        showToast('Circle zone created.');
      }
    } else if (drawMode === 'line') {
      if (Math.hypot(x - start[0], y - start[1]) > 0.02) {
        pushHistory(shapes);
        const newShape: EditableShape = {
          id: 'line_' + Date.now(),
          name: `${drawBinding?.featureLabel || 'Tripwire'} ${shapes.length + 1}`,
          type: 'line',
          points: [[start[0], start[1]], [x, y]],
          properties: { featureKey: drawBinding?.featureKey || null },
        };
        setShapes([...shapes, newShape]);
        setSelectedShapeId(newShape.id);
        setDrawMode('view');
        showToast('Line tripwire created.');
      }
    }
    dragStartRef.current = null;
  };

  const handleClosePolygon = () => {
    if (activePoints.length >= 3) {
      pushHistory(shapes);
      const newShape: EditableShape = {
        id: 'poly_' + Date.now(),
        name: `${drawBinding?.featureLabel || 'Polygon Zone'} ${shapes.length + 1}`,
        type: 'polygon',
        points: [...activePoints],
        properties: { featureKey: drawBinding?.featureKey || null },
      };
      setShapes([...shapes, newShape]);
      setActivePoints([]);
      setSelectedShapeId(newShape.id);
      setDrawMode('view');
      showToast('Polygon zone closed.');
    }
  };

  const handleBindAndDraw = (f: FeatureDef) => {
    const mode = f.requiresGeometry === 'line' ? 'line' : 'polygon';
    setDrawMode(mode);
    setDrawBinding({
      featureKey: f.key,
      featureLabel: f.drawTool?.label || f.label,
      purpose: f.drawTool?.purpose || f.key,
    });
    showToast(`Click or drag on video to draw ${f.drawTool?.label || f.label}`);
  };

  const profileDef = ZONE_PROFILES[activeProfile];
  const accent = getProfileLightAccent(activeProfile);

  return (
    <div className="flex h-screen bg-surface-0 text-slate-900 overflow-hidden font-sans">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed top-14 right-6 z-50 bg-ok text-white px-3.5 py-2 rounded-md font-semibold text-xs shadow-xl flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <CheckCircle2 size={14} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Sidebar 1: Cameras + Publish Timeline (Clean Light Theme) */}
      <aside className="w-64 border-r border-line bg-surface-1 flex flex-col justify-between shrink-0 shadow-xs">
        <div className="flex flex-col flex-1 overflow-y-auto custom-scrollbar">
          {/* Brand Header */}
          <div className="flex items-center gap-2.5 px-4 py-4 border-b border-line">
            <CamAILogo size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-slate-900 leading-tight">CamAI Zone Studio</div>
              <div className="text-[10px] text-accent font-semibold uppercase tracking-wider">Enterprise Profiles</div>
            </div>
            <button
              title="Camera Alert Notifications"
              onClick={() => showToast('Alerts desk: 3 alerts logged.')}
              className="relative shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-surface-2 hover:text-slate-800"
            >
              <Bell size={16} />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                3
              </span>
            </button>
          </div>

          {/* Back to Workspace button */}
          <div className="px-3 py-2.5 border-b border-line bg-surface-2/40">
            <button
              onClick={onBackToWorkspace}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 border border-line hover:bg-surface-2 hover:text-slate-900 transition shadow-xs"
            >
              <ArrowLeft size={14} /> Back to Workspace
            </button>
          </div>

          {/* Camera List */}
          <div className="px-3 py-3">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-2">
              <span>Cameras</span>
              <span className="h-2 w-2 rounded-full bg-ok" title="Engine Active" />
            </div>
            <div className="space-y-1">
              <button
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition text-left bg-blue-50/80 font-medium text-blue-700 border-l-2 border-blue-600 shadow-2xs"
              >
                <Video size={13} className="shrink-0 text-blue-600" />
                <span className="truncate">Camera 01 (Axis Edge)</span>
                <span className="ml-auto text-[9px] uppercase text-slate-500 font-semibold">{activeProfile}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Publish Timeline box at bottom */}
        <div className="border-t border-line p-3 bg-slate-50 space-y-2.5">
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex justify-between items-center">
            <span>Publish Timeline</span>
            <span className="text-ok font-semibold">v{versions[0]?.version || 1} Active</span>
          </div>

          <div className="max-h-32 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
            {versions.map((v) => (
              <div key={v.id} className="p-2 rounded bg-white border border-line text-[10px] space-y-1 shadow-2xs">
                <div className="flex justify-between font-mono font-semibold">
                  <span className="text-slate-800">v{v.version}</span>
                  <span className={v.status === 'active' ? 'text-ok' : 'text-slate-500'}>{v.status}</span>
                </div>
                {v.comment && <p className="text-slate-600 truncate italic">"{v.comment}"</p>}
                {v.status === 'active' && versions[0]?.version === v.version ? (
                  <span className="text-slate-500 text-[9px] block">Currently Active</span>
                ) : (
                  <button
                    onClick={() => handleRollback(v.version)}
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
              className="w-full text-xs bg-white border border-line rounded px-2.5 py-1.5 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-accent"
            />
            <button
              onClick={handlePublish}
              className="w-full btn-accent flex items-center justify-center gap-1.5 py-1.5 text-xs shadow-sm"
            >
              <Send size={12} />
              <span>Publish Configs</span>
            </button>
            <div className="text-[10.5px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2.5 py-1.5 flex items-center justify-between font-semibold shadow-2xs">
              <span className="flex items-center gap-1">🛡️ Enterprise License</span>
              <span className="uppercase text-[9px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Active</span>
            </div>
          </div>
          <button
            onClick={onBackToWorkspace}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-700 pt-1"
          >
            Exit Studio
          </button>
        </div>
      </aside>

      {/* Main Center Canvas */}
      <main className="flex-1 flex flex-col bg-surface-0 overflow-hidden relative">
        {/* Top Bar 1: AI Mode Selector */}
        <div className="border-b border-line bg-surface-1 px-4 py-2.5 shrink-0 shadow-2xs">
          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mr-1 shrink-0">AI Mode</span>
            {PROFILE_ORDER.map((key) => {
              const def = ZONE_PROFILES[key];
              if (!def) return null;
              const Icon = PROFILE_ICON[key] || Boxes;
              const on = activeProfile === key;
              const a = getProfileLightAccent(key);
              return (
                <button
                  key={key}
                  onClick={() => setActiveProfile(key)}
                  className={clsx(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition shrink-0",
                    on ? `${a.bg} ${a.text} ${a.border} font-semibold shadow-xs` : "bg-white border-line text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                  title={def.description}
                >
                  <Icon size={14} />
                  <span>{def.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Top Bar 2: Draw Toolbar */}
        <div className="h-12 border-b border-line bg-surface-1 px-4 flex items-center justify-between shrink-0 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Draw:</span>
            <div className="flex rounded-md bg-surface-2 p-0.5 border border-line">
              {(
                [
                  { mode: "view", icon: MousePointer2, label: "Select" },
                  { mode: "polygon", icon: PenTool, label: "Polygon" },
                  { mode: "rectangle", icon: Square, label: "Rectangle" },
                  { mode: "circle", icon: CircleIcon, label: "Circle" },
                  { mode: "line", icon: Minus, label: "Line" },
                ] as const
              ).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => {
                    setActivePoints([]);
                    setDrawMode(mode);
                    setDrawBinding(mode === "view" ? null : { featureKey: null, featureLabel: activeProfile === "custom" ? "Custom Zone" : "Zone", purpose: mode === "line" ? "counting_line" : "custom_zone" });
                  }}
                  className={clsx(
                    "text-xs px-2.5 py-1 rounded flex items-center gap-1 transition",
                    drawMode === mode ? "bg-white text-accent font-semibold shadow-xs border border-slate-200" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  <Icon size={12} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 border-r border-line pr-2 mr-1">
              <button
                onClick={handleUndo}
                disabled={history.length === 0}
                title="Undo (Ctrl+Z)"
                className="p-1.5 rounded text-slate-600 hover:text-slate-900 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Undo2 size={13} />
              </button>
              <button
                onClick={handleRedo}
                disabled={future.length === 0}
                title="Redo (Ctrl+Shift+Z)"
                className="p-1.5 rounded text-slate-600 hover:text-slate-900 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Redo2 size={13} />
              </button>
              <button
                onClick={handleDuplicate}
                disabled={shapes.length === 0}
                title="Duplicate (Ctrl+D)"
                className="p-1.5 rounded text-slate-600 hover:text-slate-900 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <CopyIcon size={13} />
              </button>
              <button
                onClick={handleDelete}
                disabled={shapes.length === 0}
                title="Delete (Del)"
                className="p-1.5 rounded text-slate-600 hover:text-danger hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Trash2 size={13} />
              </button>
            </div>

            {drawBinding && drawMode !== "view" && (
              <span className="text-[10px] text-slate-500 font-medium">
                Binding to: <b className="text-slate-800">{drawBinding.featureLabel}</b>
              </span>
            )}

            {activePoints.length > 0 && drawMode === "polygon" && (
              <button
                onClick={handleClosePolygon}
                className="btn-accent text-xs px-3 py-1 flex items-center gap-1 shadow-sm"
              >
                <CheckCircle2 size={12} /> Close Shape
              </button>
            )}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs ml-auto">
              <button
                onClick={() => setStreamSource('youtube')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition ${
                  streamSource === 'youtube'
                    ? 'bg-white text-rose-600 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Youtube size={12} className={streamSource === 'youtube' ? 'text-rose-600' : 'text-slate-400'} />
                <span>YouTube 4 Corners</span>
              </button>
              <button
                onClick={() => setStreamSource('axis')}
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition ${
                  streamSource === 'axis'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Camera size={12} />
                <span>Axis Live</span>
              </button>
            </div>
          </div>
        </div>

        {/* Viewport & Drawing Canvas */}
        <div className="flex-1 relative bg-slate-100 flex items-center justify-center p-4 overflow-hidden">
          <div className="relative aspect-video max-h-full max-w-full w-full rounded-xl border border-slate-300 overflow-hidden shadow-xl bg-slate-950 flex items-center justify-center">
            {/* Live Camera Stream from YouTube Live or Axis Camera */}
            {!streamPaused && (
              streamSource === 'youtube' ? (
                <iframe
                  src="https://www.youtube-nocookie.com/embed/Ellzen6Z7t8?autoplay=1&mute=1&controls=0&modestbranding=1&enablejsapi=1&rel=0"
                  title="4 Corners Downtown Live Traffic Feed"
                  className="h-full w-full object-cover pointer-events-none border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              ) : (
                <img
                  src={getCameraStreamUrl()}
                  alt="Camera Stream"
                  className="h-full w-full object-contain pointer-events-none"
                  onLoad={() => setStreamFailed(false)}
                  onError={() => setStreamFailed(true)}
                />
              )
            )}

            {streamFailed && streamSource === 'axis' && (
              <div className="absolute top-3 left-3 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/85 backdrop-blur-md text-xs font-mono text-amber-400 border border-amber-400/30 shadow-lg">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                Connecting Axis Live Stream (/axis-cgi/mjpg/video.cgi)...
              </div>
            )}

            {/* Interactive Vector Canvas */}
            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseUp={handleCanvasMouseUp}
              className={clsx(
                "absolute inset-0 w-full h-full z-10",
                drawMode !== "view" ? "cursor-crosshair" : selectedShapeId ? "cursor-move" : "cursor-default"
              )}
            />
          </div>
        </div>

        {/* Bottom Stream Status & Controls */}
        <div className="h-10 bg-surface-1 border-t border-line px-4 flex items-center justify-between text-xs text-slate-600 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStreamPaused(!streamPaused)}
              className="p-1 hover:text-slate-900 hover:bg-surface-2 rounded transition font-medium"
            >
              {streamPaused ? '▶ Play' : '❚❚ Pause'}
            </button>
            <button
              onClick={() => window.open(getCameraSnapshotUrl(), '_blank')}
              className="p-1 hover:text-slate-900 hover:bg-surface-2 rounded transition font-medium"
            >
              📸 Snapshot
            </button>
            <button
              onClick={() => setZonesVisible(!zonesVisible)}
              className="p-1 hover:text-slate-900 hover:bg-surface-2 rounded transition font-medium"
            >
              {zonesVisible ? '👁️ Hide Zones' : '👁️ Show Zones'}
            </button>
          </div>

          <div>
            FPS: <strong className="text-slate-900 font-semibold">{fps}</strong> &bull; 2592 &times; 1952 &bull; H.264 / MJPEG &bull; VAPIX Edge
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium">{shapes.length} zones loaded</span>
          </div>
        </div>
      </main>

      {/* Sidebar 2: Dynamic Feature Config (Clean Light Theme) */}
      <aside className="w-96 border-l border-line bg-surface-1 flex flex-col shrink-0 overflow-y-auto custom-scrollbar shadow-xs">
        {profileDef ? (
          <>
            <div className={clsx("p-4 border-b border-line", accent.bg)}>
              <div className={clsx("flex items-center gap-2 font-bold text-sm", accent.text)}>
                {(() => {
                  const Icon = PROFILE_ICON[profileDef.key];
                  return <Icon size={16} />;
                })()}
                <span>{profileDef.label} Profile</span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1 leading-snug">{profileDef.description}</p>
            </div>

            <div className="p-3 space-y-2">
              {profileDef.groupOrder.map((group) => {
                const groupFeatures = profileDef.features.filter((f) => f.group === group);
                const isGroupCollapsed = collapsed[`${profileDef.key}:${group}`];

                return (
                  <div key={group} className="rounded-lg border border-line bg-slate-50/60 overflow-hidden shadow-2xs">
                    <button
                      onClick={() =>
                        setCollapsed((prev) => ({
                          ...prev,
                          [`${profileDef.key}:${group}`]: !isGroupCollapsed,
                        }))
                      }
                      className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-700 hover:bg-slate-100 transition"
                    >
                      <span>{group}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-500 font-normal normal-case">
                          {groupFeatures.filter((f) => features[f.key]?.enabled).length}/{groupFeatures.length}
                        </span>
                        {isGroupCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </button>

                    {!isGroupCollapsed && (
                      <div className="p-2.5 space-y-2 border-t border-line bg-white">
                        {group === "ROI & Zones" ? (
                          /* ROI & Shapes Manager */
                          <div className="space-y-2">
                            <p className="text-[10px] text-slate-500">
                              Drawn shapes bound to features and compile into camera memory on publish.
                            </p>
                            <div className="space-y-1.5">
                              {shapes.map((s) => (
                                <div
                                  key={s.id}
                                  onClick={() => setSelectedShapeId(s.id)}
                                  className={clsx(
                                    "p-2 rounded border transition flex items-center justify-between cursor-pointer",
                                    selectedShapeId === s.id
                                      ? "bg-blue-50/80 border-blue-400"
                                      : "bg-surface-0 border-line hover:border-slate-300"
                                  )}
                                >
                                  <div className="min-w-0 flex-1 pr-2">
                                    <input
                                      type="text"
                                      value={s.name}
                                      onChange={(e) => {
                                        const updated = shapes.map((x) =>
                                          x.id === s.id ? { ...x, name: e.target.value } : x
                                        );
                                        setShapes(updated);
                                      }}
                                      className="bg-transparent text-xs font-semibold text-slate-800 border-none outline-none w-full"
                                    />
                                    <div className="text-[9px] text-slate-500 capitalize">
                                      {s.type} {s.properties?.featureKey ? `• ${s.properties.featureKey}` : ''}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const updated = shapes.map((x) =>
                                          x.id === s.id ? { ...x, properties: { ...x.properties, locked: !isLocked(x) } } : x
                                        );
                                        setShapes(updated);
                                      }}
                                      className="text-slate-500 hover:text-slate-800 p-1"
                                      title={isLocked(s) ? "Unlock" : "Lock"}
                                    >
                                      {isLocked(s) ? <Lock size={12} className="text-warn" /> : <Unlock size={12} />}
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const updated = shapes.filter((x) => x.id !== s.id);
                                        setShapes(updated);
                                        if (selectedShapeId === s.id) setSelectedShapeId(null);
                                      }}
                                      className="text-slate-500 hover:text-danger p-1"
                                      title="Delete"
                                    >
                                      <Trash size={12} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : group === "Schedule" ? (
                          <div className="p-2.5 rounded border border-line bg-surface-0 space-y-1.5">
                            <span className="text-[11px] font-semibold text-slate-800">Active Schedule Window</span>
                            <select className="w-full text-xs bg-white border border-line rounded px-2 py-1 text-slate-800 focus:outline-none focus:border-accent">
                              <option>Always on (24/7 Continuous)</option>
                              <option>Business Hours (08:00 - 18:00)</option>
                              <option>Overnight Patrol (18:00 - 06:00)</option>
                            </select>
                          </div>
                        ) : (
                          /* Regular Features Cards */
                          groupFeatures.map((f) => {
                            const cfg = features[f.key] ?? { enabled: f.defaultEnabled ?? false, params: {} };
                            const bound = shapes.filter((s) => s.properties?.featureKey === f.key);

                            return (
                              <div
                                key={f.key}
                                className={clsx(
                                  "rounded-lg border p-2.5 transition",
                                  cfg.enabled ? "border-slate-300 bg-white shadow-xs" : "border-line bg-slate-50/50"
                                )}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <span className="text-xs font-semibold text-slate-900">{f.label}</span>
                                    <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{f.description}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = {
                                        ...features,
                                        [f.key]: {
                                          ...cfg,
                                          enabled: !cfg.enabled,
                                        },
                                      };
                                      setFeatures(updated);
                                    }}
                                    className={clsx(
                                      "relative h-5 w-9 rounded-full transition shrink-0",
                                      cfg.enabled ? "bg-accent" : "bg-slate-300"
                                    )}
                                  >
                                    <span
                                      className={clsx(
                                        "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all shadow-xs",
                                        cfg.enabled ? "left-[18px]" : "left-0.5"
                                      )}
                                    />
                                  </button>
                                </div>

                                {cfg.enabled && (
                                  <div className="mt-2.5 space-y-2 pt-2 border-t border-line">
                                    {f.params.map((p) => (
                                      <div key={p.key} className="space-y-1">
                                        <div className="flex justify-between text-[10px] text-slate-600 font-medium">
                                          <span>{p.label}</span>
                                          {p.type === 'slider' && (
                                            <span className="font-mono text-slate-800">
                                              {String(cfg.params[p.key] ?? p.default)}
                                            </span>
                                          )}
                                        </div>
                                        {p.type === 'slider' && (
                                          <input
                                            type="range"
                                            min={p.min}
                                            max={p.max}
                                            step={p.step}
                                            value={(cfg.params[p.key] as number) ?? (p.default as number)}
                                            onChange={(e) => {
                                              setFeatures({
                                                ...features,
                                                [f.key]: {
                                                  ...cfg,
                                                  params: { ...cfg.params, [p.key]: Number(e.target.value) },
                                                },
                                              });
                                            }}
                                            className="w-full accent-accent cursor-pointer"
                                          />
                                        )}
                                        {p.type === 'select' && (
                                          <select
                                            value={(cfg.params[p.key] as string) ?? (p.default as string)}
                                            onChange={(e) => {
                                              setFeatures({
                                                ...features,
                                                [f.key]: {
                                                  ...cfg,
                                                  params: { ...cfg.params, [p.key]: e.target.value },
                                                },
                                              });
                                            }}
                                            className="w-full text-xs bg-slate-50 border border-line rounded px-2 py-1 text-slate-800"
                                          >
                                            {p.options?.map((o) => (
                                              <option key={o.value} value={o.value}>
                                                {o.label}
                                              </option>
                                            ))}
                                          </select>
                                        )}
                                        {p.type === 'classes' && (
                                          <div className="flex flex-wrap gap-1">
                                            {p.classOptions?.map((c) => {
                                              const sel = (cfg.params[p.key] as string[]) || (p.default as string[]) || [];
                                              const on = sel.includes(c);
                                              return (
                                                <button
                                                  key={c}
                                                  type="button"
                                                  onClick={() => {
                                                    const nextClasses = on ? sel.filter((x) => x !== c) : [...sel, c];
                                                    setFeatures({
                                                      ...features,
                                                      [f.key]: {
                                                        ...cfg,
                                                        params: { ...cfg.params, [p.key]: nextClasses },
                                                      },
                                                    });
                                                  }}
                                                  className={clsx(
                                                    "text-[10px] px-1.5 py-0.5 rounded border font-mono transition",
                                                    on ? "bg-blue-50 border-blue-400 text-blue-700 font-semibold" : "bg-slate-100 border-line text-slate-600 hover:bg-slate-200"
                                                  )}
                                                >
                                                  {c}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    ))}

                                    {(f.key === 'face_recognition' || f.key === 'face_detection') && (
                                      <div className="mt-3 pt-2 border-t border-line">
                                        <TargetMatcherUI />
                                      </div>
                                    )}

                                    {f.requiresGeometry && (
                                      <div className="flex items-center justify-between pt-1">
                                        <span className={clsx("text-[10px] font-medium", bound.length ? "text-ok" : "text-warn")}>
                                          {bound.length ? `${bound.length} ${f.requiresGeometry}(s) drawn` : `Needs a ${f.requiresGeometry}`}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleBindAndDraw(f)}
                                          className="text-[10px] flex items-center gap-1 text-accent hover:underline font-semibold"
                                        >
                                          <Pencil size={11} /> Draw {f.drawTool?.label || f.requiresGeometry}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-slate-500">Select an AI profile to configure.</div>
        )}
      </aside>

    </div>
  );
};

export default AdminStudio;
