import { useEffect, useState, useRef, useCallback } from "react";
import {
  Video,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Trash,
  Plus,
  Send,
  ChevronDown,
  ChevronRight,
  PenTool,
  Square,
  Circle as CircleIcon,
  Minus,
  MousePointer2,
  Car,
  Shield,
  Factory,
  Boxes,
  Pencil,
  AlertCircle,
} from "lucide-react";
import clsx from "clsx";
import { getSupabase } from "../lib/session";
import { fnErrorMessage } from "../lib/fnError";
import { isEngineOnline, mjpegStreamUrl } from "../lib/localEngine";
import {
  ZONE_PROFILES,
  PROFILE_ORDER,
  buildDefaultFeatures,
  reconcileFeatures,
  type ZoneProfileKey,
  type ProfileFeatures,
  type FeatureDef,
  type FeatureParam,
  type FeatureGroup,
} from "../lib/zoneProfiles";

interface Camera {
  id: string;
  name: string;
  source_type: string;
  status: string;
  zone_profile?: ZoneProfileKey | null;
  zones?: string;
  lines?: string;
}

interface Drawing {
  id: string;
  org_id: string;
  camera_id: string;
  name: string;
  type: "polygon" | "rectangle" | "circle" | "line";
  purpose: string;
  profile?: string | null;
  feature_key?: string | null;
  points: number[][];
  properties: Record<string, any>;
  is_draft: boolean;
}

interface Rule {
  id: string;
  name: string;
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
  status: "active" | "rolled_back";
}

type DrawMode = "view" | "polygon" | "rectangle" | "circle" | "line";

interface DrawBinding {
  featureKey: string | null;
  featureLabel: string;
  purpose: string;
}

const PROFILE_ICON: Record<ZoneProfileKey, typeof Car> = {
  traffic: Car,
  security: Shield,
  factory: Factory,
  custom: Boxes,
};

// Tailwind accent → concrete classes (kept explicit so the compiler keeps them).
const ACCENT: Record<string, { text: string; bg: string; border: string; ring: string }> = {
  sky: { text: "text-sky-400", bg: "bg-sky-500/15", border: "border-sky-500/60", ring: "ring-sky-500/40" },
  rose: { text: "text-rose-400", bg: "bg-rose-500/15", border: "border-rose-500/60", ring: "ring-rose-500/40" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/60", ring: "ring-amber-500/40" },
  violet: { text: "text-violet-400", bg: "bg-violet-500/15", border: "border-violet-500/60", ring: "ring-violet-500/40" },
};

export default function AdminStudio({ onDeactivated }: { onDeactivated: () => void }) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selectedCam, setSelectedCam] = useState<Camera | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);

  const [activeProfile, setActiveProfile] = useState<ZoneProfileKey | null>(null);
  const [features, setFeatures] = useState<ProfileFeatures>({});
  const [configId, setConfigId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const [drawMode, setDrawMode] = useState<DrawMode>("view");
  const [drawBinding, setDrawBinding] = useState<DrawBinding | null>(null);
  const [activePoints, setActivePoints] = useState<number[][]>([]);
  const [editingDrawingId, setEditingDrawingId] = useState<string | null>(null);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Alert rule builder
  const [ruleName, setRuleName] = useState("");
  const [ruleTrigger, setRuleTrigger] = useState("zone_intrusion");
  const [ruleSourceId, setRuleSourceId] = useState("");
  const [ruleAction, setRuleAction] = useState("alert");

  const [publishComment, setPublishComment] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- initial load with real-time subscriptions -----------------------
  useEffect(() => {
    let active = true;
    let channel: any = null;

    async function loadData() {
      const sb = await getSupabase();
      // Must filter by the signed-in user: profiles_read (0001) exposes every
      // profile in the org, so an unfiltered .single() sees N rows and fails
      // with PGRST116 the moment an org has a second user — silently leaving
      // orgId null, which then blocks publishing.
      const { data: auth } = await sb.auth.getUser();
      if (!active) return;
      if (!auth?.user) { console.error("[AdminStudio] no authenticated user; cannot resolve org"); return; }
      const { data: profile, error: profErr } = await sb
        .from("profiles").select("org_id").eq("id", auth.user.id).maybeSingle();
      if (!active) return;
      if (profErr) console.error("[AdminStudio] org lookup failed", profErr);
      if (profile?.org_id) setOrgId(profile.org_id);

      const { data: cams } = await sb.from("cameras").select("*");
      if (!active) return;
      if (cams) {
        setCameras(cams);
        setSelectedCam((prev) => {
          if (prev && cams.some((c) => c.id === prev.id)) {
            // Keep the selected camera intact, but update its fields
            return cams.find((c) => c.id === prev.id) || prev;
          }
          return cams.length > 0 ? cams[0] : null;
        });
      }
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (!active) return;
      if (vers) setVersions(vers);
    }

    loadData();

    // Subscribe to real-time additions/edits of cameras & configs
    getSupabase().then((sb) => {
      if (!active) return;
      channel = sb.channel("admin-studio-sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, () => {
          loadData();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "config_versions" }, () => {
          loadData();
        })
        .subscribe();
    });

    isEngineOnline().then((online) => active && setEngineOnline(online));
    const interval = setInterval(() => {
      isEngineOnline().then((online) => active && setEngineOnline(online));
    }, 10_000);

    return () => {
      active = false;
      clearInterval(interval);
      if (channel) {
        getSupabase().then((sb) => sb.removeChannel(channel));
      }
    };
  }, []);

  // ---- per-camera load: drawings, rules, profile config ----
  const loadProfileConfig = useCallback(async (cam: Camera, profileKey: ZoneProfileKey) => {
    const sb = await getSupabase();
    const { data: cfg } = await sb
      .from("zone_profile_configs")
      .select("*")
      .eq("camera_id", cam.id)
      .eq("profile", profileKey)
      .is("deleted_at", null)
      .maybeSingle();

    if (cfg) {
      setConfigId(cfg.id);
      setFeatures(reconcileFeatures(profileKey, cfg.features));
    } else {
      // Create a fresh draft config from catalog defaults.
      const defaults = buildDefaultFeatures(profileKey);
      const { data: created } = await sb
        .from("zone_profile_configs")
        .insert([{ org_id: orgId, camera_id: cam.id, profile: profileKey, features: defaults, is_draft: true }])
        .select()
        .single();
      setConfigId(created?.id ?? null);
      setFeatures(defaults);
    }
  }, [orgId]);

  useEffect(() => {
    if (!selectedCam) return;
    const cam = selectedCam;
    async function loadCamData() {
      const sb = await getSupabase();
      const { data: draws } = await sb.from("analytics_drawings").select("*").eq("camera_id", cam.id).is("deleted_at", null);
      setDrawings(draws ?? []);
      const { data: ruleList } = await sb.from("rule_engine_rules").select("*").eq("camera_id", cam.id).is("deleted_at", null);
      setRules(ruleList ?? []);

      const prof = (cam.zone_profile as ZoneProfileKey) || null;
      setActiveProfile(prof);
      if (prof) await loadProfileConfig(cam, prof);
      else { setFeatures({}); setConfigId(null); }
    }
    loadCamData();
    setActivePoints([]);
    setDrawMode("view");
    setDrawBinding(null);
    setEditingDrawingId(null);
  }, [selectedCam, loadProfileConfig]);

  // ---- profile selection -----------------------------------
  async function selectProfile(profileKey: ZoneProfileKey) {
    if (!selectedCam) return;
    setActiveProfile(profileKey);
    setActivePoints([]);
    setDrawMode("view");
    setDrawBinding(null);

    const sb = await getSupabase();
    await sb.from("cameras").update({ zone_profile: profileKey }).eq("id", selectedCam.id);
    setCameras((prev) => prev.map((c) => (c.id === selectedCam.id ? { ...c, zone_profile: profileKey } : c)));
    setSelectedCam((prev) => (prev ? { ...prev, zone_profile: profileKey } : prev));
    await loadProfileConfig(selectedCam, profileKey);
  }

  // ---- feature config persistence (debounced) --------------
  const persistFeatures = useCallback((next: ProfileFeatures) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSavingConfig(true);
    saveTimer.current = setTimeout(async () => {
      try {
        const sb = await getSupabase();
        if (configId) {
          await sb.from("zone_profile_configs").update({ features: next, is_draft: true }).eq("id", configId);
        } else if (selectedCam && activeProfile) {
          const { data } = await sb
            .from("zone_profile_configs")
            .upsert(
              { org_id: orgId, camera_id: selectedCam.id, profile: activeProfile, features: next, is_draft: true },
              { onConflict: "camera_id,profile" },
            )
            .select()
            .single();
          if (data?.id) setConfigId(data.id);
        }
      } catch (e) {
        console.error("Failed to persist feature config:", e);
      } finally {
        setSavingConfig(false);
      }
    }, 600);
  }, [configId, selectedCam, activeProfile, orgId]);

  function updateFeature(featureKey: string, updater: (v: ProfileFeatures[string]) => ProfileFeatures[string]) {
    setFeatures((prev) => {
      const current = prev[featureKey] ?? { enabled: false, params: {} };
      const next = { ...prev, [featureKey]: updater(current) };
      persistFeatures(next);
      return next;
    });
  }

  const toggleFeature = (key: string) => updateFeature(key, (v) => ({ ...v, enabled: !v.enabled }));
  const setParam = (key: string, paramKey: string, value: unknown) =>
    updateFeature(key, (v) => ({ ...v, params: { ...v.params, [paramKey]: value } }));

  // ---- canvas rendering ------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const accent = activeProfile ? ACCENT[ZONE_PROFILES[activeProfile].accent] : ACCENT.sky;
    const hex = accent === ACCENT.sky ? "#38bdf8" : accent === ACCENT.rose ? "#fb7185" : accent === ACCENT.amber ? "#fbbf24" : "#a78bfa";

    // in-progress geometry
    if (activePoints.length > 0) {
      ctx.strokeStyle = hex;
      ctx.fillStyle = hex + "26";
      ctx.lineWidth = 2.5;
      if (drawMode === "circle" && activePoints.length >= 1) {
        const [cx, cy] = activePoints[0];
        const edge = activePoints[1] ?? activePoints[0];
        const r = Math.hypot((edge[0] - cx) * canvas.width, (edge[1] - cy) * canvas.height);
        ctx.beginPath();
        ctx.arc(cx * canvas.width, cy * canvas.height, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        activePoints.forEach(([nx, ny], idx) => {
          const x = nx * canvas.width, y = ny * canvas.height;
          idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        if (drawMode !== "line" && activePoints.length > 2) { ctx.closePath(); ctx.fill(); }
        ctx.stroke();
        activePoints.forEach(([nx, ny]) => {
          ctx.fillStyle = hex;
          ctx.beginPath();
          ctx.arc(nx * canvas.width, ny * canvas.height, 4, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // saved geometries
    drawings.forEach((d) => {
      if (!d.points?.length) return;
      const editing = editingDrawingId === d.id;
      ctx.strokeStyle = editing ? "#a855f7" : d.properties?.color || "#f43f5e";
      ctx.fillStyle = editing ? "rgba(168,85,247,0.2)" : d.properties?.fillColor || "rgba(244,63,94,0.12)";
      ctx.lineWidth = editing ? 3 : 2;

      if (d.type === "circle" && d.points.length >= 2) {
        const [cx, cy] = d.points[0];
        const r = Math.hypot((d.points[1][0] - cx) * canvas.width, (d.points[1][1] - cy) * canvas.height);
        ctx.beginPath();
        ctx.arc(cx * canvas.width, cy * canvas.height, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        d.points.forEach(([nx, ny], idx) => {
          const x = nx * canvas.width, y = ny * canvas.height;
          idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        if (d.type !== "line") { ctx.closePath(); ctx.fill(); }
        ctx.stroke();
      }

      const first = d.points[0];
      ctx.font = "bold 10px Inter, sans-serif";
      ctx.fillStyle = editing ? "#a855f7" : d.properties?.color || "#f43f5e";
      ctx.fillText(d.name, first[0] * canvas.width, first[1] * canvas.height - 8);
    });
  }, [drawings, activePoints, drawMode, editingDrawingId, activeProfile]);

  // ---- drawing interaction ---------------------------------
  function beginDraw(mode: DrawMode, binding: DrawBinding) {
    setDrawMode(mode);
    setDrawBinding(binding);
    setActivePoints([]);
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode === "view") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const point = [
      Number(((e.clientX - rect.left) / rect.width).toFixed(4)),
      Number(((e.clientY - rect.top) / rect.height).toFixed(4)),
    ];

    if (drawMode === "line") {
      activePoints.length === 0 ? setActivePoints([point]) : saveDrawing([...activePoints, point]);
    } else if (drawMode === "circle") {
      activePoints.length === 0 ? setActivePoints([point]) : saveDrawing([activePoints[0], point]);
    } else if (drawMode === "rectangle") {
      if (activePoints.length === 0) setActivePoints([point]);
      else {
        const [s] = activePoints;
        saveDrawing([[s[0], s[1]], [point[0], s[1]], [point[0], point[1]], [s[0], point[1]]]);
      }
    } else if (drawMode === "polygon") {
      if (activePoints.length >= 3) {
        const [s] = activePoints;
        if (Math.hypot(s[0] - point[0], s[1] - point[1]) < 0.04) { saveDrawing(activePoints); return; }
      }
      setActivePoints([...activePoints, point]);
    }
  };

  const saveDrawing = async (pts: number[][]) => {
    if (!selectedCam || !orgId) return;
    const sb = await getSupabase();
    const type: Drawing["type"] = drawMode === "line" ? "line" : drawMode === "rectangle" ? "rectangle" : drawMode === "circle" ? "circle" : "polygon";
    const binding = drawBinding ?? { featureKey: null, featureLabel: "Zone", purpose: "custom_zone" };
    const accentHex = activeProfile ? { sky: "#38bdf8", rose: "#fb7185", amber: "#fbbf24", violet: "#a78bfa" }[ZONE_PROFILES[activeProfile].accent] : "#10b981";

    const newDrawing = {
      org_id: orgId,
      camera_id: selectedCam.id,
      name: `${binding.featureLabel} ${drawings.filter((d) => d.feature_key === binding.featureKey).length + 1}`,
      type,
      purpose: binding.purpose,
      profile: activeProfile,
      feature_key: binding.featureKey,
      points: pts,
      properties: { color: accentHex, fillColor: accentHex + "1f" },
      is_draft: true,
    };

    try {
      const { data, error } = await sb.from("analytics_drawings").insert([newDrawing]).select();
      if (error) throw error;
      if (data) setDrawings((prev) => [...prev, data[0] as Drawing]);
    } catch (e) {
      console.error("Failed to insert drawing:", e);
    }
    setActivePoints([]);
    setDrawMode("view");
    setDrawBinding(null);
  };

  const deleteDrawing = async (id: string) => {
    const sb = await getSupabase();
    try {
      await sb.from("analytics_drawings").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      setDrawings((prev) => prev.filter((d) => d.id !== id));
      await sb.from("rule_engine_rules").update({ deleted_at: new Date().toISOString() }).eq("trigger_source_id", id);
      setRules((prev) => prev.filter((r) => r.trigger_source_id !== id));
    } catch (e) { console.error(e); }
  };

  // ---- alert rules -----------------------------------------
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCam || !orgId || !ruleName.trim() || !ruleSourceId) return;
    const sb = await getSupabase();
    const newRule = {
      org_id: orgId,
      camera_id: selectedCam.id,
      name: ruleName,
      trigger_type: ruleTrigger,
      trigger_source_id: ruleSourceId,
      conditions: { profile: activeProfile },
      actions: [ruleAction],
      is_draft: true,
      is_enabled: true,
    };
    try {
      const { data, error } = await sb.from("rule_engine_rules").insert([newRule]).select();
      if (error) throw error;
      if (data) { setRules((prev) => [...prev, data[0] as Rule]); setRuleName(""); setRuleSourceId(""); }
    } catch (e) { console.error(e); }
  };

  const deleteRule = async (id: string) => {
    const sb = await getSupabase();
    try {
      await sb.from("rule_engine_rules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (e) { console.error(e); }
  };

  // ---- publish / rollback ----------------------------------
  const publishConfig = async () => {
    if (!orgId) { alert("Publishing failed: your organization is still loading. Retry in a moment."); return; }
    setPublishing(true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.functions.invoke("publish-config", {
        body: { org_id: orgId, comment: publishComment || "Configuration update" },
      });
      if (error) throw error;
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (vers) setVersions(vers);
      setDrawings((prev) => prev.map((d) => ({ ...d, is_draft: false })));
      setRules((prev) => prev.map((r) => ({ ...r, is_draft: false })));
      setPublishComment("");
      alert("Configuration published. Cameras are hot-swapping live.");
    } catch (e: any) {
      alert(await fnErrorMessage("Publishing", e));
    } finally { setPublishing(false); }
  };

  const rollbackConfig = async (version: number) => {
    if (!confirm(`Roll back to version ${version}? This overwrites current drafts.`)) return;
    if (!orgId) { alert("Rollback failed: your organization is still loading. Retry in a moment."); return; }
    setPublishing(true);
    try {
      const sb = await getSupabase();
      const { error } = await sb.functions.invoke("rollback-config", { body: { org_id: orgId, version } });
      if (error) throw error;
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (vers) setVersions(vers);
      if (selectedCam) {
        const cam = selectedCam;
        const { data: draws } = await sb.from("analytics_drawings").select("*").eq("camera_id", cam.id).is("deleted_at", null);
        setDrawings(draws ?? []);
        const { data: ruleList } = await sb.from("rule_engine_rules").select("*").eq("camera_id", cam.id).is("deleted_at", null);
        setRules(ruleList ?? []);
        const prof = (cam.zone_profile as ZoneProfileKey) || null;
        if (prof) await loadProfileConfig(cam, prof);
      }
      alert(`Rolled back to version ${version}.`);
    } catch (e: any) {
      alert(await fnErrorMessage("Rollback", e));
    } finally { setPublishing(false); }
  };

  // ---- param editor ----------------------------------------
  function renderParam(featureKey: string, p: FeatureParam, value: unknown) {
    if (p.type === "toggle") {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!value} onChange={(e) => setParam(featureKey, p.key, e.target.checked)} />
          <span className="text-[11px] text-zinc-300">{p.label}</span>
        </label>
      );
    }
    if (p.type === "slider") {
      const v = typeof value === "number" ? value : (p.default as number);
      return (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-zinc-400">
            <span>{p.label}</span>
            <span className="font-mono text-zinc-300">{v}{p.unit ? ` ${p.unit}` : ""}</span>
          </div>
          <input type="range" min={p.min} max={p.max} step={p.step} value={v}
            onChange={(e) => setParam(featureKey, p.key, Number(e.target.value))} className="w-full accent-current" />
        </div>
      );
    }
    if (p.type === "number") {
      const v = typeof value === "number" ? value : (p.default as number);
      return (
        <label className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-400">{p.label}</span>
          <div className="flex items-center gap-1">
            <input type="number" min={p.min} max={p.max} step={p.step} value={v}
              onChange={(e) => setParam(featureKey, p.key, Number(e.target.value))}
              className="w-20 text-xs bg-surface-2 border border-line rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-accent" />
            {p.unit && <span className="text-[10px] text-zinc-500">{p.unit}</span>}
          </div>
        </label>
      );
    }
    if (p.type === "schedule") {
      return (
        <label className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-400">{p.label}</span>
          <input type="time" value={String(value ?? p.default)}
            onChange={(e) => setParam(featureKey, p.key, e.target.value)}
            className="text-xs bg-surface-2 border border-line rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-accent" />
        </label>
      );
    }
    if (p.type === "select") {
      return (
        <label className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-zinc-400">{p.label}</span>
          <select value={String(value ?? p.default)} onChange={(e) => setParam(featureKey, p.key, e.target.value)}
            className="text-xs bg-surface-2 border border-line rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-accent max-w-[60%]">
            {p.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      );
    }
    if (p.type === "classes") {
      const sel: string[] = Array.isArray(value) ? (value as string[]) : (p.default as string[]);
      return (
        <div className="space-y-1">
          <span className="text-[10px] text-zinc-400">{p.label}</span>
          <div className="flex flex-wrap gap-1">
            {p.classOptions?.map((c) => {
              const on = sel.includes(c);
              return (
                <button key={c} type="button"
                  onClick={() => setParam(featureKey, p.key, on ? sel.filter((x) => x !== c) : [...sel, c])}
                  className={clsx("text-[10px] px-1.5 py-0.5 rounded border font-mono transition",
                    on ? "bg-accent/20 border-accent/50 text-accent" : "bg-surface-2 border-line text-zinc-500 hover:text-zinc-300")}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  }

  // ---- feature card ----------------------------------------
  function drawBindingFor(f: FeatureDef): DrawBinding | null {
    if (!f.requiresGeometry) return null;
    const purpose = f.requiresGeometry === "line" ? "counting_line" : f.requiresGeometry === "direction" ? "direction" : f.key;
    return { featureKey: f.key, featureLabel: f.label, purpose };
  }
  function drawModeFor(f: FeatureDef): DrawMode {
    if (f.requiresGeometry === "line" || f.requiresGeometry === "direction") return "line";
    return "polygon";
  }

  function renderFeatureCard(f: FeatureDef) {
    const cfg = features[f.key] ?? { enabled: false, params: {} };
    const bound = drawings.filter((d) => d.feature_key === f.key);
    // No model in this build can produce what the feature claims. The switch is
    // held off rather than left live: an operator who turns on "Fire Detection"
    // and sees it go green will believe a fire raises an alarm. Until 2026-07-17
    // it did go green — and answered with a colour threshold that read concrete
    // as smoke on every frame. See FeatureDef.unavailable.
    const blocked = !!f.unavailable;
    // Two different messages to a buyer: "coming soon" is scheduled work with a
    // licence-clean model already evaluated; "no model" is an open problem with
    // nothing suitable to build from. Collapsing them would overstate one and
    // understate the other.
    const soon = f.status === "coming-soon";

    return (
      <div key={f.key} className={clsx("rounded border p-2.5 transition",
        blocked ? "border-line/40 bg-surface-0/20" : cfg.enabled ? "border-line bg-surface-0" : "border-line/60 bg-surface-0/40")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={clsx("text-xs font-semibold", blocked ? "text-zinc-500" : "text-zinc-200")}>{f.label}</span>
              {blocked && (
                <span className={clsx(
                  "rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide",
                  soon ? "bg-sky-500/15 text-sky-400" : "bg-warn/15 text-warn",
                )}>
                  {soon ? "coming soon" : "no model"}
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 leading-snug mt-0.5">{f.description}</p>
            {blocked && (
              <p className={clsx("mt-1 text-[10px] leading-snug", soon ? "text-sky-400/80" : "text-warn/80")}>
                {f.unavailable}
              </p>
            )}
          </div>
          <button type="button" disabled={blocked}
            onClick={() => { if (!blocked) toggleFeature(f.key); }}
            title={blocked ? f.unavailable : undefined}
            className={clsx("relative h-5 w-9 rounded-full transition shrink-0",
              blocked ? "cursor-not-allowed bg-surface-3/50" : cfg.enabled ? "bg-accent" : "bg-surface-3")}>
            <span className={clsx("absolute top-0.5 h-4 w-4 rounded-full transition-all",
              blocked ? "bg-zinc-600 left-0.5" : "bg-white", !blocked && cfg.enabled ? "left-[18px]" : "left-0.5")} />
          </button>
        </div>

        {cfg.enabled && !blocked && (
          <div className="mt-2.5 space-y-2 pt-2 border-t border-line">
            {f.params.map((p) => <div key={p.key}>{renderParam(f.key, p, cfg.params[p.key])}</div>)}

            {f.requiresGeometry && (
              <div className="flex items-center justify-between pt-1">
                <span className={clsx("text-[10px]", bound.length ? "text-ok" : "text-warn")}>
                  {bound.length ? `${bound.length} ${f.requiresGeometry}(s) drawn` : `Needs a ${f.requiresGeometry}`}
                </span>
                <button type="button"
                  onClick={() => { const b = drawBindingFor(f); if (b) beginDraw(drawModeFor(f), b); }}
                  className="text-[10px] flex items-center gap-1 text-accent hover:underline">
                  <Pencil size={11} /> Draw {f.requiresGeometry}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- special panels --------------------------------------
  function renderRoiPanel() {
    return (
      <div className="space-y-2">
        <p className="text-[10px] text-zinc-500">
          Draw geometries with the toolbar above, or the <b>Draw</b> button on any feature. Drawn shapes bind to features and compile into the camera on publish.
        </p>
        <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Geometries ({drawings.length})</div>
        {drawings.length === 0 ? (
          <div className="text-xs text-zinc-500 italic">No shapes yet.</div>
        ) : drawings.map((d) => (
          <div key={d.id} onClick={() => setEditingDrawingId(editingDrawingId === d.id ? null : d.id)}
            className={clsx("p-2 rounded border text-xs flex justify-between items-center cursor-pointer",
              editingDrawingId === d.id ? "bg-accent/10 border-accent" : "bg-surface-0 border-line hover:border-zinc-700")}>
            <div className="min-w-0">
              <div className="font-semibold text-zinc-200 truncate">{d.name}</div>
              <div className="text-[9px] text-zinc-500 font-mono capitalize">{d.type} • {d.feature_key || d.purpose}</div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); deleteDrawing(d.id); }} className="text-zinc-500 hover:text-danger p-1">
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  function renderAlertsPanel() {
    return (
      <div className="space-y-3">
        <form onSubmit={handleAddRule} className="space-y-2.5 p-2.5 rounded border border-line bg-surface-0">
          <input type="text" placeholder="Rule name (e.g. Intruder alert)" value={ruleName} onChange={(e) => setRuleName(e.target.value)}
            className="w-full text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-accent" required />
          <div className="grid grid-cols-2 gap-2">
            <select value={ruleTrigger} onChange={(e) => setRuleTrigger(e.target.value)}
              className="text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none">
              <option value="zone_intrusion">Zone entered</option>
              <option value="line_crossing">Line crossed</option>
              <option value="loitering">Loitering</option>
              <option value="speed_limit">Over speed limit</option>
              <option value="ppe_violation">PPE violation</option>
              <option value="fire_smoke">Fire / smoke</option>
              <option value="custom">Custom event</option>
            </select>
            <select value={ruleSourceId} onChange={(e) => setRuleSourceId(e.target.value)}
              className="text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none" required>
              <option value="">-- Source shape --</option>
              {drawings.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 items-center">
            <select value={ruleAction} onChange={(e) => setRuleAction(e.target.value)}
              className="text-xs bg-surface-2 border border-line rounded px-2 py-1.5 text-zinc-200 focus:outline-none">
              <option value="alert">Send alert</option>
              <option value="record">Record clip</option>
              <option value="webhook">Webhook</option>
            </select>
            <button type="submit" className="btn-accent py-1.5 text-xs flex items-center justify-center gap-1">
              <Plus size={12} /> Add rule
            </button>
          </div>
        </form>
        <div className="space-y-1.5">
          {rules.length === 0 && <div className="text-xs text-zinc-500 italic">No alert rules yet.</div>}
          {rules.map((r) => (
            <div key={r.id} className="p-2 rounded bg-surface-0 border border-line text-xs flex justify-between items-start">
              <div className="min-w-0">
                <div className="font-semibold text-zinc-200">{r.name}</div>
                <p className="text-[9px] text-zinc-500">
                  {r.trigger_type} on {drawings.find((d) => d.id === r.trigger_source_id)?.name || "shape"} → {r.actions.join(", ")}
                </p>
              </div>
              <button onClick={() => deleteRule(r.id)} className="text-zinc-500 hover:text-danger p-1 shrink-0"><Trash size={12} /></button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- grouped feature rendering ---------------------------
  const profileDef = activeProfile ? ZONE_PROFILES[activeProfile] : null;
  const accent = profileDef ? ACCENT[profileDef.accent] : ACCENT.sky;

  function groupsForProfile(): FeatureGroup[] {
    if (!profileDef) return [];
    const present = new Set(profileDef.features.map((f) => f.group));
    return profileDef.groupOrder.filter((g) => present.has(g));
  }

  const drawTools: { mode: DrawMode; icon: typeof PenTool; label: string }[] = [
    { mode: "view", icon: MousePointer2, label: "Select" },
    { mode: "polygon", icon: PenTool, label: "Polygon" },
    { mode: "rectangle", icon: Square, label: "Rectangle" },
    { mode: "circle", icon: CircleIcon, label: "Circle" },
    { mode: "line", icon: Minus, label: "Line" },
  ];

  return (
    <div className="flex h-screen bg-surface-0 overflow-hidden font-sans">
      {/* Sidebar 1: cameras + publish timeline */}
      <aside className="w-64 border-r border-line bg-surface-1 flex flex-col justify-between shrink-0">
        <div className="flex flex-col flex-1 overflow-y-auto">
          <div className="flex items-center gap-2.5 px-4 py-4 border-b border-line">
            <img src="./favicon.svg" alt="CamAI" className="h-7 w-7 rounded-md" />
            <div>
              <div className="text-sm font-semibold text-zinc-100">CamAI Zone Studio</div>
              <div className="text-[10px] text-accent font-medium uppercase tracking-wider">Enterprise Profiles</div>
            </div>
          </div>
          <div className="px-3 py-3">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-2">
              <span>Cameras</span>
              <span className={`h-2 w-2 rounded-full ${engineOnline ? "bg-ok" : "bg-danger"}`} title={engineOnline ? "Engine Online" : "Engine Offline"} />
            </div>
            <div className="space-y-1">
              {cameras.map((c) => {
                const Icon = c.zone_profile ? PROFILE_ICON[c.zone_profile] : Video;
                return (
                  <button key={c.id} onClick={() => setSelectedCam(c)}
                    className={clsx("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs transition text-left",
                      selectedCam?.id === c.id ? "bg-accent/15 font-medium text-accent border-l-2 border-accent" : "text-zinc-400 hover:bg-surface-2 hover:text-zinc-200")}>
                    <Icon size={13} className="shrink-0" />
                    <span className="truncate">{c.name}</span>
                    {c.zone_profile && <span className="ml-auto text-[9px] uppercase text-zinc-500">{c.zone_profile}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-line p-3 bg-surface-2/30 space-y-3">
          <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Publish Timeline</div>
          <div className="max-h-40 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
            {versions.map((v) => (
              <div key={v.id} className="p-2 rounded bg-surface-0 border border-line text-[10px] space-y-1">
                <div className="flex justify-between font-mono font-semibold">
                  <span className="text-zinc-300">v{v.version}</span>
                  <span className={clsx("capitalize", v.status === "active" ? "text-ok" : "text-zinc-500")}>{v.status}</span>
                </div>
                {v.comment && <p className="text-zinc-400 truncate italic">"{v.comment}"</p>}
                {v.status === "active" && versions[0]?.version === v.version ? (
                  <span className="text-zinc-500 text-[9px] block">Currently Active</span>
                ) : (
                  <button onClick={() => rollbackConfig(v.version)} className="text-accent hover:underline text-[9px] font-medium flex items-center gap-0.5">
                    <RotateCcw size={9} /> Rollback here
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <input type="text" placeholder="Publish notes..." value={publishComment} onChange={(e) => setPublishComment(e.target.value)}
              className="w-full text-xs bg-surface-0 border border-line rounded px-2.5 py-1.5 text-zinc-200 focus:outline-none focus:border-accent" />
            <button onClick={publishConfig} disabled={publishing} className="w-full btn-accent flex items-center justify-center gap-1.5 py-1.5 text-xs">
              <Send size={12} />{publishing ? "Publishing..." : "Publish Configs"}
            </button>
          </div>
          <button onClick={onDeactivated} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 pt-1">Exit Studio</button>
        </div>
      </aside>

      {/* Main canvas */}
      <main className="flex-1 flex flex-col bg-surface-0 overflow-hidden relative">
        {/* Profile selector */}
        <div className="border-b border-line bg-surface-1 px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mr-1">Zone Profile</span>
            {PROFILE_ORDER.map((key) => {
              const def = ZONE_PROFILES[key];
              const Icon = PROFILE_ICON[key];
              const on = activeProfile === key;
              const a = ACCENT[def.accent];
              return (
                <button key={key} onClick={() => selectProfile(key)} disabled={!selectedCam}
                  className={clsx("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition",
                    on ? `${a.bg} ${a.text} ${a.border}` : "bg-surface-2 border-line text-zinc-400 hover:text-zinc-200",
                    !selectedCam && "opacity-40 cursor-not-allowed")}
                  title={def.description}>
                  <Icon size={14} /> {def.label}
                </button>
              );
            })}
            {savingConfig && <span className="ml-2 text-[10px] text-zinc-500">Saving…</span>}
          </div>
        </div>

        {/* Draw toolbar */}
        <div className="h-12 border-b border-line bg-surface-1 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-zinc-200">Draw:</span>
            <div className="flex rounded-md bg-surface-2 p-0.5 border border-line">
              {drawTools.map(({ mode, icon: Icon, label }) => (
                <button key={mode}
                  onClick={() => {
                    setActivePoints([]);
                    setDrawMode(mode);
                    setDrawBinding(mode === "view" ? null : { featureKey: null, featureLabel: activeProfile === "custom" ? "Custom Zone" : "Zone", purpose: mode === "line" ? "counting_line" : "custom_zone" });
                  }}
                  className={clsx("text-xs px-2.5 py-1 rounded flex items-center gap-1 transition",
                    drawMode === mode ? "bg-surface-0 text-accent font-medium" : "text-zinc-400 hover:text-zinc-200")}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {drawBinding && drawMode !== "view" && (
              <span className="text-[10px] text-zinc-400">Binding to: <b className="text-zinc-200">{drawBinding.featureLabel}</b></span>
            )}
            {activePoints.length > 0 && (drawMode === "polygon") && (
              <button onClick={() => saveDrawing(activePoints)} className="btn-accent text-xs px-3 py-1 flex items-center gap-1">
                <CheckCircle2 size={12} /> Close Shape
              </button>
            )}
          </div>
        </div>

        {/* Viewport */}
        <div className="flex-1 relative bg-surface-0 flex items-center justify-center p-4">
          {selectedCam ? (
            !activeProfile ? (
              <div className="text-center max-w-sm">
                <Boxes size={40} className="mx-auto text-zinc-600 mb-3" />
                <div className="text-sm font-semibold text-zinc-300 mb-1">Choose a Zone Profile</div>
                <p className="text-xs text-zinc-500">Pick Traffic, Security, Factory or Custom above to load its AI features for <b>{selectedCam.name}</b>.</p>
              </div>
            ) : (
              <div className="relative aspect-video max-h-full max-w-full rounded border border-line overflow-hidden shadow-2xl bg-zinc-950">
                {engineOnline ? (
                  <img src={mjpegStreamUrl(selectedCam.id)} alt="Live" className="h-full w-full object-contain pointer-events-none" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/90 text-zinc-500">
                    <Video size={36} />
                    <span className="text-xs">Live stream offline — drawing still works on the grid</span>
                  </div>
                )}
                <canvas ref={canvasRef} onClick={handleCanvasClick}
                  className={clsx("absolute inset-0 w-full h-full z-10", drawMode === "view" ? "cursor-default" : "cursor-crosshair")} />
              </div>
            )
          ) : (
            <div className="text-xs text-zinc-500">Select a camera to configure.</div>
          )}
        </div>
      </main>

      {/* Sidebar 2: dynamic feature config */}
      <aside className="w-96 border-l border-line bg-surface-1 flex flex-col shrink-0 overflow-y-auto">
        {profileDef ? (
          <>
            <div className={clsx("p-4 border-b border-line", accent.bg)}>
              <div className={clsx("flex items-center gap-2 font-semibold", accent.text)}>
                {(() => { const Icon = PROFILE_ICON[profileDef.key]; return <Icon size={16} />; })()}
                {profileDef.label} Profile
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">{profileDef.description}</p>
            </div>

            <div className="p-3 space-y-2">
              {groupsForProfile().map((group) => {
                const groupFeatures = profileDef.features.filter((f) => f.group === group);
                const isCollapsed = collapsed[`${profileDef.key}:${group}`];
                return (
                  <div key={group} className="rounded-lg border border-line bg-surface-2/40 overflow-hidden">
                    <button onClick={() => setCollapsed((c) => ({ ...c, [`${profileDef.key}:${group}`]: !isCollapsed }))}
                      className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300 hover:bg-surface-2">
                      <span>{group}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-zinc-500 font-normal normal-case">
                          {groupFeatures.filter((f) => features[f.key]?.enabled).length}/{groupFeatures.length}
                        </span>
                        {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                      </div>
                    </button>
                    {!isCollapsed && (
                      <div className="p-2.5 space-y-2 border-t border-line">
                        {groupFeatures.map((f) =>
                          f.kind === "roi_editor" ? <div key={f.key}>{renderRoiPanel()}</div>
                          : f.kind === "alerts" ? <div key={f.key}>{renderAlertsPanel()}</div>
                          : renderFeatureCard(f),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-xs text-zinc-500 flex-1 flex flex-col items-center justify-center gap-2">
            <AlertCircle size={20} className="text-zinc-600" />
            {selectedCam ? "Select a Zone Profile to configure this camera." : "Select a camera to begin."}
          </div>
        )}
      </aside>
    </div>
  );
}
