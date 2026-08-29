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
  Undo2,
  Redo2,
  Copy as CopyIcon,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Bell,
  Upload,
} from "lucide-react";
import clsx from "clsx";
import { getSupabase } from "../lib/session";
import { useAlertState } from "../components/alerts/AlertProvider";
import { fnErrorMessage } from "../lib/fnError";
import { isEngineOnline, mjpegStreamUrl, controlHeaders } from "../lib/localEngine";
import TargetMatcherUI from "../components/TargetMatcherUI";

import {
  History,
  circleRadiusPx,
  duplicateShape,
  hitVertex,
  isHidden,
  isInteractive,
  isLocked,
  moveVertex,
  topmostAt,
  translateShape,
  type EditableShape,
  type View,
} from "../lib/zoneEditor";
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
  micro_motion: Eye,
  custom: Boxes,
};

// Tailwind accent → concrete classes (kept explicit so the compiler keeps them).
const ACCENT: Record<string, { text: string; bg: string; border: string; ring: string }> = {
  sky: { text: "text-sky-400", bg: "bg-sky-500/15", border: "border-sky-500/60", ring: "ring-sky-500/40" },
  rose: { text: "text-rose-400", bg: "bg-rose-500/15", border: "border-rose-500/60", ring: "ring-rose-500/40" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/60", ring: "ring-amber-500/40" },
  violet: { text: "text-violet-400", bg: "bg-violet-500/15", border: "border-violet-500/60", ring: "ring-violet-500/40" },
};

export default function AdminStudio({
  orgId: initialOrgId,
  onDeactivated,
  onOpenAlerts,
}: {
  orgId?: string | null;
  onDeactivated: () => void;
  /** Bell click — jumps to Workspace's Alerts tab. Undefined would just hide
   *  the bell rather than render one that does nothing. */
  onOpenAlerts?: () => void;
}) {
  const { unacked: unackedAlerts } = useAlertState();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const camerasRef = useRef<Camera[]>([]);
  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);
  // Load state for the camera list so an empty sidebar is never a silent
  // mystery: distinguishes "still loading", "failed with an error", and
  // "genuinely no cameras yet" — the last three were all just a blank list.
  const [camsLoad, setCamsLoad] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [selectedCam, setSelectedCam] = useState<Camera | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [orgId, setOrgId] = useState<string | null>(initialOrgId ?? null);

  useEffect(() => {
    if (initialOrgId) {
      setOrgId(initialOrgId);
    }
  }, [initialOrgId]);

  const [activeProfile, setActiveProfile] = useState<ZoneProfileKey | null>(null);
  const [features, setFeatures] = useState<ProfileFeatures>({});
  const [configId, setConfigId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  const [drawMode, setDrawMode] = useState<DrawMode>("view");
  const [drawBinding, setDrawBinding] = useState<DrawBinding | null>(null);
  const [activePoints, setActivePoints] = useState<number[][]>([]);
  const [editingDrawingId, setEditingDrawingId] = useState<string | null>(null);

  // Custom Product Visual Registration State & Handlers
  const [customImages, setCustomImages] = useState<{ file: File; preview: string }[]>([]);
  const [customModelName, setCustomModelName] = useState("Cardboard Box");
  const [isTraining, setIsTraining] = useState(false);
  const [customModelsList, setCustomModelsList] = useState<Array<{ id: string; name: string; active: boolean; reference_count: number; created_at: number }>>([]);
  const [modelStatus, setModelStatus] = useState<{ registered: boolean; reference_count: number; timestamp: number | null }>({
    registered: false,
    reference_count: 0,
    timestamp: null,
  });
  const createdUrls = useRef<string[]>([]);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("http://localhost:8000/api/custom_models");
      if (res.ok) {
        const data = await res.json();
        setCustomModelsList(data.models || []);
      }
    } catch (err) {
      console.warn("Failed to fetch custom models:", err);
    }
  }, []);

  useEffect(() => {
    return () => {
      createdUrls.current.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      });
    };
  }, []);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files).map(file => {
      const url = URL.createObjectURL(file);
      createdUrls.current.push(url);
      return { file, preview: url };
    });
    setCustomImages(prev => [...prev, ...newFiles]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.dataTransfer.files) return;
    const newFiles = Array.from(e.dataTransfer.files).map(file => {
      const url = URL.createObjectURL(file);
      createdUrls.current.push(url);
      return { file, preview: url };
    });
    setCustomImages(prev => [...prev, ...newFiles]);
  };

  const removeImage = (index: number) => {
    setCustomImages(prev => {
      const updated = [...prev];
      try {
        URL.revokeObjectURL(updated[index].preview);
      } catch (e) {}
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleTrainAndSave = async () => {
    if (customImages.length < 1) {
      alert("Please upload at least 1 image to register the product.");
      return;
    }
    if (!customModelName.trim()) {
      alert("Please enter a model name (e.g. Cardboard Box).");
      return;
    }
    setIsTraining(true);
    try {
      const formData = new FormData();
      formData.append("name", customModelName.trim());
      customImages.forEach(img => {
        formData.append("files", img.file);
      });

      const res = await fetch("http://localhost:8000/api/custom_models/register", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(await res.text() || "Failed to register custom model.");
      }

      const data = await res.json();
      await fetchCustomModels();
      
      customImages.forEach(img => {
        try {
          URL.revokeObjectURL(img.preview);
        } catch (e) {}
      });
      setCustomImages([]);
      
      alert(`Success! Saved custom model '${data.model.name}' with ${data.registered_count} reference images. Model is now active on live streams.`);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to register custom model.");
    } finally {
      setIsTraining(false);
    }
  };

  const handleToggleModel = async (modelId: string, currentActive: boolean) => {
    try {
      const res = await fetch(`http://localhost:8000/api/custom_models/${modelId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !currentActive }),
      });
      if (res.ok) {
        fetchCustomModels();
      }
    } catch (err) {
      console.error("Failed to toggle model active state:", err);
    }
  };

  const handleDeleteModel = async (modelId: string, modelName: string) => {
    if (!confirm(`Are you sure you want to delete model '${modelName}'?`)) return;
    try {
      const res = await fetch(`http://localhost:8000/api/custom_models/${modelId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchCustomModels();
      }
    } catch (err) {
      console.error("Failed to delete model:", err);
    }
  };

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Alert rule builder
  const [ruleName, setRuleName] = useState("");
  const [ruleTrigger, setRuleTrigger] = useState("zone_intrusion");
  const [ruleSourceId, setRuleSourceId] = useState("");
  const [ruleAction, setRuleAction] = useState("alert");

  const [publishComment, setPublishComment] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  // The MJPEG <img> failing is a distinct state from the engine being down: the
  // engine can be healthy while this particular camera has no decoded frames.
  const [streamFailed, setStreamFailed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLImageElement>(null);

  // ---- direct-manipulation editor state --------------------------------
  // History holds SNAPSHOTS of the whole drawing set. Undo/redo then diffs two
  // snapshots and persists the difference (see persistSnapshot) — which works
  // for creates and deletes too, because deletion here is soft (deleted_at), so
  // "undo a delete" is just clearing that column rather than re-inserting a row
  // under a new id and orphaning any rule bound to the old one.
  const historyRef = useRef<History<Drawing[]> | null>(null);
  const clipboardRef = useRef<Drawing | null>(null);
  // Live drag state. A ref, not state: this updates on every pointermove and
  // re-rendering the whole studio at pointer rate would drop frames on the
  // MJPEG element behind the canvas.
  const dragRef = useRef<{
    kind: "move" | "vertex";
    id: string;
    vertexIndex: number;
    lastPt: number[];
    moved: boolean;
  } | null>(null);
  const [historyTick, setHistoryTick] = useState(0); // re-render undo/redo affordances
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- initial load with real-time subscriptions -----------------------
  useEffect(() => {
    let active = true;
    let channel: any = null;

    async function loadCameras() {
      const sb = await getSupabase();
      const { data: cams, error: camErr } = await sb.from("cameras").select("*");
      if (!active) return;
      if (camErr) {
        console.error("[AdminStudio] cameras load failed", camErr);
        setCamsLoad({ loading: false, error: camErr.message || "Could not load cameras." });
      } else {
        setCamsLoad({ loading: false, error: null });
      }
      if (cams) {
        setCameras(cams);
        setSelectedCam((prev) => {
          if (prev && cams.some((c) => c.id === prev.id)) {
            const fetched = cams.find((c) => c.id === prev.id) || prev;
            const savedProf = typeof localStorage !== "undefined" ? localStorage.getItem(`cam_profile_${prev.id}`) : null;
            const activeProf = savedProf || prev.zone_profile;
            return activeProf ? { ...fetched, zone_profile: activeProf } : fetched;
          }
          if (cams.length > 0) {
            const firstCam = cams[0];
            const savedProf = typeof localStorage !== "undefined" ? (localStorage.getItem(`cam_profile_${firstCam.id}`) as ZoneProfileKey | null) : null;
            return savedProf ? { ...firstCam, zone_profile: savedProf } : firstCam;
          }
          return null;
        });
      }
    }

    async function loadConfigVersions() {
      const sb = await getSupabase();
      const { data: vers } = await sb.from("config_versions").select("*").order("version", { ascending: false });
      if (!active) return;
      if (vers) setVersions(vers);
    }

    async function initializeStudio() {
      const sb = await getSupabase();
      try {
        const { data: auth } = await sb.auth.getUser();
        if (active && auth?.user) {
          const { data: profile, error: profErr } = await sb
            .from("profiles").select("org_id").eq("id", auth.user.id).maybeSingle();
          if (active && !profErr && profile?.org_id) {
            setOrgId(profile.org_id);
          }
        }
      } catch (e) {
        console.error("[AdminStudio] Failed to query auth session", e);
      }

      await Promise.all([loadCameras(), loadConfigVersions()]);
    }

    initializeStudio();

    // Subscribe to real-time additions/edits of cameras & configs
    getSupabase().then((sb) => {
      if (!active) return;
      channel = sb.channel("admin-studio-sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, (payload: any) => {
          if (payload.eventType === "UPDATE" && payload.new) {
            const currentCam = camerasRef.current.find(c => c.id === payload.new.id);
            if (currentCam) {
              const keysToCompare = ["name", "source_type", "zone_profile", "zones", "lines"] as const;
              const onlyStatusChanged = keysToCompare.every(key => {
                return JSON.stringify(payload.new[key]) === JSON.stringify(currentCam[key]);
              });
              if (onlyStatusChanged) {
                setCameras(prev => prev.map(c => c.id === payload.new.id ? { ...c, status: payload.new.status } : c));
                setSelectedCam(prev => prev && prev.id === payload.new.id ? { ...prev, status: payload.new.status } : prev);
                return;
              }
            }
          }
          loadCameras();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "config_versions" }, () => {
          loadConfigVersions();
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

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("http://localhost:8000/api/custom_model/status");
        if (res.ok) {
          const data = await res.json();
          setModelStatus(data);
        }
      } catch (err) {
        console.warn("Could not fetch custom model status in AdminStudio:", err);
      }
    }
    if (activeProfile === "custom" && selectedCam) {
      fetchStatus();
      fetchCustomModels();
    }
  }, [activeProfile, selectedCam, fetchCustomModels]);

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

  // A previous camera's dead stream must not poison the next one's viewport.
  useEffect(() => { setStreamFailed(false); }, [selectedCam?.id]);

  useEffect(() => {
    if (!selectedCam) return;
    const cam = selectedCam;
    async function loadCamData() {
      const sb = await getSupabase();
      const { data: draws } = await sb.from("analytics_drawings").select("*").eq("camera_id", cam.id).is("deleted_at", null);
      setDrawings(draws ?? []);
      // Undo must never reach across a camera switch into another camera's
      // shapes — that would "restore" geometry onto a camera it never belonged
      // to. Each camera's saved set is its own history root.
      seedHistory(draws ?? []);
      setEditingDrawingId(null);
      const { data: ruleList } = await sb.from("rule_engine_rules").select("*").eq("camera_id", cam.id).is("deleted_at", null);
      setRules(ruleList ?? []);

      const savedProf = typeof localStorage !== "undefined" ? (localStorage.getItem(`cam_profile_${cam.id}`) as ZoneProfileKey | null) : null;
      const prof = savedProf || (cam.zone_profile as ZoneProfileKey) || "micro_motion";
      setActiveProfile(prof);
      if (prof) {
        await loadProfileConfig(cam, prof);
        const defaults = buildDefaultFeatures(prof);
        syncEngineDirectly(defaults, prof);
      }
      else { setFeatures({}); setConfigId(null); }
    }
    loadCamData();
    setActivePoints([]);
    setDrawMode("view");
    setDrawBinding(null);
    setEditingDrawingId(null);
    // Key on the camera's stable ID, NOT the selectedCam object. The admin-studio
    // realtime channel calls loadData() on every `cameras` row change, and the
    // desktop reports camera health into cameras.status every 10s — so the
    // selectedCam OBJECT reference churns every ~10s even though the SAME camera
    // is still selected. Keying on the object re-ran this effect on that churn
    // and called setActivePoints([]) mid-draw, so a polygon you were placing
    // vanished before you could save it. The ID only changes on a real camera
    // switch, which is the only time the draft should actually be discarded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCam?.id]);

  // Instant engine sync (0ms delay for live real-time preview)
  const syncEngineDirectly = useCallback(
    (next: ProfileFeatures, profileOverride?: ZoneProfileKey) => {
      if (!selectedCam?.id) return;
      const targetProfile = profileOverride || activeProfile || "security";
      void (async () => {
        try {
          await fetch(`http://127.0.0.1:8000/api/cameras/${selectedCam.id}/config`, {
            method: "POST",
            headers: await controlHeaders(),
            body: JSON.stringify({
              zones: JSON.stringify(drawings.filter((d) => d.type !== "line")),
              lines: JSON.stringify(drawings.filter((d) => d.type === "line")),
              rules: JSON.stringify(rules),
              zone_profile: targetProfile,
              profile_features: JSON.stringify(next),
            }),
          });
        } catch {
          /* engine sync best effort */
        }
      })();
    },
    [selectedCam?.id, drawings, rules, activeProfile],
  );

  // ---- profile selection -----------------------------------
  async function selectProfile(profileKey: ZoneProfileKey) {
    if (!selectedCam) return;
    setActiveProfile(profileKey);
    setActivePoints([]);
    setDrawMode("view");
    setDrawBinding(null);

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(`cam_profile_${selectedCam.id}`, profileKey);
      }
    } catch {}

    const sb = await getSupabase();
    await sb.from("cameras").update({ zone_profile: profileKey }).eq("id", selectedCam.id);
    setCameras((prev) => prev.map((c) => (c.id === selectedCam.id ? { ...c, zone_profile: profileKey } : c)));
    setSelectedCam((prev) => (prev ? { ...prev, zone_profile: profileKey } : prev));
    await loadProfileConfig(selectedCam, profileKey);

    const defaults = buildDefaultFeatures(profileKey);
    syncEngineDirectly(defaults, profileKey);
  }

  // ---- feature config persistence (debounced) --------------
  const persistFeatures = useCallback(
    (next: ProfileFeatures) => {
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

          // Also trigger direct sync inside debounced save
          syncEngineDirectly(next);
        } catch (e) {
          console.error("Failed to persist feature config:", e);
        } finally {
          setSavingConfig(false);
        }
      }, 600);
    },
    [configId, selectedCam, activeProfile, orgId, syncEngineDirectly],
  );

  function updateFeature(featureKey: string, updater: (v: ProfileFeatures[string]) => ProfileFeatures[string]) {
    setFeatures((prev) => {
      const current = prev[featureKey] ?? { enabled: false, params: {} };
      const next = { ...prev, [featureKey]: updater(current) };
      syncEngineDirectly(next);
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
      if (isHidden(d as EditableShape)) return; // hidden means hidden
      const editing = editingDrawingId === d.id;
      const locked = isLocked(d as EditableShape);
      ctx.save();
      // A locked shape is still visible but visibly not editable, so an operator
      // who cannot drag it knows why instead of assuming the canvas is broken.
      if (locked) ctx.globalAlpha = 0.55;
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
      ctx.fillText(`${locked ? "🔒 " : ""}${d.name}`, first[0] * canvas.width, first[1] * canvas.height - 8);

      // Selection handles: the grab targets for resize. Drawn only for the
      // selected, unlocked shape — handles on every shape at once turns a busy
      // scene into confetti. hitVertex() uses an 8px tolerance, so these are
      // drawn at radius 5 to sit just inside their own hit area.
      if (editing && !locked) {
        const handles = d.type === "circle" ? d.points.slice(0, 2) : d.points;
        handles.forEach(([nx, ny], i) => {
          const hx = nx * canvas.width;
          const hy = ny * canvas.height;
          ctx.beginPath();
          ctx.arc(hx, hy, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#0f172a";
          ctx.fill();
          ctx.lineWidth = 2;
          // The circle's centre handle moves the whole shape; its rim handle
          // resizes. Different jobs, different colours.
          ctx.strokeStyle = d.type === "circle" && i === 0 ? "#a855f7" : "#facc15";
          ctx.stroke();
        });
      }
      ctx.restore();
    });
  }, [drawings, activePoints, drawMode, editingDrawingId, activeProfile]);

  // ---- editor: history + persistence -----------------------------------

  /** Reset history whenever the camera's saved set is (re)loaded, so undo can
   *  never reach back into a different camera's shapes. */
  const seedHistory = useCallback((initial: Drawing[]) => {
    historyRef.current = new History<Drawing[]>(initial);
    setHistoryTick((t) => t + 1);
  }, []);

  /** Record a new state and persist the difference from the previous one.
   *  Every mutation funnels through here so history and the database can't
   *  disagree about what the current shapes are. */
  const commit = useCallback(async (next: Drawing[]) => {
    const h = historyRef.current;
    const prev = h ? h.current : drawings;
    h?.push(next);
    setDrawings(next);
    setHistoryTick((t) => t + 1);
    await persistSnapshot(prev, next);
  }, [drawings]);

  async function persistSnapshot(prev: Drawing[], next: Drawing[]) {
    const sb = await getSupabase();
    const prevById = new Map(prev.map((d) => [d.id, d]));
    const nextById = new Map(next.map((d) => [d.id, d]));
    const now = new Date().toISOString();

    let rulesTouched = false;
    try {
      // Changed (geometry / name / flags)
      for (const d of next) {
        const before = prevById.get(d.id);
        if (!before) {
          // Present now, absent before: a re-instated shape (undo of a delete).
          await sb.from("analytics_drawings")
            .update({ deleted_at: null, points: d.points, name: d.name, properties: d.properties })
            .eq("id", d.id);
          // Bring its rules back with it. Deleting a shape cascades to the rules
          // bound to it (below), so undoing that delete has to restore them or
          // the shape returns silently disarmed — every alert it used to raise
          // gone, with nothing on screen saying so.
          await sb.from("rule_engine_rules").update({ deleted_at: null }).eq("trigger_source_id", d.id);
          rulesTouched = true;
          continue;
        }
        const changed =
          JSON.stringify(before.points) !== JSON.stringify(d.points) ||
          before.name !== d.name ||
          JSON.stringify(before.properties ?? {}) !== JSON.stringify(d.properties ?? {});
        if (changed) {
          await sb.from("analytics_drawings")
            .update({ points: d.points, name: d.name, properties: d.properties })
            .eq("id", d.id);
        }
      }
      // Removed — cascade to bound rules. A rule whose trigger_source_id points
      // at a deleted shape is a dangling reference the engine would compile and
      // then never be able to fire.
      for (const d of prev) {
        if (!nextById.has(d.id)) {
          await sb.from("analytics_drawings").update({ deleted_at: now }).eq("id", d.id);
          await sb.from("rule_engine_rules").update({ deleted_at: now }).eq("trigger_source_id", d.id);
          rulesTouched = true;
        }
      }

      if (rulesTouched && selectedCam) {
        const { data: ruleList } = await sb.from("rule_engine_rules")
          .select("*").eq("camera_id", selectedCam.id).is("deleted_at", null);
        setRules(ruleList ?? []);
      }
    } catch (e) {
      console.error("[AdminStudio] failed to persist shape change:", e);
    }
  }

  const undo = useCallback(async () => {
    const h = historyRef.current;
    if (!h?.canUndo) return;
    const prev = h.current;
    const next = h.undo();
    setDrawings(next);
    setHistoryTick((t) => t + 1);
    await persistSnapshot(prev, next);
  }, []);

  const redo = useCallback(async () => {
    const h = historyRef.current;
    if (!h?.canRedo) return;
    const prev = h.current;
    const next = h.redo();
    setDrawings(next);
    setHistoryTick((t) => t + 1);
    await persistSnapshot(prev, next);
  }, []);

  // ---- editor: shape operations ----------------------------------------

  const updateShape = useCallback((id: string, patch: Partial<Drawing>) => {
    void commit(drawings.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, [drawings, commit]);

  const toggleFlag = useCallback((id: string, flag: "locked" | "hidden") => {
    const d = drawings.find((x) => x.id === id);
    if (!d) return;
    updateShape(id, { properties: { ...(d.properties ?? {}), [flag]: !d.properties?.[flag] } });
  }, [drawings, updateShape]);

  const removeShape = useCallback((id: string) => {
    if (isLocked(drawings.find((d) => d.id === id) as EditableShape)) return;
    void commit(drawings.filter((d) => d.id !== id));
    if (editingDrawingId === id) setEditingDrawingId(null);
  }, [drawings, commit, editingDrawingId]);

  /** Duplicate needs a real row (the id is DB-generated), so this inserts first
   *  and only then records history — otherwise undo would target an id that
   *  does not exist yet. */
  const duplicate = useCallback(async (id: string) => {
    const src = drawings.find((d) => d.id === id);
    if (!src || !selectedCam || !orgId) return;
    const ghost = duplicateShape(src as EditableShape, "pending");
    const sb = await getSupabase();
    const { data, error } = await sb.from("analytics_drawings").insert([{
      org_id: orgId, camera_id: selectedCam.id, name: ghost.name, type: src.type,
      purpose: src.purpose, profile: src.profile, feature_key: src.feature_key,
      points: ghost.points, properties: ghost.properties, is_draft: true,
    }]).select();
    if (error || !data?.[0]) { console.error("[AdminStudio] duplicate failed:", error); return; }
    const created = data[0] as Drawing;
    historyRef.current?.push([...drawings, created]);
    setDrawings((prev) => [...prev, created]);
    setEditingDrawingId(created.id);
    setHistoryTick((t) => t + 1);
  }, [drawings, selectedCam, orgId]);

  // ---- editor: pointer interaction --------------------------------------

  const viewOf = (): View | null => {
    const c = canvasRef.current;
    return c ? { w: c.clientWidth, h: c.clientHeight } : null;
  };

  const pointFrom = (e: React.MouseEvent<HTMLCanvasElement>): number[] | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return [
      Number(((e.clientX - rect.left) / rect.width).toFixed(4)),
      Number(((e.clientY - rect.top) / rect.height).toFixed(4)),
    ];
  };

  const handlePointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawMode !== "view") return; // a draw tool is active; clicks build shapes
    const pt = pointFrom(e);
    const view = viewOf();
    if (!pt || !view) return;

    const selected = drawings.find((d) => d.id === editingDrawingId);
    // Prefer a handle on the ALREADY-selected shape: when shapes overlap, the
    // operator reaching for a vertex means that vertex, not whatever sits on top.
    if (selected && isInteractive(selected as EditableShape)) {
      const vi = hitVertex(selected as EditableShape, pt, view);
      if (vi !== null) {
        dragRef.current = { kind: "vertex", id: selected.id, vertexIndex: vi, lastPt: pt, moved: false };
        return;
      }
    }

    const hit = topmostAt(drawings as EditableShape[], pt, view);
    setEditingDrawingId(hit ? hit.id : null);
    if (hit) dragRef.current = { kind: "move", id: hit.id, vertexIndex: -1, lastPt: pt, moved: false };
  };

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pt = pointFrom(e);
    if (!pt) return;

    // Local state only while dragging; the database write happens once on
    // release. Persisting every pointermove would fire a request per pixel.
    setDrawings((prev) => prev.map((d) => {
      if (d.id !== drag.id) return d;
      const updated = drag.kind === "vertex"
        ? moveVertex(d as EditableShape, drag.vertexIndex, pt)
        : translateShape(d as EditableShape, pt[0] - drag.lastPt[0], pt[1] - drag.lastPt[1]);
      return { ...d, points: updated.points };
    }));
    drag.lastPt = pt;
    drag.moved = true;
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    // A click that selected without moving must not push a history entry, or
    // undo would appear to do nothing for one press per click.
    if (!drag?.moved) return;
    void commit(drawings);
  };

  // Keyboard: Delete / Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+C / Ctrl+V / Ctrl+D.
  // Ignored while typing in an input, or the rename field would eat them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (ctrl && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
      } else if (ctrl && e.key.toLowerCase() === "c" && editingDrawingId) {
        clipboardRef.current = drawings.find((d) => d.id === editingDrawingId) ?? null;
      } else if (ctrl && e.key.toLowerCase() === "v" && clipboardRef.current) {
        e.preventDefault();
        void duplicate(clipboardRef.current.id);
      } else if (ctrl && e.key.toLowerCase() === "d" && editingDrawingId) {
        e.preventDefault();
        void duplicate(editingDrawingId);
      } else if ((e.key === "Delete" || e.key === "Backspace") && editingDrawingId) {
        e.preventDefault();
        removeShape(editingDrawingId);
      } else if (e.key === "Escape") {
        setEditingDrawingId(null);
        setActivePoints([]);
        setDrawMode("view");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, duplicate, removeShape, editingDrawingId, drawings]);

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
      if (data) {
        // Record the creation so Ctrl+Z removes a shape just drawn. Pushed
        // directly rather than via commit(): the row already exists (the id is
        // DB-generated), so there is nothing further to persist and re-running
        // the diff would just re-write it.
        const created = data[0] as Drawing;
        setDrawings((prev) => {
          const nextSet = [...prev, created];
          historyRef.current?.push(nextSet);
          return nextSet;
        });
        setHistoryTick((t) => t + 1);
      }
    } catch (e) {
      console.error("Failed to insert drawing:", e);
    }
    setActivePoints([]);
    setDrawMode("view");
    setDrawBinding(null);
  };

  // deleteDrawing() lived here. It wrote straight to the database, so a delete
  // was invisible to the undo stack and unrecoverable. Deletion now goes through
  // removeShape -> commit -> persistSnapshot, which records history and cascades
  // to bound rules in both directions.

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
      if (selectedCam && activeProfile) {
        await sb.from("cameras").update({ zone_profile: activeProfile }).eq("id", selectedCam.id);
        syncEngineDirectly(features, activeProfile);
      }
      const { error } = await sb.functions.invoke("publish-config", {
        body: { org_id: orgId, comment: publishComment || "Configuration update" },
      });
      if (error) console.warn("Cloud publish sync warning:", error);
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
    // Prefer the feature's declared tool. Deriving purpose from requiresGeometry
    // alone stamped EVERY line as "counting_line" and every zone as the feature
    // key, so a stop line, a speed-gate calibration line and a counting line
    // were indistinguishable downstream — publish_config's compile step sorts
    // shapes into cameras.zones vs cameras.lines by exactly these purpose
    // strings, and analytics keys lane attribution off zoneType == "lane".
    const purpose = f.drawTool?.purpose
      ?? (f.requiresGeometry === "line" ? "counting_line" : f.requiresGeometry === "direction" ? "direction" : f.key);
    return { featureKey: f.key, featureLabel: f.drawTool?.label ?? f.label, purpose };
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
    // Any feature the engine cannot deliver yet is presented uniformly as
    // "coming soon" to operators — a public-facing product never advertises
    // that something has "no model". The internal status is still tracked on
    // FeatureDef for engineering, but the badge never surfaces that distinction.

    return (
      <div key={f.key} className={clsx("rounded border p-2.5 transition",
        blocked ? "border-line/40 bg-surface-0/20" : cfg.enabled ? "border-line bg-surface-0" : "border-line/60 bg-surface-0/40")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className={clsx("text-xs font-semibold", blocked ? "text-zinc-500" : "text-zinc-200")}>{f.label}</span>
              {blocked && (
                <span className="rounded bg-sky-500/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-sky-400">
                  coming soon
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-500 leading-snug mt-0.5">{f.description}</p>
            {blocked && (
              <p className="mt-1 text-[10px] leading-snug text-sky-400/80">
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
                  {/* Name the actual tool ("Draw Stop Line"), not the geometry
                      class ("Draw line") — the profile's tool set is the thing
                      the operator is looking for. */}
                  <Pencil size={11} /> Draw {f.drawTool?.label ?? f.requiresGeometry}
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
        ) : drawings.map((d) => {
          const locked = isLocked(d as EditableShape);
          const hidden = isHidden(d as EditableShape);
          return (
            <div key={d.id} onClick={() => setEditingDrawingId(editingDrawingId === d.id ? null : d.id)}
              className={clsx("p-2 rounded border text-xs cursor-pointer group/shape",
                editingDrawingId === d.id ? "bg-accent/10 border-accent" : "bg-surface-0 border-line hover:border-zinc-700",
                hidden && "opacity-50")}>
              <div className="flex justify-between items-center gap-1">
                <div className="min-w-0 flex-1">
                  {/* Rename in place. onBlur/Enter commits, so a half-typed name
                      never reaches the database on every keystroke. */}
                  <input
                    value={d.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDrawings((prev) => prev.map((x) => x.id === d.id ? { ...x, name: e.target.value } : x))}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== historyRef.current?.current.find((x) => x.id === d.id)?.name) updateShape(d.id, { name: v }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="w-full bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-accent font-semibold text-zinc-200 truncate outline-none px-0.5"
                  />
                  <div className="text-[9px] text-zinc-500 font-mono capitalize px-0.5">{d.type} • {d.feature_key || d.purpose}</div>
                </div>
                <div className="flex items-center shrink-0">
                  <button onClick={(e) => { e.stopPropagation(); toggleFlag(d.id, "hidden"); }}
                    title={hidden ? "Show" : "Hide"} className="p-1 text-zinc-500 hover:text-zinc-200">
                    {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); toggleFlag(d.id, "locked"); }}
                    title={locked ? "Unlock" : "Lock"} className={clsx("p-1 hover:text-zinc-200", locked ? "text-amber-400" : "text-zinc-500")}>
                    {locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); void duplicate(d.id); }}
                    title="Duplicate" className="p-1 text-zinc-500 hover:text-zinc-200">
                    <CopyIcon size={12} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); removeShape(d.id); }}
                    disabled={locked}
                    title={locked ? "Unlock to delete" : "Delete"}
                    className="p-1 text-zinc-500 hover:text-danger disabled:opacity-30 disabled:hover:text-zinc-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
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

  function renderCustomModelRegistrationPanel() {
    const activeCount = customModelsList.filter(m => m.active).length;
    return (
      <div className="space-y-3">
        {/* Upload & Train Card */}
        <div className="space-y-2.5 p-3 rounded border border-line bg-surface-0">
          <div className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">
            Train New Product Model
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-zinc-400 mb-1">Product Model Name</label>
            <input
              type="text"
              value={customModelName}
              onChange={(e) => setCustomModelName(e.target.value)}
              placeholder="e.g. Cardboard Box, Parle-G, Blue Bottle"
              className="w-full rounded border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-accent"
            />
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex flex-col items-center justify-center border border-dashed border-line rounded-lg p-3 bg-surface-2/40 hover:bg-surface-2/60 transition cursor-pointer relative"
            onClick={() => document.getElementById("studio-file-upload")?.click()}
          >
            <input
              id="studio-file-upload"
              type="file"
              multiple
              accept="image/jpeg,image/png"
              onChange={handleImageChange}
              className="hidden"
            />
            <Upload size={16} className="text-zinc-400 mb-1" />
            <span className="text-[11px] font-semibold text-zinc-300">Upload Reference Images</span>
            <span className="text-[9px] text-zinc-500 mt-0.5 text-center">
              Drag reference images here, or click to browse (JPEG/PNG)
            </span>
          </div>

          {/* Previews Grid */}
          {customImages.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px]">
                <span className="font-medium text-zinc-300">Selected Images ({customImages.length})</span>
                <button
                  type="button"
                  onClick={() => {
                    customImages.forEach(img => {
                      try {
                        URL.revokeObjectURL(img.preview);
                      } catch (e) {}
                    });
                    setCustomImages([]);
                  }}
                  className="text-danger hover:underline font-semibold"
                >
                  Clear All
                </button>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {customImages.map((img, i) => (
                  <div key={i} className="relative group aspect-square rounded overflow-hidden border border-line bg-surface-2">
                    <img src={img.preview} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(i);
                      }}
                      className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-150"
                    >
                      <Trash size={10} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Build & Save Button */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={handleTrainAndSave}
              disabled={isTraining || customImages.length === 0}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-accent px-3 py-2 text-xs font-semibold text-white shadow hover:bg-accent/80 transition disabled:opacity-50"
            >
              {isTraining ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Extracting Embeddings...</span>
                </>
              ) : (
                <span>Train & Save Model</span>
              )}
            </button>
          </div>
        </div>

        {/* Registered Models List */}
        <div className="space-y-2 p-3 rounded border border-line bg-surface-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">
              Registered Custom Models ({customModelsList.length})
            </span>
            <span className="text-[9px] font-medium text-ok">
              {activeCount} Active
            </span>
          </div>

          {customModelsList.length === 0 ? (
            <div className="text-[10px] text-zinc-500 py-3 text-center italic">
              No custom models trained yet. Upload images above to create one.
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {customModelsList.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-2 rounded border border-line bg-surface-2/40 hover:bg-surface-2/80 transition">
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-zinc-200 truncate">{m.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                        {m.reference_count} img{m.reference_count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">
                      ID: {m.id}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleModel(m.id, m.active)}
                      className={`px-2 py-0.5 text-[9px] font-semibold rounded transition ${
                        m.active ? "bg-ok/20 text-ok border border-ok/30" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {m.active ? "Active" : "Inactive"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteModel(m.id, m.name)}
                      className="text-zinc-500 hover:text-danger p-1 transition"
                      title="Delete Model"
                    >
                      <Trash size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom Target Image Upload & Vector Matcher Engine */}
        <div className="pt-2">
          <TargetMatcherUI />
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
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-zinc-100">CamAI Zone Studio</div>
              <div className="text-[10px] text-accent font-medium uppercase tracking-wider">Enterprise Profiles</div>
            </div>
            {/* Static, in-flow bell — never a floating overlay. Every alert is
                shown on Workspace's Alerts tab only; this just says how many
                are unacknowledged and jumps there. */}
            {onOpenAlerts && (
              <button
                onClick={onOpenAlerts}
                title={unackedAlerts > 0 ? `${unackedAlerts} unacknowledged alert${unackedAlerts === 1 ? "" : "s"}` : "Alerts"}
                className="relative shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-surface-2 hover:text-zinc-200"
              >
                <Bell size={16} />
                {unackedAlerts > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                    {unackedAlerts > 99 ? "99+" : unackedAlerts}
                  </span>
                )}
              </button>
            )}
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

              {/* Never leave the list silently blank — say which state it is. */}
              {cameras.length === 0 && camsLoad.loading && (
                <div className="px-2.5 py-2 text-[11px] text-zinc-500">Loading cameras…</div>
              )}
              {cameras.length === 0 && !camsLoad.loading && camsLoad.error && (
                <div className="px-2.5 py-2 text-[11px] leading-snug text-danger">
                  Couldn't load cameras: {camsLoad.error}
                </div>
              )}
              {cameras.length === 0 && !camsLoad.loading && !camsLoad.error && (
                <div className="px-2.5 py-2 text-[11px] leading-snug text-zinc-500">
                  No cameras yet. Add cameras in the web portal (Cameras) and assign them to this
                  organization — they'll appear here automatically.
                </div>
              )}
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
            <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 mr-1">AI Mode</span>
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
            {/* Edit actions. historyTick is read here so these re-evaluate their
                disabled state as the history stack changes. */}
            {(() => {
              void historyTick;
              const h = historyRef.current;
              const sel = drawings.find((d) => d.id === editingDrawingId);
              const selLocked = sel ? isLocked(sel as EditableShape) : false;
              return (
                <div className="flex items-center gap-1 border-r border-line pr-2 mr-1">
                  <button onClick={() => void undo()} disabled={!h?.canUndo} title="Undo (Ctrl+Z)"
                    className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent">
                    <Undo2 size={13} />
                  </button>
                  <button onClick={() => void redo()} disabled={!h?.canRedo} title="Redo (Ctrl+Shift+Z)"
                    className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent">
                    <Redo2 size={13} />
                  </button>
                  <button onClick={() => editingDrawingId && void duplicate(editingDrawingId)} disabled={!sel} title="Duplicate (Ctrl+D)"
                    className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent">
                    <CopyIcon size={13} />
                  </button>
                  <button onClick={() => editingDrawingId && removeShape(editingDrawingId)} disabled={!sel || selLocked}
                    title={selLocked ? "Unlock the shape to delete it" : "Delete (Del)"}
                    className="p-1 rounded text-zinc-400 hover:text-danger hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })()}
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
                <div className="text-sm font-semibold text-zinc-300 mb-1">Choose an AI Mode</div>
                <p className="text-xs text-zinc-500">Pick Traffic, Security, Factory or Custom above to load its AI features for <b>{selectedCam.name}</b>. This is saved to the camera and applied automatically.</p>
              </div>
            ) : (
              <div className="relative aspect-video max-h-full max-w-full rounded border border-line overflow-hidden shadow-2xl bg-zinc-950">
                {engineOnline ? (
                  <img
                    key={selectedCam.id}
                    ref={videoRef}
                    src={mjpegStreamUrl(selectedCam.id)}
                    alt=""
                    className="h-full w-full object-contain pointer-events-none"
                    onLoad={() => setStreamFailed(false)}
                    onError={(e) => {
                      setStreamFailed(true);
                      const target = e.currentTarget;
                      setTimeout(() => {
                        if (target) {
                          try {
                            const base = mjpegStreamUrl(selectedCam.id);
                            target.src = `${base}?_t=${Date.now()}`;
                          } catch { /* ignore */ }
                        }
                      }, 1000);
                    }}
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/90 px-6 text-center text-zinc-500">
                    <Video size={36} />
                    <span className="text-xs">Local AI engine offline — drawing still works on the grid</span>
                  </div>
                )}
                <canvas
                  ref={canvasRef}
                  onClick={handleCanvasClick}
                  onMouseDown={handlePointerDown}
                  onMouseMove={handlePointerMove}
                  onMouseUp={handlePointerUp}
                  // Releasing outside the canvas must still end the drag, or the
                  // shape keeps following the cursor after the button is up.
                  onMouseLeave={handlePointerUp}
                  className={clsx("absolute inset-0 w-full h-full z-10",
                    drawMode !== "view" ? "cursor-crosshair" : editingDrawingId ? "cursor-move" : "cursor-default")} />
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
                          : f.kind === "custom_model_registration" ? <div key={f.key}>{renderCustomModelRegistrationPanel()}</div>
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
            {selectedCam ? "Select an AI Mode to configure this camera." : "Select a camera to begin."}
          </div>
        )}
      </aside>
    </div>
  );
}
