import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { PageHeader, Badge, Modal, ConfirmDialog, Field } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtDate } from "../../lib/format";

interface SiteRow {
  id: string;
  name: string;
  kind: "site" | "building" | "road" | "zone";
  address: string;
  project_id: string | null;
  projects: { name: string } | null;
  cameras: { count: number }[];
  created_at: string;
}

const KINDS = ["site", "building", "road", "zone"] as const;

export default function SitesPage() {
  const qc = useQueryClient();
  const [formFor, setFormFor] = useState<Partial<SiteRow> | null>(null); // {} = create
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: async () =>
      (await supabase
        .from("sites")
        .select("*, projects(name), cameras(count)")
        .order("name")).data as SiteRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["sites"] });

  const columns: Column<SiteRow>[] = [
    {
      key: "name", header: "Site", sortable: true, value: (s) => s.name,
      render: (s) => (
        <div className="flex items-center gap-2">
          <MapPin size={14} className="shrink-0 text-ink-3" />
          <div className="min-w-0">
            <div className="truncate text-ink-1">{s.name}</div>
            <div className="truncate text-xs text-ink-3">{s.address || "No address"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "kind", header: "Kind", filter: true, value: (s) => s.kind,
      render: (s) => <Badge tone="accent">{s.kind}</Badge>,
    },
    {
      key: "project", header: "Project", filter: true, value: (s) => s.projects?.name ?? "—",
      render: (s) => <span className="text-ink-2">{s.projects?.name ?? "—"}</span>,
    },
    {
      key: "cameras", header: "Cameras", sortable: true, value: (s) => s.cameras?.[0]?.count ?? 0,
      render: (s) => s.cameras?.[0]?.count ?? 0,
    },
    {
      key: "created", header: "Created", sortable: true, value: (s) => s.created_at,
      render: (s) => <span className="text-ink-3">{fmtDate(s.created_at)}</span>,
    },
    {
      key: "actions", header: "", render: (s) => (
        <div className="space-x-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
          <button className="text-xs text-accent hover:underline" onClick={() => setFormFor(s)}>Edit</button>
          <button className="text-xs text-danger hover:underline" onClick={() =>
            setConfirm({
              title: "Delete site",
              body: `Delete "${s.name}"? Cameras keep existing but lose their site link.`,
              run: async () => {
                await supabase.from("sites").delete().eq("id", s.id);
                audit("site.delete", "site", s.id, { module: "sites", old: { name: s.name } });
                refresh();
              },
            })}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Sites"
        subtitle="Physical locations — sites, buildings, roads and zones — that group and anchor cameras."
        actions={
          <button className="btn-primary" onClick={() => setFormFor({})}>
            <Plus size={15} /> Add Site
          </button>
        }
      />
      <DataTable
        rows={sites ?? []}
        columns={columns}
        rowKey={(s) => s.id}
        searchText={(s) => `${s.name} ${s.address} ${s.kind} ${s.projects?.name ?? ""}`}
        exportName="sites"
        emptyText="No sites yet."
      />

      <Modal open={!!formFor} onClose={() => setFormFor(null)} title={formFor?.id ? "Edit site" : "Add site"}>
        {formFor && <SiteForm site={formFor} onDone={() => { setFormFor(null); refresh(); }} />}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={async () => { await confirm!.run(); }}
        title={confirm?.title ?? ""}
        body={confirm?.body ?? ""}
        danger
      />
    </>
  );
}

function SiteForm({ site, onDone }: { site: Partial<SiteRow>; onDone: () => void }) {
  const [form, setForm] = useState({
    name: site.name ?? "",
    kind: site.kind ?? "site",
    address: site.address ?? "",
    project_id: site.project_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: org } = useQuery({
    queryKey: ["org-id"],
    queryFn: async () => (await supabase.from("organizations").select("id").maybeSingle()).data,
  });
  const { data: projects } = useQuery({
    queryKey: ["projects-brief"],
    queryFn: async () => (await supabase.from("projects").select("id, name").order("name")).data ?? [],
  });

  async function submit() {
    if (!org) return;
    setBusy(true);
    setError("");
    const row = {
      name: form.name, kind: form.kind, address: form.address,
      project_id: form.project_id || null,
    };
    if (site.id) {
      const { error } = await supabase.from("sites").update(row).eq("id", site.id);
      if (error) { setBusy(false); return setError(error.message); }
      audit("site.update", "site", site.id, { module: "sites", old: { name: site.name }, new: row });
    } else {
      const { data, error } = await supabase.from("sites").insert({ org_id: org.id, ...row }).select("id").maybeSingle();
      if (error || !data) { setBusy(false); return setError(error?.message ?? "create failed"); }
      audit("site.create", "site", data.id, { module: "sites", new: row });
    }
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="Name">
        <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as any })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Project">
          <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">No project</option>
            {projects?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Address">
        <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.name.trim() || !org}>
        {busy ? "Saving…" : site.id ? "Save Changes" : "Create Site"}
      </button>
    </div>
  );
}
