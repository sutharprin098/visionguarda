import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Video } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { Camera } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Modal, ConfirmDialog, Field, Toggle } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo } from "../../lib/format";

type CameraRow = Camera & {
  lat: number | null;
  lng: number | null;
  sites: { name: string } | null;
  camera_assignments: { user_id: string; profiles: { full_name: string } | null }[];
  camera_health: { fps: number; resolution: string; recording: boolean; is_online: boolean; checked_at: string } | null;
};

export default function CamerasPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<CameraRow | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);

  const { data: cameras } = useQuery({
    queryKey: ["cameras"],
    queryFn: async () =>
      (await supabase
        .from("cameras")
        .select("*, sites(name), camera_assignments(user_id, profiles(full_name)), camera_health(fps, resolution, recording, is_online, checked_at)")
        .order("created_at")).data as CameraRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["cameras"] });

  // health rows are upserted by the AI engine — live-refresh status
  useEffect(() => {
    const ch = supabase
      .channel("cameras-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "camera_health" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function toggleEnabled(c: CameraRow) {
    await supabase.from("cameras").update({ is_enabled: !c.is_enabled }).eq("id", c.id);
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
      key: "status", header: "Status", filter: true, value: (c) => c.status,
      render: (c) => <Badge tone={statusTone[c.status]}>{c.status}</Badge>,
    },
    ...(can("cameras.manage") || can("cameras.assign")
      ? [{
          key: "actions", header: "", render: (c: CameraRow) => (
            <div className="space-x-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
              {can("cameras.assign") && (
                <button className="text-xs text-accent hover:underline" onClick={() => setAssignFor(c)}>Assign</button>
              )}
              {can("cameras.manage") && (
                <button className="text-xs text-danger hover:underline" onClick={() =>
                  setConfirm({
                    title: "Delete camera",
                    body: `Delete ${c.name}? Its ROI, assignments and health history are removed. This cannot be undone.`,
                    danger: true,
                    run: async () => {
                      await supabase.from("cameras").delete().eq("id", c.id);
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

function AddCameraForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: "", source_type: "rtsp", connection: "", site_id: "", lat: "", lng: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: sites } = useQuery({
    queryKey: ["sites-brief"],
    queryFn: async () => (await supabase.from("sites").select("id, name").order("name")).data ?? [],
  });

  async function submit() {
    setBusy(true);
    setError("");
    // credentials in the URL are encrypted server-side (AES-256-GCM) by the edge function
    const { data, error } = await supabase.functions.invoke("add-camera", {
      body: {
        name: form.name,
        source_type: form.source_type,
        connection: form.connection,
        site_id: form.site_id || null,
        lat: form.lat ? Number(form.lat) : null,
        lng: form.lng ? Number(form.lng) : null,
      },
    });
    setBusy(false);
    if (error) return setError("Failed to add camera — check the connection string and try again.");
    audit("camera.create", "camera", data?.camera_id ?? form.name, { module: "cameras", new: { name: form.name, source_type: form.source_type } });
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="Camera name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Source type">
          <select className="input" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })}>
            {["rtsp", "onvif", "usb", "ip", "nvr", "dvr"].map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Site">
          <select className="input" value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
            <option value="">No site</option>
            {sites?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Connection" hint="Credentials are AES-256 encrypted before storage; only ciphertext lands in the database.">
        <input className="input" placeholder="rtsp://user:pass@host:554/stream — or USB index like 0"
               value={form.connection} onChange={(e) => setForm({ ...form, connection: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude">
          <input className="input" type="number" step="any" value={form.lat}
                 onChange={(e) => setForm({ ...form, lat: e.target.value })} />
        </Field>
        <Field label="Longitude">
          <input className="input" type="number" step="any" value={form.lng}
                 onChange={(e) => setForm({ ...form, lng: e.target.value })} />
        </Field>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.name || !form.connection}>
        {busy ? "Adding…" : "Add Camera"}
      </button>
    </div>
  );
}

function AssignForm({ camera, onDone }: { camera: CameraRow; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").order("full_name")).data ?? [],
  });
  const { data: assigned } = useQuery({
    queryKey: ["cam-assign", camera.id],
    queryFn: async () =>
      (await supabase.from("camera_assignments").select("user_id").eq("camera_id", camera.id)).data?.map((a) => a.user_id) ?? [],
  });

  async function toggle(userId: string, on: boolean) {
    if (on) await supabase.from("camera_assignments").insert({ camera_id: camera.id, user_id: userId });
    else await supabase.from("camera_assignments").delete().eq("camera_id", camera.id).eq("user_id", userId);
    audit(on ? "camera.assign" : "camera.unassign", "camera", camera.id, { module: "cameras", detail: { user_id: userId } });
    qc.invalidateQueries({ queryKey: ["cam-assign", camera.id] });
    qc.invalidateQueries({ queryKey: ["cameras"] });
  }

  return (
    <div className="max-h-80 space-y-1.5 overflow-y-auto">
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
