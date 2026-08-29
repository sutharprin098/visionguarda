import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, getErrorMessage } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Tabs, Field, Badge, SecretReveal, ConfirmDialog } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";

interface OrgSettings {
  org_id: string;
  branding: { logo_path?: string; primary_color?: string; name_override?: string };
  theme: "dark" | "light" | "system";
  smtp: { host?: string; port?: number; username?: string; from?: string };
  camera_defaults: { fps?: number; recording?: boolean; retention_days?: number };
  retention: { recordings_days: number; alerts_days: number; audit_days: number };
  webhook: { url?: string; events?: string[] };
}

const DEFAULTS: Omit<OrgSettings, "org_id"> = {
  branding: {}, theme: "system", smtp: {}, camera_defaults: {},
  retention: { recordings_days: 30, alerts_days: 90, audit_days: 365 }, webhook: {},
};

export default function SettingsPage() {
  const { org, can } = useAuth();
  const hasOrgManage = can("org.manage");
  const [tab, setTab] = useState("My Profile");

  const { data: settings, refetch } = useQuery({
    queryKey: ["org-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("organization_settings").select("*").maybeSingle();
      return (data ?? { org_id: org?.id, ...DEFAULTS }) as OrgSettings;
    },
    enabled: !!org && hasOrgManage,
  });

  async function save(patch: Partial<OrgSettings>, action: string) {
    if (!org) return;
    const { error } = await supabase.from("organization_settings")
      .upsert({ org_id: org.id, ...settings, ...patch, updated_at: new Date().toISOString() });
    if (!error) {
      audit(action, "organization", org.id, { module: "settings", new: patch });
      refetch();
    }
    return error;
  }

  const tabs = hasOrgManage
    ? ["My Profile", "Organization", "Branding", "AI Profiles", "SMTP", "Telegram", "Retention", "Webhook", "API Keys", "About"]
    : ["My Profile", "About"];

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your profile and organization settings." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="w-full max-w-4xl xl:max-w-5xl">
        {tab === "My Profile" && <ProfileTab />}
        {tab === "Organization" && settings && <OrgTab settings={settings} onSave={save} />}
        {tab === "Branding" && settings && <BrandingTab settings={settings} onSave={save} />}
        {tab === "AI Profiles" && <AiTab canConfigure={can("ai.configure")} />}
        {tab === "SMTP" && settings && <SmtpTab settings={settings} onSave={save} />}
        {tab === "Telegram" && <TelegramTab />}
        {tab === "Retention" && settings && <RetentionTab settings={settings} onSave={save} />}
        {tab === "Webhook" && settings && <WebhookTab settings={settings} onSave={save} />}
        {tab === "API Keys" && <ApiKeysTab />}
        {tab === "About" && <AboutTab />}
      </div>
    </>
  );
}

// --------------------------------------------------------------- My Profile
function ProfileTab() {
  const { profile, signOut } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("delete-account");
    setBusy(false);
    if (err) {
      const msg = await getErrorMessage(err);
      setError(msg);
      return;
    }
    await signOut();
    window.location.href = "/";
  }

  return (
    <div className="space-y-6">
      <div className="card p-5 space-y-4">
        <h3 className="text-base font-semibold text-ink-1">Profile Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Field label="Full Name">
            <input className="input" value={profile?.full_name ?? ""} disabled />
          </Field>
          <Field label="Email Address">
            <input className="input" value={profile?.email ?? ""} disabled />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Field label="User Code">
            <span className="keychip">{profile?.user_code ?? "—"}</span>
          </Field>
          <Field label="Status">
            <Badge tone={profile?.status === "active" ? "ok" : "warn"}>
              {profile?.status?.toUpperCase() ?? "UNKNOWN"}
            </Badge>
          </Field>
        </div>
      </div>

      <div className="card p-5 border-danger/20 bg-danger/5 space-y-3">
        <h3 className="text-sm font-semibold text-danger">Danger Zone</h3>
        <p className="text-xs text-ink-3">
          Once you delete your account, there is no going back. All of your personal configurations, assignments, and licenses will be permanently revoked.
        </p>
        <div>
          <button className="btn-primary bg-danger hover:bg-danger/80 border-transparent text-white" onClick={() => setDeleteConfirm(true)}>
            Delete Account
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Account"
        body="Are you absolutely sure you want to delete your account? This action cannot be undone and your access will be immediately terminated."
        danger
      />
    </div>
  );
}

// --------------------------------------------------------------- About
function AboutTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <img src="/favicon.svg" alt="CamAI" className="h-14 w-14 rounded-xl" />
        <div>
          <div className="text-base font-semibold text-ink-1">CamAI Enterprise Vision Platform</div>
          <div className="text-sm text-ink-3">Smart AI CCTV, Edge & AWS Cloud GPU Analytics Suite</div>
        </div>
      </div>
      <div className="card space-y-2 p-4 text-sm text-ink-2">
        <div className="flex justify-between"><span className="text-ink-3">Portal version</span><span className="font-semibold text-ink-1">v1.0.7</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Desktop client installer</span><span className="font-semibold text-accent">v1.0.7 (Win64)</span></div>
        <div className="flex justify-between"><span className="text-ink-3">AWS Cloud GPU Engine</span><span className="font-mono text-xs text-blue-400">Active (http://13.203.71.14:8000)</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Inference Backend</span><span>YOLOX + OpenCV + Zero-DCE Night Vision</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Stream Sync</span><span>Zero-Lag MJPEG Burn-In & Ghost Eviction</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Cloud Repository</span><span className="font-mono text-xs text-ink-1">sutharprin098/visionguarda</span></div>
        <div className="pt-2 border-t border-line/60 flex items-center justify-between">
          <span className="text-ink-3">Technology Briefing &amp; Architecture Site</span>
          <a
            href="https://camai-enterprise-overview.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-semibold hover:bg-blue-500/30 transition-all"
          >
            <span>📄 View Overview Site ↗</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function SaveButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button className="btn-primary" onClick={onClick} disabled={busy}>
      {busy ? "Saving…" : "Save Changes"}
    </button>
  );
}

// --------------------------------------------------------------- Organization
function OrgTab({ settings, onSave }: { settings: OrgSettings; onSave: (p: Partial<OrgSettings>, a: string) => Promise<any> }) {
  const { org, refresh } = useAuth();
  const [name, setName] = useState(org?.name ?? "");
  const [theme, setTheme] = useState(settings.theme);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    if (org && name.trim() && name !== org.name) {
      await supabase.from("organizations").update({ name: name.trim() }).eq("id", org.id);
      audit("org.rename", "organization", org.id, { module: "settings", old: { name: org.name }, new: { name } });
      await refresh();
    }
    await onSave({ theme }, "org.settings.update");
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-4">
      <Field label="Organization name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <Field label="Organization ID"><span className="keychip">{org?.org_code}</span></Field>
        <Field label="Plan"><Badge tone="accent">{org?.plan}</Badge></Field>
      </div>
      <Field label="Default theme" hint="Applied to desktops on next sync; users can override locally.">
        <select className="input" value={theme} onChange={(e) => setTheme(e.target.value as any)}>
          <option value="system">System</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </Field>
      <div className="flex items-center gap-3">
        <SaveButton onClick={save} busy={busy} />
        {saved && <span className="text-sm text-ok">Saved ✓</span>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Branding
function BrandingTab({ settings, onSave }: { settings: OrgSettings; onSave: (p: Partial<OrgSettings>, a: string) => Promise<any> }) {
  const { org } = useAuth();
  const [form, setForm] = useState({
    name_override: settings.branding.name_override ?? "",
    primary_color: settings.branding.primary_color ?? "#6366f1",
  });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings.branding.logo_path) return;
    supabase.storage.from("branding").createSignedUrl(settings.branding.logo_path, 3600)
      .then(({ data }) => setLogoUrl(data?.signedUrl ?? null));
  }, [settings.branding.logo_path]);

  async function uploadLogo(file: File) {
    if (!org) return;
    setBusy(true);
    const path = `${org.id}/logo-${Date.now()}.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("branding").upload(path, file, { contentType: file.type });
    if (!error) {
      await onSave({ branding: { ...settings.branding, ...form, logo_path: path } }, "org.branding.update");
      const { data } = await supabase.storage.from("branding").createSignedUrl(path, 3600);
      setLogoUrl(data?.signedUrl ?? null);
    }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    await onSave({ branding: { ...settings.branding, ...form } }, "org.branding.update");
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-4">
      <Field label="Logo" hint="PNG or SVG, shown in the portal header and desktop title bar.">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
            {logoUrl
              ? <img src={logoUrl} alt="Organization logo" className="h-full w-full object-contain" />
              : <span className="text-xs text-ink-3">none</span>}
          </div>
          <label className="btn-ghost btn-sm cursor-pointer">
            Upload logo
            <input type="file" accept="image/png,image/svg+xml,image/jpeg" className="hidden"
                   onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
          </label>
        </div>
      </Field>
      <Field label="Display name override" hint="Shown instead of the organization name; leave empty to use the real name.">
        <input className="input" value={form.name_override}
               onChange={(e) => setForm({ ...form, name_override: e.target.value })} />
      </Field>
      <Field label="Primary color">
        <div className="flex items-center gap-3">
          <input type="color" className="h-9 w-14 cursor-pointer rounded border border-line bg-transparent"
                 value={form.primary_color}
                 onChange={(e) => setForm({ ...form, primary_color: e.target.value })} />
          <span className="font-mono text-xs text-ink-3">{form.primary_color}</span>
        </div>
      </Field>
      <div className="flex items-center gap-3">
        <SaveButton onClick={save} busy={busy} />
        {saved && <span className="text-sm text-ok">Saved ✓</span>}
      </div>
    </div>
  );
}



// --------------------------------------------------------------- AI Profiles Configuration
function AiTab({ canConfigure }: { canConfigure: boolean }) {
  const { org } = useAuth();
  const qc = useQueryClient();

  const { data: current } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () =>
      (await supabase.from("settings").select("key, value").eq("scope", "org").like("key", "ai.%")).data ?? [],
  });

  const getSetting = (key: string, fallback: any) => {
    const found = current?.find((s: any) => s.key === key);
    return found ? found.value : fallback;
  };

  const [inferenceMode, setInferenceMode] = useState<"cloud" | "local">("cloud");
  const [runtimeState, setRuntimeState] = useState<string>("CLOUD ACTIVE");
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeCloudOffline, setRuntimeCloudOffline] = useState<boolean>(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState<boolean>(false);

  useEffect(() => {
    if (current && current.length > 0) {
      const infMode = getSetting("ai.inference_mode", "cloud");
      setInferenceMode(infMode === "local" ? "local" : "cloud");
    }
  }, [current]);

  useEffect(() => {
    let active = true;
    async function pollRuntime() {
      try {
        const res = await fetch("http://localhost:8000/api/runtime/status");
        if (res.ok && active) {
          const data = await res.json();
          if (data.runtime_state) setRuntimeState(data.runtime_state);
          if (data.mode) setInferenceMode(data.mode);
          const isCloudOffline = !!data.cloud_cameras_offline && data.cloud_cameras_offline > 0;
          setRuntimeCloudOffline(isCloudOffline);
          if (data.error) setRuntimeError(data.error);
          else setRuntimeError(null);
          return;
        }
      } catch {
        // Local engine HTTP server not directly reachable (e.g. HTTPS remote admin portal)
      }

      if (active) {
        const currentMode = getSetting("ai.inference_mode", "cloud");
        setRuntimeState(currentMode === "local" ? "LOCAL ACTIVE" : "CLOUD ACTIVE");
        setRuntimeCloudOffline(false);
        setRuntimeError(null);
      }
    }
    pollRuntime();
    const iv = setInterval(pollRuntime, 3000);
    return () => { active = false; clearInterval(iv); };
  }, [current]);

  async function handleModeSwitch(targetMode: "cloud" | "local") {
    if (!canConfigure || isSwitchingMode) return;
    setIsSwitchingMode(true);
    setRuntimeState("SWITCHING");
    setRuntimeError(null);

    setInferenceMode(targetMode);

    let supabaseSuccess = false;
    if (org) {
      const { error } = await supabase.from("settings").upsert(
        [{ org_id: org.id, scope: "org", key: "ai.inference_mode", value: targetMode as any }],
        { onConflict: "org_id,scope,key" }
      );
      if (!error) {
        supabaseSuccess = true;
      } else {
        setRuntimeError(error.message);
      }
    } else {
      supabaseSuccess = true;
    }

    try {
      const res = await fetch("http://localhost:8000/api/cloud-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: targetMode }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.runtime_state) setRuntimeState(data.runtime_state);
        if (data.mode) setInferenceMode(data.mode);
        if (data.error) setRuntimeError(data.error);
      } else if (supabaseSuccess) {
        setRuntimeState(targetMode === "cloud" ? "CLOUD ACTIVE" : "LOCAL ACTIVE");
        setRuntimeError(null);
      }
    } catch {
      // Local HTTP endpoint skipped on remote HTTPS portal — Supabase updated successfully
      if (supabaseSuccess) {
        setRuntimeState(targetMode === "cloud" ? "CLOUD ACTIVE" : "LOCAL ACTIVE");
        setRuntimeError(null);
      }
    } finally {
      setIsSwitchingMode(false);
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
    }
  }

  return (
    <div className="space-y-6">
      {/* Central Admin Inference Engine Governor */}
      <div className="rounded-lg border border-accent/30 bg-surface-1/80 p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink-1 flex items-center gap-2">
              <span className="text-base">☁️</span> Mutually Exclusive Runtime Engine Mode
            </h3>
            <p className="text-xs text-ink-3 mt-1">
              Backend single source of truth. Selecting a mode gracefully stops the old runtime before starting the new one. Exactly one mode is active at any time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {runtimeState === "CLOUD ACTIVE" && !runtimeCloudOffline && (
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                ☁️ CLOUD ACTIVE
              </span>
            )}
            {runtimeState === "CLOUD ACTIVE" && runtimeCloudOffline && (
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 animate-pulse">
                ⚠️ CLOUD OFFLINE
              </span>
            )}
            {runtimeState === "LOCAL ACTIVE" && (
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-accent/20 text-accent border border-accent/30">
                🖥️ LOCAL ACTIVE
              </span>
            )}
            {runtimeState === "SWITCHING" && (
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
                ⏳ SWITCHING…
              </span>
            )}
            {(runtimeState === "FAILED") && !runtimeCloudOffline && (
              <span className="text-xs font-bold px-2.5 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                ⚠️ FAILED / OFFLINE
              </span>
            )}
          </div>
        </div>

        {runtimeError && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300 flex items-start gap-2">
            <span>⚠️</span>
            <div>
              {runtimeCloudOffline
                ? <><strong>Cloud Node Unreachable:</strong> {runtimeError} — Cameras are streaming but AI detections are paused until the cloud endpoint comes back online.</>
                : <><strong>Runtime Mode Execution Failure:</strong> {runtimeError}</>
              }
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={!canConfigure || isSwitchingMode || runtimeState === "SWITCHING"}
            onClick={() => handleModeSwitch("cloud")}
            className={`text-left p-4 rounded-lg border transition-all relative ${
              inferenceMode === "cloud"
                ? "border-blue-500 bg-blue-500/10 text-ink-1 ring-1 ring-blue-500 shadow-md"
                : "border-line bg-surface-2 text-ink-2 hover:border-blue-400 hover:bg-surface-1"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm text-blue-400 flex items-center gap-2">
                ☁️ Cloud Engine (AWS GPU)
              </div>
              {runtimeState === "CLOUD ACTIVE" && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-500 text-white px-2 py-0.5 rounded-full">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-3 mt-2 leading-relaxed">
              Inference runs 100% on AWS EC2 Cloud GPU. Local desktop camera processing and GPU/CPU load are <strong className="text-accent">100% STOPPED (0% Load)</strong>.
            </p>
          </button>

          <button
            type="button"
            disabled={!canConfigure || isSwitchingMode || runtimeState === "SWITCHING"}
            onClick={() => handleModeSwitch("local")}
            className={`text-left p-4 rounded-lg border transition-all relative ${
              inferenceMode === "local"
                ? "border-accent bg-accent/10 text-ink-1 ring-1 ring-accent shadow-md"
                : "border-line bg-surface-2 text-ink-2 hover:border-accent hover:bg-surface-1"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="font-semibold text-sm text-accent flex items-center gap-2">
                🖥️ Local Hardware Engine
              </div>
              {runtimeState === "LOCAL ACTIVE" && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-accent text-zinc-950 px-2 py-0.5 rounded-full">
                  ACTIVE
                </span>
              )}
            </div>
            <p className="text-[11px] text-ink-3 mt-2 leading-relaxed">
              Inference runs 100% on-premises on local GPU/CPU hardware. Cloud processing for CamAI is completely disabled.
            </p>
          </button>
        </div>

        {/* Enterprise Cloud AI Architecture & Specifications Showcase */}
        <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-950/20 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-500/20 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-400 text-base font-bold">
                ☁️
              </div>
              <div>
                <h4 className="text-sm font-bold text-ink-1">AWS Cloud GPU Engine Architecture</h4>
                <p className="text-xs text-blue-300/80">Enterprise-grade offloaded vision inference & detection suite</p>
              </div>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2.5 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/30">
              AWS Endpoint: 13.203.71.14:8000
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded bg-surface-1/80 border border-line">
              <div className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Compute Architecture</div>
              <div className="text-sm font-bold text-blue-400 mt-1">AWS EC2 GPU Node</div>
              <div className="text-[10px] text-ink-3 mt-0.5">High-Throughput NVIDIA Hardware</div>
            </div>
            <div className="p-3 rounded bg-surface-1/80 border border-line">
              <div className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Client Desktop Load</div>
              <div className="text-sm font-bold text-emerald-400 mt-1">0% CPU / 0% GPU</div>
              <div className="text-[10px] text-ink-3 mt-0.5">100% Offloaded Inference</div>
            </div>
            <div className="p-3 rounded bg-surface-1/80 border border-line">
              <div className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Stream Performance</div>
              <div className="text-sm font-bold text-ink-1 mt-1">30+ FPS Real-Time</div>
              <div className="text-[10px] text-ink-3 mt-0.5">Zero-Stutter MJPEG Sync</div>
            </div>
            <div className="p-3 rounded bg-surface-1/80 border border-line">
              <div className="text-[10px] font-semibold text-ink-3 uppercase tracking-wider">Inference Latency</div>
              <div className="text-sm font-bold text-sky-400 mt-1">&lt; 45ms Sub-Second</div>
              <div className="text-[10px] text-ink-3 mt-0.5">Real-Time Ingestion & Overlay</div>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-line/60">
            <div className="text-[11px] font-semibold text-ink-2 uppercase tracking-wider">Active AI Modules &amp; Features Suite</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
              <div className="p-3 rounded bg-surface-2/60 border border-line/60">
                <div className="font-semibold text-blue-400 flex items-center gap-1.5">
                  🖼️ Image Target Matcher
                </div>
                <div className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
                  Upload any photo or crop (Person, Face, Vehicle, Custom Target). Generates 512-d embeddings for continuous cross-camera matching.
                </div>
              </div>
              <div className="p-3 rounded bg-surface-2/60 border border-line/60">
                <div className="font-semibold text-blue-400 flex items-center gap-1.5">
                  🚦 Traffic &amp; ANPR
                </div>
                <div className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
                  Real-time vehicle counting (Cars, Bikes, Trucks, Buses), speed estimation (km/h), helmet violation alerts, and ANPR plate recognition.
                </div>
              </div>
              <div className="p-3 rounded bg-surface-2/60 border border-line/60">
                <div className="font-semibold text-accent flex items-center gap-1.5">
                  🛡️ Safety &amp; Intrusion Alerts
                </div>
                <div className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
                  Human intrusion detection, loitering tracking, overcrowding/crowd density alerts, fall detection heuristics, and zone hazard boundaries.
                </div>
              </div>
              <div className="p-3 rounded bg-surface-2/60 border border-line/60">
                <div className="font-semibold text-indigo-400 flex items-center gap-1.5">
                  🌙 Micro-Motion &amp; Night DCE
                </div>
                <div className="text-[11px] text-ink-3 mt-1.5 leading-relaxed">
                  Subtle motion rodent/pest tracking for warehouses, automated Zero-DCE low-light frame enhancement, and temporal ghost-box eviction.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Custom Image Upload Target Matcher & Cross-Camera Tracker */}
        <TargetManagerModule />
      </div>
    </div>
  );
}

function TargetManagerModule() {
  const [targets, setTargets] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(0.70);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const fetchTargets = async () => {
    try {
      const res = await fetch("/api/target/list");
      if (res.ok) {
        const data = await res.json();
        setTargets(data.targets || []);
      }
    } catch (e) {
      console.error("Failed to fetch targets:", e);
    }
  };

  useEffect(() => {
    fetchTargets();
  }, []);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name) {
      setStatusMsg("Please specify a target name and choose an image.");
      return;
    }
    setUploading(true);
    setStatusMsg("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", name);
    formData.append("threshold", threshold.toString());

    try {
      const res = await fetch("/api/target/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMsg(`Target "${data.name}" enrolled successfully!`);
        setName("");
        setFile(null);
        fetchTargets();
      } else {
        setStatusMsg(data.detail || "Failed to upload target.");
      }
    } catch (err: any) {
      setStatusMsg(`Upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (targetId: string) => {
    try {
      const res = await fetch(`/api/target/${targetId}`, { method: "DELETE" });
      if (res.ok) {
        fetchTargets();
      }
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-accent/30 bg-surface-2/40 p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-line/60 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">🎯</span>
          <h4 className="text-xs font-bold uppercase tracking-wider text-ink-1">
            Custom Image Upload Target Matcher &amp; Cross-Camera Tracker
          </h4>
        </div>
        <span className="text-[10px] font-mono bg-accent/10 text-accent px-2 py-0.5 rounded border border-accent/20">
          One-Shot Vector Re-ID Active
        </span>
      </div>

      <form onSubmit={handleUpload} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end text-xs">
        <div className="sm:col-span-4">
          <label className="block text-[10px] font-semibold text-ink-3 uppercase mb-1">Target Name</label>
          <input
            type="text"
            placeholder="e.g. VIP Person, Missing Subject, Target Car"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full text-xs"
            required
          />
        </div>

        <div className="sm:col-span-4">
          <label className="block text-[10px] font-semibold text-ink-3 uppercase mb-1">Target Image File</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-xs text-ink-2 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-[11px] file:font-semibold file:bg-accent file:text-zinc-950 hover:file:bg-accent/80 cursor-pointer"
            required
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-[10px] font-semibold text-ink-3 uppercase mb-1">
            Match Thresh: {(threshold * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0.40"
            max="0.95"
            step="0.05"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-full cursor-pointer accent-accent"
          />
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={uploading}
            className="btn btn-primary w-full text-xs py-1.5 font-bold uppercase tracking-wider flex items-center justify-center gap-1"
          >
            {uploading ? "Enrolling..." : "Enroll Target"}
          </button>
        </div>
      </form>

      {statusMsg && (
        <div className="text-[11px] font-medium text-accent bg-accent/10 p-2 rounded border border-accent/20">
          {statusMsg}
        </div>
      )}

      {targets.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-line/40">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Enrolled Active Search Targets ({targets.length})
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {targets.map((t) => (
              <div key={t.target_id} className="p-2 rounded bg-surface-1 border border-line flex items-center justify-between text-xs">
                <div className="truncate">
                  <div className="font-bold text-ink-1 truncate">{t.name}</div>
                  <div className="text-[10px] text-ink-3 font-mono">Thresh: {(t.threshold * 100).toFixed(0)}%</div>
                </div>
                <button
                  onClick={() => handleDelete(t.target_id)}
                  className="text-red-400 hover:text-red-300 p-1 text-xs font-bold"
                  title="Remove Target"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- SMTP
function SmtpTab({ settings, onSave }: { settings: OrgSettings; onSave: (p: Partial<OrgSettings>, a: string) => Promise<any> }) {
  const [form, setForm] = useState({
    host: settings.smtp.host ?? "",
    port: settings.smtp.port ?? 587,
    username: settings.smtp.username ?? "",
    from: settings.smtp.from ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    await onSave({ smtp: form }, "org.smtp.update");
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="SMTP host">
            <input className="input" placeholder="smtp.example.com" value={form.host}
                   onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </Field>
        </div>
        <Field label="Port">
          <input className="input" type="number" value={form.port}
                 onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label="Username">
        <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </Field>
      <Field label="From address">
        <input className="input" type="email" placeholder="alerts@yourcompany.com" value={form.from}
               onChange={(e) => setForm({ ...form, from: e.target.value })} />
      </Field>
      <p className="text-xs text-ink-3">
        The SMTP password is never stored in the database — set it as the <code>CAMAI_SMTP_PASSWORD</code> edge-function
        secret so email alerts can be sent server-side.
      </p>
      <div className="flex items-center gap-3">
        <SaveButton onClick={save} busy={busy} />
        {saved && <span className="text-sm text-ok">Saved ✓</span>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Telegram
// The ENTIRE Telegram configuration surface: enable, bot token, chat id,
// test. Deliberately no detection selectors — alerts from whatever models
// are running are delivered automatically by the alert-insert trigger
// (migration 0037 -> notify-telegram). Adding per-detection toggles here
// would break that "send whatever the active model produces" contract.
function TelegramTab() {
  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="text-base font-semibold text-ink-1 mb-2">Connect Telegram Alerts</h3>
        <p className="text-sm text-ink-3 leading-relaxed mb-4">
          CamAI uses a simple, secure one-time linking code. You do not need to create your own bot or copy bot tokens.
        </p>
        <div className="rounded-control border border-accent/20 bg-accent/10 p-4 text-sm leading-relaxed text-accent">
          <span className="font-semibold block mb-1">To link your account:</span>
          <ol className="list-decimal list-inside space-y-1 text-ink-2">
            <li>Open the <strong>CamAI Desktop Application</strong>.</li>
            <li>Navigate to the <strong>Alerts</strong> tab on the sidebar.</li>
            <li>Click <strong>Connect Telegram</strong> to generate an 8-character code (valid for 5 minutes).</li>
            <li>Tap <strong>Open in Telegram &amp; Connect</strong> — it sends the code to <strong>@CamAiAdmin_bot</strong> for you and your connection goes live automatically (or send <code>/start YOUR_CODE</code> manually).</li>
          </ol>
        </div>
      </div>
    </div>
  );
}


// --------------------------------------------------------------- Retention
function RetentionTab({ settings, onSave }: { settings: OrgSettings; onSave: (p: Partial<OrgSettings>, a: string) => Promise<any> }) {
  const [form, setForm] = useState(settings.retention);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    await onSave({ retention: form }, "org.retention.update");
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const fields: { key: keyof typeof form; label: string; hint: string }[] = [
    { key: "recordings_days", label: "Recordings", hint: "Video recordings older than this are purged from storage." },
    { key: "alerts_days", label: "Alerts", hint: "AI events and their snapshots." },
    { key: "audit_days", label: "Audit logs", hint: "Minimum 90 days is recommended for compliance." },
  ];

  return (
    <div className="space-y-4">
      {fields.map((f) => (
        <Field key={f.key} label={`${f.label} — ${form[f.key]} days`} hint={f.hint}>
          <input type="range" min={7} max={730} step={1} className="w-full accent-accent"
                 value={form[f.key]}
                 onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })} />
        </Field>
      ))}
      <div className="flex items-center gap-3">
        <SaveButton onClick={save} busy={busy} />
        {saved && <span className="text-sm text-ok">Saved ✓</span>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Webhook
function WebhookTab({ settings, onSave }: { settings: OrgSettings; onSave: (p: Partial<OrgSettings>, a: string) => Promise<any> }) {
  const EVENTS = ["alert.created", "incident.created", "device.activated", "device.deactivated", "camera.offline", "license.expiring"];
  const [form, setForm] = useState({
    url: settings.webhook.url ?? "",
    events: settings.webhook.events ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    await onSave({ webhook: form }, "org.webhook.update");
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="space-y-4">
      <Field label="Webhook URL" hint="Receives signed JSON POSTs for the selected events.">
        <input className="input" placeholder="https://example.com/hooks/camai" value={form.url}
               onChange={(e) => setForm({ ...form, url: e.target.value })} />
      </Field>
      <Field label="Events">
        <div className="flex flex-wrap gap-1.5">
          {EVENTS.map((ev) => {
            const on = form.events.includes(ev);
            return (
              <button key={ev}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-ink-3 hover:text-ink-1"}`}
                      onClick={() => setForm({
                        ...form,
                        events: on ? form.events.filter((x) => x !== ev) : [...form.events, ev],
                      })}>
                {ev}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="flex items-center gap-3">
        <SaveButton onClick={save} busy={busy} />
        {saved && <span className="text-sm text-ok">Saved ✓</span>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- API keys
function ApiKeysTab() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);

  const { data: keys } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () =>
      (await supabase.from("api_keys").select("*").order("created_at", { ascending: false })).data ?? [],
  });

  async function create() {
    setBusy(true);
    const { data, error } = await supabase.rpc("create_api_key", { p_name: name.trim(), p_scopes: ["read"] });
    setBusy(false);
    if (!error && data) {
      setRevealed(data as string);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Key name, e.g. 'CI exporter'"
               value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create Key"}
        </button>
      </div>

      {revealed && (
        <SecretReveal label="API key" secret={revealed}
                      note="Store it now — only the SHA-256 hash is kept and it cannot be shown again." />
      )}

      <div className="space-y-2">
        {!(keys as any[])?.length && <p className="text-sm text-ink-3">No API keys yet.</p>}
        {(keys as any[])?.map((k) => (
          <div key={k.id} className="card flex items-center justify-between p-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink-1">{k.name}</span>
                {k.revoked_at
                  ? <Badge tone="danger">revoked</Badge>
                  : <Badge tone="ok">active</Badge>}
              </div>
              <div className="mt-0.5 text-xs text-ink-3">
                <span className="keychip">{k.key_hint}</span> · created {fmtDateTime(k.created_at)}
              </div>
            </div>
            {!k.revoked_at && (
              <button className="text-xs text-danger hover:underline"
                      onClick={() => setRevoking({ id: k.id, name: k.name })}>
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          await supabase.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", revoking.id);
          audit("api_key.revoke", "api_key", revoking.id, { module: "settings" });
          qc.invalidateQueries({ queryKey: ["api-keys"] });
        }}
        title="Revoke API key"
        body={`Revoke "${revoking?.name}"? Requests using it fail immediately. This cannot be undone.`}
        danger
      />
    </div>
  );
}
