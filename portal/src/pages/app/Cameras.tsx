import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Video, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { supabase, getErrorMessage } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { Camera } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, statusLabel, Modal, ConfirmDialog, Field, Toggle } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo } from "../../lib/format";

type CameraRow = Camera & {
  sites: { name: string } | null;
  camera_assignments: { user_id: string; profiles: { full_name: string } | null }[];
  camera_health: { fps: number; resolution: string; recording: boolean; is_online: boolean; checked_at: string } | null;
};

export default function CamerasPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [editFor, setEditFor] = useState<CameraRow | null>(null);
  const [assignFor, setAssignFor] = useState<CameraRow | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Throws on a PostgREST/RLS error instead of silently returning
  // undefined — an unchecked `.data` here previously meant a query that
  // errored (e.g. the RLS recursion fixed in 0021_fix_camera_rls_
  // recursion.sql) rendered identically to "no cameras yet", with the
  // underlying failure never surfacing anywhere.
  const { data: cameras, error: camerasError } = useQuery({
    queryKey: ["cameras"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        // camera_assignments has two FKs into profiles (user_id and
        // assigned_by) — PostgREST can't infer which one "profiles(...)"
        // means and 400s with "more than one relationship was found"
        // unless the FK is pinned explicitly via profiles!<constraint>.
        .select("*, sites(name), camera_assignments(user_id, profiles!camera_assignments_user_id_fkey(full_name)), camera_health(fps, resolution, recording, is_online, checked_at)")
        .order("created_at");
      if (error) throw error;
      return data as CameraRow[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["cameras"] });

  // health rows are upserted by the AI engine, assignments by other admins —
  // live-refresh so every open tab (portal or desktop) reflects both without
  // a manual reload, per-viewer: a user's own camera_assignments rows are
  // readable to them under RLS even without cameras.manage/assign.
  useEffect(() => {
    const ch = supabase
      .channel("cameras-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "camera_health" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "camera_assignments" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function toggleEnabled(c: CameraRow) {
    setActionError(null);
    const { error } = await supabase.from("cameras").update({ is_enabled: !c.is_enabled }).eq("id", c.id);
    if (error) return setActionError(error.message);
    audit(c.is_enabled ? "camera.disable" : "camera.enable", "camera", c.id, { module: "cameras" });
    refresh();
  }

  const columns: Column<CameraRow>[] = [
    {
      key: "camera", header: "Camera", sortable: true, value: (c) => c.name,
      render: (c) => (
        <div className="flex items-center gap-2">
          <Video size={14} className="shrink-0 text-ink-3" />
          <div className="min-w-0">
            <div className="truncate text-ink-1">{c.name}</div>
            <div className="truncate text-xs text-ink-3">{c.sites?.name ?? "No site"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "type", header: "Type", filter: true, value: (c) => c.source_type.toUpperCase(),
      render: (c) => <Badge>{c.source_type.toUpperCase()}</Badge>,
    },
    {
      key: "health", header: "Health", value: (c) => c.camera_health?.fps ?? null,
      render: (c) => c.camera_health
        ? (
          <div className="text-xs text-ink-3">
            <div>{c.camera_health.resolution || "—"} · {c.camera_health.fps.toFixed(0)} fps</div>
            <div>{c.camera_health.recording ? "recording" : "not recording"} · {fmtAgo(c.camera_health.checked_at)}</div>
          </div>
        )
        : <span className="text-xs text-ink-3">no telemetry</span>,
    },
    {
      key: "assigned", header: "Assigned Users",
      value: (c) => c.camera_assignments?.map((a) => a.profiles?.full_name).filter(Boolean).join(", ") || "—",
      render: (c) => (
        <span className="text-ink-2">
          {c.camera_assignments?.map((a) => a.profiles?.full_name).filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      key: "enabled", header: "Enabled", filter: true, value: (c) => (c.is_enabled ? "yes" : "no"),
      render: (c) => can("cameras.manage")
        ? <div onClick={(e) => e.stopPropagation()}><Toggle label="" value={c.is_enabled} onChange={() => toggleEnabled(c)} /></div>
        : <Badge tone={c.is_enabled ? "ok" : "default"}>{c.is_enabled ? "yes" : "no"}</Badge>,
    },
    {
      key: "status", header: "Status", filter: true, value: (c) => statusLabel[c.status] ?? c.status,
      render: (c) => <Badge tone={statusTone[c.status]}>{statusLabel[c.status] ?? c.status}</Badge>,
    },
    ...(can("cameras.manage") || can("cameras.assign")
      ? [{
          key: "actions", header: "", render: (c: CameraRow) => (
            <div className="space-x-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
              {can("cameras.assign") && (
                <button className="text-xs text-accent hover:underline" onClick={() => setAssignFor(c)}>Assign</button>
              )}
              {can("cameras.manage") && (
                <button className="text-xs text-ink-2 hover:underline" onClick={() => setEditFor(c)}>Edit</button>
              )}
              {can("cameras.manage") && (
                <button className="text-xs text-danger hover:underline" onClick={() =>
                  setConfirm({
                    title: "Delete camera",
                    body: `Delete ${c.name}? Its ROI, assignments and health history are removed. This cannot be undone.`,
                    danger: true,
                    run: async () => {
                      setActionError(null);
                      const { error } = await supabase.from("cameras").delete().eq("id", c.id);
                      if (error) return setActionError(error.message);
                      audit("camera.delete", "camera", c.id, { module: "cameras", old: { name: c.name } });
                      refresh();
                    },
                  })}>Delete</button>
              )}
            </div>
          ),
        } as Column<CameraRow>]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Cameras"
        subtitle="RTSP, ONVIF, USB, IP, NVR and DVR sources. Users only see cameras assigned to them."
        actions={
          can("cameras.manage") && (
            <button className="btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Camera
            </button>
          )
        }
      />
      {(actionError || camerasError) && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{actionError ?? (camerasError as any)?.message ?? "Failed to load cameras."}</span>
          {actionError && <button className="text-xs underline" onClick={() => setActionError(null)}>Dismiss</button>}
        </div>
      )}
      <DataTable
        rows={cameras ?? []}
        columns={columns}
        rowKey={(c) => c.id}
        searchText={(c) => `${c.name} ${c.source_type} ${c.sites?.name ?? ""}`}
        exportName="cameras"
        emptyText="No cameras yet."
      />

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add camera">
        <AddCameraForm onDone={() => { setAddOpen(false); refresh(); }} />
      </Modal>
      <Modal open={!!editFor} onClose={() => setEditFor(null)} title={`Edit — ${editFor?.name}`}>
        {editFor && <AddCameraForm camera={editFor} onDone={() => { setEditFor(null); refresh(); }} />}
      </Modal>
      <Modal open={!!assignFor} onClose={() => setAssignFor(null)} title={`Assign — ${assignFor?.name}`}>
        {assignFor && <AssignForm camera={assignFor} onDone={() => { setAssignFor(null); refresh(); }} />}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await confirm!.run(); }}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        danger={confirm?.danger}
      />
    </>
  );
}

const SOURCE_TYPES = [
  { value: "rtsp", label: "RTSP" },
  { value: "onvif", label: "ONVIF" },
  { value: "usb", label: "USB Camera" },
  { value: "ip", label: "IP Camera" },
  { value: "nvr", label: "NVR" },
  { value: "dvr", label: "DVR" },
  { value: "screen_share", label: "Screen Share" },
  { value: "stream_url", label: "Stream URL" },
] as const;

const DEFAULT_PORTS: Record<string, string> = { rtsp: "554", nvr: "554", dvr: "554", onvif: "80", ip: "80" };

/** Hosts that serve a watch PAGE rather than a media address. */
const LIVE_PAGE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "twitch.tv"];

function isLivePageUrl(raw: string): boolean {
  let host: string;
  try {
    host = new URL(raw.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  // Domain-boundary match, so a lookalike host that merely ends in the same
  // characters (notyoutube.com) is not claimed as YouTube.
  return LIVE_PAGE_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function AddCameraForm({ camera, onDone }: { camera?: CameraRow; onDone: () => void }) {
  const isEdit = !!camera;
  const [form, setForm] = useState({
    name: camera?.name ?? "", source_type: (camera?.source_type ?? "rtsp") as string, site_id: camera?.site_id ?? "",
    // Connection fields are never sent back from the server (only ciphertext
    // is stored) — editing starts blank; leaving them blank on save keeps
    // the existing encrypted connection untouched.
    host: "", port: DEFAULT_PORTS[camera?.source_type ?? "rtsp"] ?? "554", username: "", password: "", path: "", url: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testState, setTestState] = useState<{
    state: "idle" | "testing" | "ok" | "fail"; message?: string;
    channels?: { path: string; ok: boolean; note: string }[];
    deviceInfo?: { manufacturer?: string; model?: string; firmware?: string };
  }>({ state: "idle" });

  // Scoped to the caller's own org — add-camera always attaches the new
  // camera to the caller's org (see supabase/functions/add-camera), so for a
  // super admin (whose sites_read now spans every org, matching cameras_read
  // — see 0020_camera_management_fixes.sql) an unscoped list would let them
  // pick a site that belongs to a different org than the camera they're creating.
  const { profile } = useAuth();
  const { data: sites } = useQuery({
    queryKey: ["sites-brief", profile?.org_id],
    queryFn: async () =>
      (await supabase.from("sites").select("id, name").eq("org_id", profile!.org_id).order("name")).data ?? [],
    enabled: !!profile?.org_id,
  });

  const isUsb = form.source_type === "usb";
  // Its address is one opaque string, so it shares nothing with the host/port
  // form below — and nothing is dialled from the cloud to verify it.
  const isStreamUrl = form.source_type === "stream_url";
  // Mirrors _PAGE_HOSTS in server/app/ai/stream_resolver.py. Purely for the
  // explainer below — nothing here changes what is stored, and the engine
  // makes the real decision. Kept in sync by hand; a page host added there and
  // not here costs a hint, not a broken camera.
  const isPageUrl = isStreamUrl && isLivePageUrl(form.url);

  function setSourceType(source_type: string) {
    setForm({ ...form, source_type, port: DEFAULT_PORTS[source_type] ?? "" });
    setTestState({ state: "idle" });
  }

  // In edit mode, connection fields start blank (the server never sends
  // ciphertext back) — only treat the connection as "changed" if the user
  // actually typed something or switched source type, so a plain rename
  // doesn't force re-verification against an empty host.
  const connectionTouched = !isEdit || form.host.trim() !== "" || form.url.trim() !== "" || form.source_type !== camera?.source_type;

  function fields() {
    if (isStreamUrl) return { source_type: form.source_type, url: form.url.trim() };
    return {
      source_type: form.source_type,
      host: isUsb ? undefined : form.host.trim(),
      port: isUsb ? undefined : Number(form.port) || undefined,
      username: isUsb ? undefined : form.username.trim() || undefined,
      password: isUsb ? undefined : form.password || undefined,
      path: isUsb ? (form.host.trim() || "0") : (form.path.trim() || undefined),
    };
  }

  async function testConnection() {
    setTestState({ state: "testing" });
    const { data, error } = await supabase.functions.invoke("test-camera", { body: fields() });
    if (error || !data) {
      const msg = await getErrorMessage(error) || "Test request failed.";
      return setTestState({ state: "fail", message: msg });
    }
    setTestState({ state: data.ok ? "ok" : "fail", message: data.message, channels: data.channels, deviceInfo: data.device_info });
  }

  async function submit() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.functions.invoke(isEdit ? "update-camera" : "add-camera", {
      body: isEdit
        ? { camera_id: camera!.id, name: form.name, site_id: form.site_id || null, ...(connectionTouched ? fields() : {}) }
        : { name: form.name, site_id: form.site_id || null, ...fields() },
    });
    setBusy(false);
    if (error) {
      const detail = await getErrorMessage(error);
      return setError(detail || `Failed to ${isEdit ? "update" : "add"} camera — check the connection details and try again.`);
    }
    audit(isEdit ? "camera.update" : "camera.create", "camera", data?.id ?? form.name, { module: "cameras", new: { name: form.name, source_type: form.source_type } });
    onDone();
  }

  const canSubmit = form.name.trim() && (
    isStreamUrl ? (!connectionTouched || form.url.trim())
      : isUsb || form.source_type === "screen_share" ? true
      : !connectionTouched || form.host.trim());

  return (
    <div className="space-y-3">
      <Field label="Camera name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Source type">
          <select className="input" value={form.source_type} onChange={(e) => setSourceType(e.target.value)}>
            {SOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label="Site">
          <select className="input" value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
            <option value="">No site</option>
            {sites?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>

      {isEdit && form.source_type !== "screen_share" && (
        <p className="text-xs text-ink-3">
          {isStreamUrl
            ? "The saved URL is hidden for security — leave it blank to keep the current one, or paste a new URL to replace it."
            : "Connection fields are hidden for security — leave them blank to keep the current connection, or fill them in to replace it (re-verified before saving)."}
        </p>
      )}

      {isUsb ? (
        <Field label="USB device index" hint="Usually 0 for the first attached camera.">
          <input className="input" placeholder={isEdit ? "unchanged" : "0"} value={form.host}
                 onChange={(e) => { setForm({ ...form, host: e.target.value }); setTestState({ state: "idle" }); }} />
        </Field>
      ) : form.source_type === "screen_share" ? (
        <div className="rounded-md border border-accent/20 bg-accent/5 p-3 text-xs text-ink-2">
          This is a virtual camera. You will be able to capture and stream your screen or webcam directly from the desktop application workspace. No physical connection details are needed.
        </div>
      ) : isStreamUrl ? (
        <>
          <Field
            label="Stream URL"
            hint="A YouTube or Twitch live link, an HLS playlist (.m3u8), an MJPEG endpoint, or an RTSP URL that already includes its credentials. Paste it exactly as-is."
          >
            <textarea
              className="input min-h-[72px] font-mono text-xs"
              placeholder={isEdit ? "unchanged" : "https://www.youtube.com/watch?v=… or https://example.com/live/playlist.m3u8"}
              value={form.url}
              onChange={(e) => { setForm({ ...form, url: e.target.value }); setTestState({ state: "idle" }); }}
            />
          </Field>
          {isPageUrl && (
            <div className="rounded-md border border-ok/25 bg-ok/5 p-3 text-xs text-ink-2">
              <span className="font-medium text-ink-1">Live page link detected.</span>{" "}
              A watch page is not a video address — the desktop app resolves it to the
              stream behind it before opening, and re-resolves automatically whenever the
              connection drops, so a signed link ageing out does not take the camera down.
              Paste the link to a stream that is <span className="font-medium">live now</span>;
              a past broadcast or an ended stream has nothing to open.
            </div>
          )}
          <div className="rounded-md border border-accent/20 bg-accent/5 p-3 text-xs text-ink-2">
            Check URL validates the address and scheme only. The stream itself is never fetched from the cloud — it is stored as given and opened by the desktop app on your own machine, so a URL that passes the check can still fail to open, and the camera will then show as offline.
            <br /><br />
            Note that a raw signed playlist URL (not a YouTube/Twitch link) expires after a few hours and cannot be renewed on its own. For a long unattended run, use a page link or a stream whose address is stable.
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Camera IP">
                <input className="input" placeholder={isEdit ? "unchanged" : "192.168.1.64"} value={form.host}
                       onChange={(e) => { setForm({ ...form, host: e.target.value }); setTestState({ state: "idle" }); }} />
              </Field>
            </div>
            <Field label="Port">
              <input className="input" type="number" value={form.port}
                     onChange={(e) => { setForm({ ...form, port: e.target.value }); setTestState({ state: "idle" }); }} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <input className="input" value={form.username}
                     onChange={(e) => { setForm({ ...form, username: e.target.value }); setTestState({ state: "idle" }); }} />
            </Field>
            <Field label="Password">
              <input className="input" type="password" value={form.password}
                     onChange={(e) => { setForm({ ...form, password: e.target.value }); setTestState({ state: "idle" }); }} />
            </Field>
          </div>
          <Field label="RTSP path" hint="Stream path on the device, e.g. /Streaming/Channels/101. Leave empty if unsure.">
            <input className="input" placeholder="/Streaming/Channels/101" value={form.path}
                   onChange={(e) => { setForm({ ...form, path: e.target.value }); setTestState({ state: "idle" }); }} />
          </Field>
        </>
      )}

      {form.source_type !== "screen_share" && (
        <div className="flex items-center gap-3">
          {/* Shown for stream_url too. test-camera DOES validate it — it parses the
              URL and rejects an unsupported scheme (see _shared/util.ts). It just
              doesn't dial it, because fetching a whole caller-supplied URL from the
              edge runtime is an SSRF primitive. Hiding the button meant a typo'd or
              wrong-scheme URL got saved silently and only surfaced later as a camera
              stuck offline, with nothing in the UI to explain why. */}
          <button type="button" className="btn-ghost text-xs" onClick={testConnection}
                  disabled={testState.state === "testing" || !canSubmit || (isEdit && !connectionTouched)}>
            {testState.state === "testing" ? "Testing…" : isStreamUrl ? "Check URL" : "Test Connection"}
          </button>
          {testState.state === "ok" && (
            <span className="flex items-center gap-1.5 text-xs text-ok"><CheckCircle2 size={13} /> {testState.message}</span>
          )}
          {testState.state === "fail" && (
            <span className="flex items-center gap-1.5 text-xs text-danger"><XCircle size={13} /> {testState.message}</span>
          )}
          {testState.state === "testing" && <Loader2 size={13} className="animate-spin text-ink-3" />}
        </div>
      )}

      {!!testState.channels?.length && (
        <div className="rounded-md border border-line p-2.5">
          <p className="mb-1.5 text-xs font-medium text-ink-2">
            {testState.channels.length} channel{testState.channels.length === 1 ? "" : "s"} found — click one to use it
          </p>
          <div className="flex flex-wrap gap-1.5">
            {testState.channels.map((c) => (
              <button
                key={c.path}
                type="button"
                title={c.note}
                className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink-2 hover:border-accent hover:text-accent"
                onClick={() => setForm({ ...form, path: c.path })}
              >
                {c.path}
              </button>
            ))}
          </div>
        </div>
      )}
      {testState.deviceInfo && (testState.deviceInfo.manufacturer || testState.deviceInfo.model) && (
        <p className="text-xs text-ink-3">
          Identified as {testState.deviceInfo.manufacturer} {testState.deviceInfo.model}
          {testState.deviceInfo.firmware ? ` (fw ${testState.deviceInfo.firmware})` : ""}
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !canSubmit}>
        {busy ? (isEdit ? "Verifying & saving…" : "Verifying & adding…") : (isEdit ? "Save Changes" : "Add Camera")}
      </button>
      <p className="text-xs text-ink-3">
        {isEdit && !connectionTouched
          ? "Only the name/site are changing — the existing connection is left untouched."
          : "The connection is verified reachable before the camera is saved. Credentials are AES-256 encrypted; only ciphertext lands in the database."}
      </p>
    </div>
  );
}

function AssignForm({ camera, onDone }: { camera: CameraRow; onDone: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState("");
  // Scoped to the camera's own org — profiles_read spans every org for a
  // super admin, so an unscoped list here would offer users from other
  // organizations as assignable to this camera (cam_assign_write's own
  // with_check also cross-verifies the assignee's org against the
  // camera's, per 0020/0021 — this scoping is UX, not the only guard).
  const { data: users } = useQuery({
    queryKey: ["users-brief", camera.org_id],
    queryFn: async () =>
      (await supabase.from("profiles").select("id, full_name, email").eq("org_id", camera.org_id).order("full_name")).data ?? [],
  });
  const { data: assigned } = useQuery({
    queryKey: ["cam-assign", camera.id],
    queryFn: async () =>
      (await supabase.from("camera_assignments").select("user_id").eq("camera_id", camera.id)).data?.map((a) => a.user_id) ?? [],
  });

  async function toggle(userId: string, on: boolean) {
    setError("");
    const { error: err } = on
      ? await supabase.from("camera_assignments").insert({ camera_id: camera.id, user_id: userId })
      : await supabase.from("camera_assignments").delete().eq("camera_id", camera.id).eq("user_id", userId);
    if (err) return setError(err.message);
    audit(on ? "camera.assign" : "camera.unassign", "camera", camera.id, { module: "cameras", detail: { user_id: userId } });
    qc.invalidateQueries({ queryKey: ["cam-assign", camera.id] });
    qc.invalidateQueries({ queryKey: ["cameras"] });
  }

  return (
    <div className="max-h-80 space-y-1.5 overflow-y-auto">
      {error && <p className="text-sm text-danger">{error}</p>}
      {users?.map((u: any) => (
        <label key={u.id} className="flex cursor-pointer items-center justify-between rounded-md border border-line px-3 py-2 hover:bg-surface-2">
          <div>
            <div className="text-sm text-ink-1">{u.full_name}</div>
            <div className="text-xs text-ink-3">{u.email}</div>
          </div>
          <input type="checkbox" className="h-4 w-4 accent-[#5b8cff]"
                 checked={assigned?.includes(u.id) ?? false}
                 onChange={(e) => toggle(u.id, e.target.checked)} />
        </label>
      ))}
      <button className="btn-ghost mt-2 w-full" onClick={onDone}>Done</button>
    </div>
  );
}
