import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { Incident, ThreadEntry } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Modal, Drawer, Field } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";

type IncidentRow = Incident & {
  cameras: { name: string } | null;
  assignee: { id: string; full_name: string } | null;
};

const STATUSES: Incident["status"][] = ["open", "investigating", "resolved", "closed"];

export default function IncidentsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: incidents } = useQuery({
    queryKey: ["incidents"],
    queryFn: async () =>
      (await supabase
        .from("incidents")
        .select("*, cameras(name), assignee:profiles!incidents_assigned_to_fkey(id, full_name)")
        .order("created_at", { ascending: false })).data as IncidentRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["incidents"] });

  useEffect(() => {
    const ch = supabase
      .channel("incidents-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const viewing = incidents?.find((i) => i.id === viewingId) ?? null;

  const columns: Column<IncidentRow>[] = [
    {
      key: "severity", header: "Severity", filter: true, value: (i) => i.severity,
      render: (i) => <Badge tone={statusTone[i.severity]}>{i.severity}</Badge>,
    },
    {
      key: "title", header: "Incident", sortable: true, value: (i) => i.title,
      render: (i) => (
        <div className="min-w-0">
          <div className="truncate text-ink-1">{i.title}</div>
          <div className="truncate text-xs text-ink-3">{i.cameras?.name ?? ""}</div>
        </div>
      ),
    },
    {
      key: "status", header: "Status", filter: true, value: (i) => i.status,
      render: (i) => <Badge tone={statusTone[i.status]}>{i.status}</Badge>,
    },
    {
      key: "assignee", header: "Assigned To", filter: true, value: (i) => i.assignee?.full_name ?? "Unassigned",
      render: (i) => <span className="text-ink-2">{i.assignee?.full_name ?? "Unassigned"}</span>,
    },
    {
      key: "notes", header: "Notes", value: (i) => i.notes?.length ?? 0,
      render: (i) => <span className="text-ink-3">{i.notes?.length ?? 0}</span>,
    },
    {
      key: "updated", header: "Updated", sortable: true, value: (i) => i.updated_at,
      render: (i) => <span className="whitespace-nowrap text-xs text-ink-3">{fmtAgo(i.updated_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Escalated events with an ownership and resolution workflow."
        actions={
          can("incidents.manage") && (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> New Incident
            </button>
          )
        }
      />
      <DataTable
        rows={incidents ?? []}
        columns={columns}
        rowKey={(i) => i.id}
        searchText={(i) => `${i.title} ${i.description} ${i.status} ${i.assignee?.full_name ?? ""}`}
        exportName="incidents"
        onRowClick={(i) => setViewingId(i.id)}
        emptyText="No incidents. Escalate an alert or create one manually."
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New incident">
        <CreateForm onDone={() => { setCreateOpen(false); refresh(); }} />
      </Modal>

      <Drawer open={!!viewing} onClose={() => setViewingId(null)} title={viewing?.title ?? ""}>
        {viewing && <IncidentDetail incident={viewing} onChanged={refresh} />}
      </Drawer>
    </>
  );
}

function IncidentDetail({ incident, onChanged }: { incident: IncidentRow; onChanged: () => void }) {
  const { profile, can } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const manage = can("incidents.manage");

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").order("full_name")).data ?? [],
  });

  async function setStatus(status: Incident["status"]) {
    await supabase.from("incidents").update({ status }).eq("id", incident.id);
    audit("incident.status", "incident", incident.id, { module: "incidents", old: { status: incident.status }, new: { status } });
    onChanged();
  }

  async function assign(userId: string) {
    await supabase.from("incidents").update({ assigned_to: userId || null }).eq("id", incident.id);
    audit("incident.assign", "incident", incident.id, { module: "incidents", new: { assigned_to: userId || null } });
    onChanged();
  }

  async function addNote() {
    if (!note.trim() || !profile) return;
    setBusy(true);
    const entry: ThreadEntry = { by: profile.id, by_name: profile.full_name, at: new Date().toISOString(), text: note.trim() };
    await supabase.from("incidents")
      .update({ notes: [...(incident.notes ?? []), entry] })
      .eq("id", incident.id);
    setNote("");
    setBusy(false);
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[incident.severity]}>{incident.severity}</Badge>
        <Badge tone={statusTone[incident.status]}>{incident.status}</Badge>
        <span className="text-xs text-ink-3">opened {fmtDateTime(incident.created_at)}</span>
      </div>

      {incident.description && <p className="text-sm text-ink-2">{incident.description}</p>}
      {incident.cameras && <p className="text-xs text-ink-3">Camera: {incident.cameras.name}</p>}

      {manage && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select className="input" value={incident.status} onChange={(e) => setStatus(e.target.value as Incident["status"])}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Assigned to">
            <select className="input" value={incident.assigned_to ?? ""} onChange={(e) => assign(e.target.value)}>
              <option value="">Unassigned</option>
              {users?.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
        </div>
      )}

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
          Notes ({incident.notes?.length ?? 0})
        </div>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {!(incident.notes?.length) && <p className="text-sm text-ink-3">No notes yet.</p>}
          {incident.notes?.map((n, idx) => (
            <div key={idx} className="rounded-md border border-line bg-surface-2 p-3">
              <div className="mb-1 flex items-center justify-between text-xs text-ink-3">
                <span className="font-medium text-ink-2">{n.by_name}</span>
                <span>{fmtDateTime(n.at)}</span>
              </div>
              <p className="whitespace-pre-line text-sm text-ink-1">{n.text}</p>
            </div>
          ))}
        </div>
      </div>

      {manage && (
        <div className="space-y-2">
          <textarea className="input min-h-[70px] w-full" placeholder="Add a note…"
                    value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn-primary w-full" onClick={addNote} disabled={busy || !note.trim()}>
            {busy ? "Posting…" : "Add Note"}
          </button>
        </div>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { profile } = useAuth();
  const [form, setForm] = useState({ title: "", description: "", severity: "warning", camera_id: "", assigned_to: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: org } = useQuery({
    queryKey: ["org-id"],
    queryFn: async () => (await supabase.from("organizations").select("id").single()).data,
  });
  const { data: cameras } = useQuery({
    queryKey: ["cameras-brief"],
    queryFn: async () => (await supabase.from("cameras").select("id, name").order("name")).data ?? [],
  });
  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name").order("full_name")).data ?? [],
  });

  async function submit() {
    if (!org) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.from("incidents").insert({
      org_id: org.id,
      title: form.title,
      description: form.description,
      severity: form.severity,
      camera_id: form.camera_id || null,
      assigned_to: form.assigned_to || null,
      created_by: profile?.id,
    }).select("id").single();
    setBusy(false);
    if (error) return setError(error.message);
    audit("incident.create", "incident", data.id, { module: "incidents", new: { title: form.title, severity: form.severity } });
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="Title">
        <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="input min-h-[70px]" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Severity">
          <select className="input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
            {["info", "warning", "critical"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Camera">
          <select className="input" value={form.camera_id} onChange={(e) => setForm({ ...form, camera_id: e.target.value })}>
            <option value="">None</option>
            {cameras?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Assign to">
        <select className="input" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
          <option value="">Unassigned</option>
          {users?.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.title.trim() || !org}>
        {busy ? "Creating…" : "Create Incident"}
      </button>
    </div>
  );
}
