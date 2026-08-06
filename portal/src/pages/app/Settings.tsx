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
    ? ["My Profile", "Organization", "Branding", "SMTP", "Telegram", "Retention", "Webhook", "API Keys", "About"]
    : ["My Profile", "About"];

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your profile and organization settings." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="w-full max-w-4xl xl:max-w-5xl">
        {tab === "My Profile" && <ProfileTab />}
        {tab === "Organization" && settings && <OrgTab settings={settings} onSave={save} />}
        {tab === "Branding" && settings && <BrandingTab settings={settings} onSave={save} />}
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
          <div className="text-base font-semibold text-ink-1">CamAI</div>
          <div className="text-sm text-ink-3">Enterprise AI CCTV Platform</div>
        </div>
      </div>
      <div className="card space-y-2 p-4 text-sm text-ink-2">
        <div className="flex justify-between"><span className="text-ink-3">Portal version</span><span>1.0.0</span></div>
        <div className="flex justify-between"><span className="text-ink-3">Desktop client</span><span>1.0.0</span></div>
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
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: current } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () =>
      (await supabase.from("settings").select("key, value").eq("scope", "org").like("key", "ai.%")).data ?? [],
  });

  const getSetting = (key: string, fallback: any) => {
    const found = current?.find((s: any) => s.key === key);
    return found ? found.value : fallback;
  };

  const [activeProfile, setActiveProfile] = useState<"traffic" | "security" | "factory" | "custom">("traffic");

  // Traffic form state
  const [trafficDetections, setTrafficDetections] = useState({
    vehicle_detection: true,
    vehicle_counting: true,
    lane_detection: true,
    wrong_way: true,
    speed_monitoring: true,
    queue_monitoring: true,
    parking_monitoring: true,
    anpr: true,
    traffic_light_violation: true,
  });
  const [trafficObjects, setTrafficObjects] = useState({
    car: true,
    truck: true,
    bus: true,
    motorcycle: true,
    bicycle: true,
    auto_rickshaw: true,
  });
  const [trafficDetSensitivity, setTrafficDetSensitivity] = useState<"low" | "medium" | "high">("high");
  const [trafficAlertSensitivity, setTrafficAlertSensitivity] = useState<"low" | "medium" | "high">("medium");

  // Security form state
  const [securityDetections, setSecurityDetections] = useState({
    person: true,
    intrusion: true,
    restricted_area: true,
    loitering: true,
    crowd: true,
    fire: true,
    smoke: true,
    fall_detection: true,
  });
  const [securityObjects, setSecurityObjects] = useState({
    person: true,
    backpack: true,
    bag: true,
  });
  const [securitySensitivity, setSecuritySensitivity] = useState<"low" | "medium" | "high">("high");

  // Factory form state
  const [factoryDetections, setFactoryDetections] = useState({
    ppe: true,
    helmet: true,
    gloves: true,
    vest: true,
    shoes: true,
    forklift: true,
    worker: true,
    fire: true,
    smoke: true,
  });
  const [factorySensitivity, setFactorySensitivity] = useState<"low" | "medium" | "high">("high");

  // Custom form state
  const [customDetections, setCustomDetections] = useState<string[]>(["person", "vehicle"]);
  const [customObjects, setCustomObjects] = useState<string[]>(["car", "person", "bag"]);
  const [customSensitivity, setCustomSensitivity] = useState<"low" | "medium" | "high">("medium");

  // Load from db
  useEffect(() => {
    if (current && current.length > 0) {
      const prof = getSetting("ai.profile", "traffic") as "traffic" | "security" | "factory" | "custom";
      setActiveProfile(prof);

      const tc = getSetting("ai.traffic_config", null);
      if (tc) {
        setTrafficDetections({ ...trafficDetections, ...tc.detections });
        setTrafficObjects({ ...trafficObjects, ...tc.objects });
        if (tc.detectionSensitivity) setTrafficDetSensitivity(tc.detectionSensitivity);
        if (tc.alertSensitivity) setTrafficAlertSensitivity(tc.alertSensitivity);
      }

      const sc = getSetting("ai.security_config", null);
      if (sc) {
        setSecurityDetections({ ...securityDetections, ...sc.detections });
        setSecurityObjects({ ...securityObjects, ...sc.objects });
        if (sc.sensitivity) setSecuritySensitivity(sc.sensitivity);
      }

      const fc = getSetting("ai.factory_config", null);
      if (fc) {
        setFactoryDetections({ ...factoryDetections, ...fc.detections });
        if (fc.sensitivity) setFactorySensitivity(fc.sensitivity);
      }

      const cc = getSetting("ai.custom_config", null);
      if (cc) {
        if (cc.detections) setCustomDetections(cc.detections);
        if (cc.objects) setCustomObjects(cc.objects);
        if (cc.sensitivity) setCustomSensitivity(cc.sensitivity);
      }
    }
  }, [current]);

  async function save() {
    if (!org) return;
    setBusy(true);

    // Resolve model name and properties based on active profile and sensitivity.
    // These are ai_model_packages.name values (see migration 0030) — the
    // catalog's segmentation entry was retired with the YOLOX swap, so the
    // top sensitivity tier now maps to the most accurate detector instead.
    let resolvedModel = "CamAI Engine M"; // Default high quality detection
    let activeSensitivity: "low" | "medium" | "high" = "high";

    if (activeProfile === "traffic") {
      activeSensitivity = trafficDetSensitivity;
    } else if (activeProfile === "security") {
      activeSensitivity = securitySensitivity;
    } else if (activeProfile === "factory") {
      activeSensitivity = factorySensitivity;
    } else if (activeProfile === "custom") {
      activeSensitivity = customSensitivity;
    }

    if (activeSensitivity === "low") {
      resolvedModel = "CamAI Engine Tiny";
    } else if (activeSensitivity === "medium") {
      resolvedModel = "CamAI Engine S";
    } else {
      resolvedModel = "CamAI Engine M";
    }

    // Special factory logic: if factory PPE is checked, use PPE Detection model
    if (activeProfile === "factory" && factoryDetections.ppe) {
      resolvedModel = "PPE Detection";
    }

    // Mapped classes
    let resolvedClasses: string[] = [];
    if (activeProfile === "traffic") {
      resolvedClasses = Object.entries(trafficObjects)
        .filter(([_, enabled]) => enabled)
        .map(([obj]) => obj);
    } else if (activeProfile === "security") {
      resolvedClasses = Object.entries(securityObjects)
        .filter(([_, enabled]) => enabled)
        .map(([obj]) => obj === "bag" ? "handbag" : obj);
    } else if (activeProfile === "factory") {
      resolvedClasses = ["person", "helmet", "vest", "gloves", "shoes"];
    } else {
      resolvedClasses = customObjects;
    }

    const resolvedConfidence = activeSensitivity === "low" ? 0.25 : activeSensitivity === "medium" ? 0.40 : 0.55;

    const trafficConfigObj = {
      detections: trafficDetections,
      objects: trafficObjects,
      detectionSensitivity: trafficDetSensitivity,
      alertSensitivity: trafficAlertSensitivity,
    };

    const securityConfigObj = {
      detections: securityDetections,
      objects: securityObjects,
      sensitivity: securitySensitivity,
    };

    const factoryConfigObj = {
      detections: factoryDetections,
      sensitivity: factorySensitivity,
    };

    const customConfigObj = {
      detections: customDetections,
      objects: customObjects,
      sensitivity: customSensitivity,
    };

    const rows = [
      { org_id: org.id, scope: "org", key: "ai.profile", value: activeProfile as any },
      { org_id: org.id, scope: "org", key: "ai.model", value: resolvedModel as any },
      { org_id: org.id, scope: "org", key: "ai.confidence", value: resolvedConfidence as any },
      { org_id: org.id, scope: "org", key: "ai.classes", value: resolvedClasses as any },
      { org_id: org.id, scope: "org", key: "ai.traffic_config", value: trafficConfigObj as any },
      { org_id: org.id, scope: "org", key: "ai.security_config", value: securityConfigObj as any },
      { org_id: org.id, scope: "org", key: "ai.factory_config", value: factoryConfigObj as any },
      { org_id: org.id, scope: "org", key: "ai.custom_config", value: customConfigObj as any },
    ];

    await supabase.from("settings").upsert(rows, { onConflict: "org_id,scope,key" });
    audit("ai.profile.update", "settings", "org", {
      module: "settings",
      new: {
        profile: activeProfile,
        model: resolvedModel,
        classes: resolvedClasses,
        confidence: resolvedConfidence,
      }
    });

    qc.invalidateQueries({ queryKey: ["ai-settings"] });
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const PROFILES = [
    { id: "traffic", label: "Traffic", desc: "For highway, roads, speed checking, and vehicle flow management." },
    { id: "security", label: "Security", desc: "For perimeter security, intrusion detection, loitering, and fire alerts." },
    { id: "factory", label: "Factory", desc: "For employee safety monitoring, PPE compliance, and forklift tracking." },
    { id: "custom", label: "Custom", desc: "Define your own business-specific tracking rules and event processing." },
  ] as const;

  const SENSITIVITIES = ["low", "medium", "high"] as const;

  return (
    <div className="space-y-6">
      <div className="border-b border-line pb-4">
        <h3 className="text-base font-semibold text-ink-1">AI Profile</h3>
        <p className="text-xs text-ink-3 mt-0.5">Select a business profile. The system automatically configures detection models, classes, and runtimes without exposing filenames or libraries.</p>
      </div>

      {/* Profile Selector */}
      <div className="grid gap-3 sm:grid-cols-2">
        {PROFILES.map((p) => {
          const selected = activeProfile === p.id;
          return (
            <button
              key={p.id}
              disabled={!canConfigure}
              onClick={() => setActiveProfile(p.id)}
              className={`text-left p-4 rounded-lg border transition ${
                selected
                  ? "border-accent bg-accent/5 ring-1 ring-accent text-ink-1"
                  : "border-line bg-surface-1 text-ink-2 hover:border-accent hover:text-ink-1"
              }`}
            >
              <div className="font-semibold text-sm capitalize">{p.label}</div>
              <div className="text-[11px] mt-1 text-ink-3 leading-normal">{p.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Traffic Profile Settings */}
      {activeProfile === "traffic" && (
        <div className="space-y-4 rounded-lg border border-line bg-surface-1/50 p-4">
          <h4 className="text-xs font-semibold text-ink-1 uppercase tracking-wider">Traffic Configuration</h4>
          
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Detection Types</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(trafficDetections).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs text-ink-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canConfigure}
                    checked={(trafficDetections as any)[k]}
                    onChange={(e) => setTrafficDetections({ ...trafficDetections, [k]: e.target.checked })}
                    className="rounded border-line bg-surface-2 text-accent focus:ring-accent accent-accent"
                  />
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Tracked Objects</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.keys(trafficObjects).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs text-ink-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canConfigure}
                    checked={(trafficObjects as any)[k]}
                    onChange={(e) => setTrafficObjects({ ...trafficObjects, [k]: e.target.checked })}
                    className="rounded border-line bg-surface-2 text-accent focus:ring-accent accent-accent"
                  />
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-2">Detection Sensitivity</label>
              <div className="flex gap-1 bg-surface-2 p-0.5 rounded-md border border-line">
                {SENSITIVITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!canConfigure}
                    onClick={() => setTrafficDetSensitivity(s)}
                    className={`flex-1 py-1 text-center text-[10px] font-semibold uppercase rounded transition ${
                      trafficDetSensitivity === s ? "bg-accent text-white" : "text-ink-3 hover:text-ink-1"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-ink-2">Alert Sensitivity</label>
              <div className="flex gap-1 bg-surface-2 p-0.5 rounded-md border border-line">
                {SENSITIVITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!canConfigure}
                    onClick={() => setTrafficAlertSensitivity(s)}
                    className={`flex-1 py-1 text-center text-[10px] font-semibold uppercase rounded transition ${
                      trafficAlertSensitivity === s ? "bg-accent text-white" : "text-ink-3 hover:text-ink-1"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Security Profile Settings */}
      {activeProfile === "security" && (
        <div className="space-y-4 rounded-lg border border-line bg-surface-1/50 p-4">
          <h4 className="text-xs font-semibold text-ink-1 uppercase tracking-wider">Security Configuration</h4>
          
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Detection Types</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(securityDetections).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs text-ink-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canConfigure}
                    checked={(securityDetections as any)[k]}
                    onChange={(e) => setSecurityDetections({ ...securityDetections, [k]: e.target.checked })}
                    className="rounded border-line bg-surface-2 text-accent focus:ring-accent accent-accent"
                  />
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Tracked Objects</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.keys(securityObjects).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs text-ink-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canConfigure}
                    checked={(securityObjects as any)[k]}
                    onChange={(e) => setSecurityObjects({ ...securityObjects, [k]: e.target.checked })}
                    className="rounded border-line bg-surface-2 text-accent focus:ring-accent accent-accent"
                  />
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="text-xs font-medium text-ink-2">Profile Sensitivity</label>
            <div className="flex gap-1 bg-surface-2 p-0.5 rounded-md border border-line max-w-xs">
              {SENSITIVITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canConfigure}
                  onClick={() => setSecuritySensitivity(s)}
                  className={`flex-1 py-1 text-center text-[10px] font-semibold uppercase rounded transition ${
                    securitySensitivity === s ? "bg-accent text-white" : "text-ink-3 hover:text-ink-1"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Factory Profile Settings */}
      {activeProfile === "factory" && (
        <div className="space-y-4 rounded-lg border border-line bg-surface-1/50 p-4">
          <h4 className="text-xs font-semibold text-ink-1 uppercase tracking-wider">Factory Configuration</h4>
          
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Safety & Tracking Rules</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(factoryDetections).map((k) => (
                <label key={k} className="flex items-center gap-2 text-xs text-ink-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canConfigure}
                    checked={(factoryDetections as any)[k]}
                    onChange={(e) => setFactoryDetections({ ...factoryDetections, [k]: e.target.checked })}
                    className="rounded border-line bg-surface-2 text-accent focus:ring-accent accent-accent"
                  />
                  <span className="capitalize">{k.replace(/_/g, " ")}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="text-xs font-medium text-ink-2">Profile Sensitivity</label>
            <div className="flex gap-1 bg-surface-2 p-0.5 rounded-md border border-line max-w-xs">
              {SENSITIVITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canConfigure}
                  onClick={() => setFactorySensitivity(s)}
                  className={`flex-1 py-1 text-center text-[10px] font-semibold uppercase rounded transition ${
                    factorySensitivity === s ? "bg-accent text-white" : "text-ink-3 hover:text-ink-1"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Custom Profile Settings */}
      {activeProfile === "custom" && (
        <div className="space-y-4 rounded-lg border border-line bg-surface-1/50 p-4">
          <h4 className="text-xs font-semibold text-ink-1 uppercase tracking-wider">Custom Configuration</h4>
          
          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Detection Types</label>
            <div className="flex flex-wrap gap-1.5">
              {["general", "intrusion", "safety", "fire", "smoke", "pose"].map((c) => {
                const on = customDetections.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!canConfigure}
                    onClick={() =>
                      setCustomDetections(
                        on ? customDetections.filter((x) => x !== c) : [...customDetections, c]
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      on
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-line text-ink-2 hover:text-ink-1"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-ink-2">Detection Classes</label>
            <div className="flex flex-wrap gap-1.5">
              {["person", "car", "truck", "bus", "motorcycle", "bicycle", "backpack", "handbag", "suitcase", "helmet", "vest"].map((c) => {
                const on = customObjects.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={!canConfigure}
                    onClick={() =>
                      setCustomObjects(
                        on ? customObjects.filter((x) => x !== c) : [...customObjects, c]
                      )
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${
                      on
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-line text-ink-2 hover:text-ink-1"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 pt-2">
            <label className="text-xs font-medium text-ink-2">Sensitivity</label>
            <div className="flex gap-1 bg-surface-2 p-0.5 rounded-md border border-line max-w-xs">
              {SENSITIVITIES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canConfigure}
                  onClick={() => setCustomSensitivity(s)}
                  className={`flex-1 py-1 text-center text-[10px] font-semibold uppercase rounded transition ${
                    customSensitivity === s ? "bg-accent text-white" : "text-ink-3 hover:text-ink-1"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {canConfigure && (
        <div className="flex items-center gap-3 pt-2">
          <SaveButton onClick={save} busy={busy} />
          {saved && <span className="text-sm text-ok">Saved ✓ — desktops re-sync automatically</span>}
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
