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
    ? ["My Profile", "Organization", "Branding", "AI Defaults", "SMTP", "Retention", "Webhook", "API Keys", "About"]
    : ["My Profile", "About"];

  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your profile and organization settings." />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="max-w-2xl">
        {tab === "My Profile" && <ProfileTab />}
        {tab === "Organization" && settings && <OrgTab settings={settings} onSave={save} />}
        {tab === "Branding" && settings && <BrandingTab settings={settings} onSave={save} />}
        {tab === "AI Defaults" && <AiTab canConfigure={can("ai.configure")} />}
        {tab === "SMTP" && settings && <SmtpTab settings={settings} onSave={save} />}
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
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field label="Full Name">
            <input className="input" value={profile?.full_name ?? ""} disabled />
          </Field>
          <Field label="Email Address">
            <input className="input" value={profile?.email ?? ""} disabled />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
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
      <div className="grid grid-cols-2 gap-3 text-sm">
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
          <label className="btn-ghost cursor-pointer text-xs">
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

// --------------------------------------------------------------- AI defaults
function AiTab({ canConfigure }: { canConfigure: boolean }) {
  const { org } = useAuth();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: models } = useQuery({
    queryKey: ["ai-models"],
    queryFn: async () => (await supabase.from("ai_models").select("*").order("name")).data ?? [],
  });
  const { data: current } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: async () =>
      (await supabase.from("settings").select("key, value").eq("scope", "org").like("key", "ai.%")).data ?? [],
  });

  const get = (key: string, fallback: any) =>
    (current?.find((s: any) => s.key === key)?.value as any) ?? fallback;

  const [form, setForm] = useState<{ model: string; confidence: number; classes: string[] } | null>(null);
  useEffect(() => {
    if (current && !form) {
      setForm({
        model: get("ai.model", "yolo11n"),
        confidence: Number(get("ai.confidence", 0.35)),
        classes: get("ai.classes", ["person", "car", "truck", "bus", "motorcycle", "bicycle"]),
      });
    }
  }, [current]);

  async function save() {
    if (!org || !form) return;
    setBusy(true);
    const rows = [
      { org_id: org.id, scope: "org", key: "ai.model", value: form.model as unknown },
      { org_id: org.id, scope: "org", key: "ai.confidence", value: form.confidence as unknown },
      { org_id: org.id, scope: "org", key: "ai.classes", value: form.classes as unknown },
    ];
    await supabase.from("settings").upsert(rows, { onConflict: "org_id,scope,key" });
    audit("ai.settings.update", "settings", "org", { module: "settings", new: form });
    qc.invalidateQueries({ queryKey: ["ai-settings"] });
    setBusy(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const ALL_CLASSES = ["person", "car", "truck", "bus", "motorcycle", "bicycle", "train", "boat"];

  if (!form) return <p className="text-sm text-ink-3">Loading…</p>;
  if (!canConfigure) {
    return (
      <div className="space-y-3 text-sm text-ink-2">
        <p>Model: <span className="keychip">{form.model}</span></p>
        <p>Confidence threshold: {form.confidence}</p>
        <p>Classes: {form.classes.join(", ")}</p>
        <p className="text-xs text-ink-3">You need the <code>ai.configure</code> permission to change these.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field label="Detection model" hint="Desktops pull the model from encrypted storage on next sync.">
        <select className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
          {models?.map((m: any) => (
            <option key={m.id} value={m.name}>{m.name} — {m.task} · {m.runtime}</option>
          ))}
        </select>
      </Field>
      <Field label={`Confidence threshold — ${form.confidence.toFixed(2)}`}>
        <input type="range" min={0.1} max={0.9} step={0.05} className="w-full accent-[#5b8cff]"
               value={form.confidence}
               onChange={(e) => setForm({ ...form, confidence: Number(e.target.value) })} />
      </Field>
      <Field label="Detection classes">
        <div className="flex flex-wrap gap-1.5">
          {ALL_CLASSES.map((c) => {
            const on = form.classes.includes(c);
            return (
              <button key={c}
                      className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-ink-3 hover:text-ink-1"}`}
                      onClick={() => setForm({
                        ...form,
                        classes: on ? form.classes.filter((x) => x !== c) : [...form.classes, c],
                      })}>
                {c}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="flex items-center gap-3">
        <SaveButton onClick={save} busy={busy} />
        {saved && <span className="text-sm text-ok">Saved ✓ — desktops re-sync within ~1s</span>}
      </div>
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
      <div className="grid grid-cols-3 gap-3">
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
          <input type="range" min={7} max={730} step={1} className="w-full accent-[#5b8cff]"
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
