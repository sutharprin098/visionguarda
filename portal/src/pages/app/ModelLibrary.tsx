// Super-admin AI Model Library: catalog CRUD, categorisation and
// model→profile assignment. Catalog-only — binary download / SHA256 /
// signature verification and DRM live in the desktop client and stay
// inert until real model files + signing keys are provisioned.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import {
  Cpu, HardDrive, MemoryStick, Boxes, Pencil, Trash2, Plus, Search,
  Car, Shield, Factory, Radio,
} from "lucide-react";
import clsx from "clsx";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { audit } from "../../lib/audit";
import { PageHeader, Badge, Kpi, Modal, ConfirmDialog, Field, Empty } from "../../components/ui";

type ProfileKey = "traffic" | "security" | "factory" | "drone" | "custom";

interface ModelRow {
  id: string;
  org_id: string | null;
  name: string;
  version: string;
  category: string | null;
  framework: string | null;
  runtime: string;
  description: string | null;
  size_bytes: number;
  cpu_requirement: string | null;
  gpu_requirement: string | null;
  ram_requirement: string | null;
  cuda_requirement: string | null;
  checksum: string | null;
  signature: string | null;
  download_url: string | null;
  release_notes: string | null;
  status: string;
}

interface AssignmentRow {
  id: string;
  org_id: string | null;
  model_id: string;
  profile: ProfileKey;
}

const CATEGORIES = [
  "detection", "segmentation", "tracking", "ocr", "pose",
  "face", "fire", "smoke", "vehicle", "ppe", "custom",
] as const;

const RUNTIMES = ["onnx", "tensorrt", "pytorch", "openvino", "tflite", "coreml", "ncnn"] as const;

const PROFILES: { key: ProfileKey; label: string; icon: typeof Car; cls: string }[] = [
  { key: "traffic", label: "Traffic", icon: Car, cls: "border-sky-500/60 bg-sky-500/15 text-sky-400" },
  { key: "security", label: "Security", icon: Shield, cls: "border-rose-500/60 bg-rose-500/15 text-rose-400" },
  { key: "factory", label: "Factory", icon: Factory, cls: "border-amber-500/60 bg-amber-500/15 text-amber-400" },
  { key: "drone", label: "Drone", icon: Radio, cls: "border-emerald-500/60 bg-emerald-500/15 text-emerald-400" },
  { key: "custom", label: "Custom", icon: Boxes, cls: "border-violet-500/60 bg-violet-500/15 text-violet-400" },
];

const CATEGORY_TONE: Record<string, string> = {
  detection: "accent", segmentation: "accent", tracking: "ok", ocr: "default",
  pose: "default", face: "accent", fire: "danger", smoke: "warn", vehicle: "ok", ppe: "warn", custom: "default",
};

function fmtBytes(b: number): string {
  if (!b) return "—";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${s[i]}`;
}

const emptyModel: Partial<ModelRow> = {
  name: "", version: "1.0.0", category: "detection", framework: "", runtime: "onnx",
  description: "", size_bytes: 0, cpu_requirement: "", gpu_requirement: "", ram_requirement: "",
  cuda_requirement: "", checksum: "", signature: "", download_url: "", release_notes: "", status: "published",
};

export default function ModelLibraryPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Partial<ModelRow> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ModelRow | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data: models } = useQuery({
    queryKey: ["ai-models"],
    queryFn: async () =>
      (await supabase
        .from("ai_model_packages")
        .select("*")
        .is("deleted_at", null)
        .order("category", { ascending: true })
        .order("name", { ascending: true })).data as ModelRow[] | null,
  });

  const { data: assignments } = useQuery({
    queryKey: ["model-assignments"],
    queryFn: async () =>
      (await supabase.from("model_profile_assignments").select("*").is("org_id", null)).data as AssignmentRow[] | null,
  });

  const assignMap = useMemo(() => {
    const m = new Map<string, Set<ProfileKey>>();
    for (const a of assignments ?? []) {
      if (!m.has(a.model_id)) m.set(a.model_id, new Set());
      m.get(a.model_id)!.add(a.profile);
    }
    return m;
  }, [assignments]);

  if (!profile?.is_super_admin) return <Navigate to="/app" replace />;

  const filtered = (models ?? []).filter((m) => {
    if (catFilter !== "all" && m.category !== catFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return `${m.name} ${m.framework} ${m.runtime} ${m.category}`.toLowerCase().includes(q);
    }
    return true;
  });

  async function toggleAssign(model: ModelRow, prof: ProfileKey) {
    setErr(null);
    const has = assignMap.get(model.id)?.has(prof);
    if (has) {
      const { error } = await supabase.from("model_profile_assignments")
        .delete().eq("model_id", model.id).eq("profile", prof).is("org_id", null);
      if (error) return setErr(error.message);
      audit("model.unassign", "ai_model", model.id, { module: "models", new: { profile: prof } });
    } else {
      const { error } = await supabase.from("model_profile_assignments")
        .insert({ org_id: null, model_id: model.id, profile: prof });
      if (error) return setErr(error.message);
      audit("model.assign", "ai_model", model.id, { module: "models", new: { profile: prof } });
    }
    qc.invalidateQueries({ queryKey: ["model-assignments"] });
  }

  async function deleteModel(model: ModelRow) {
    setErr(null);
    const { error } = await supabase.from("ai_model_packages")
      .update({ deleted_at: new Date().toISOString() }).eq("id", model.id);
    if (error) return setErr(error.message);
    audit("model.delete", "ai_model", model.id, { module: "models", old: { name: model.name } });
    qc.invalidateQueries({ queryKey: ["ai-models"] });
  }

  const published = (models ?? []).filter((m) => m.status === "published").length;
  const assignedCount = new Set((assignments ?? []).map((a) => a.model_id)).size;

  return (
    <>
      <PageHeader
        title="AI Model Library"
        subtitle="Platform model catalog, categorisation and profile assignment (super admin)."
        actions={<button className="btn-primary flex items-center gap-1.5" onClick={() => setEditing({ ...emptyModel })}>
          <Plus size={15} /> New Model
        </button>}
      />

      {err && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{err}</span>
          <button className="text-xs underline" onClick={() => setErr(null)}>Dismiss</button>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Models" value={models?.length ?? "—"} />
        <Kpi label="Categories" value={new Set((models ?? []).map((m) => m.category)).size || "—"} />
        <Kpi label="Published" value={published || "—"} />
        <Kpi label="Assigned" value={assignedCount || "—"} hint="Models bound to ≥1 profile" />
      </div>

      {/* Search + category filter */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-ink-3" />
          <input className="input pl-8" placeholder="Search models…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setCatFilter("all")}
          className={clsx("rounded-full border px-3 py-1 text-xs capitalize transition",
            catFilter === "all" ? "border-accent bg-accent/15 text-accent" : "border-line text-ink-3 hover:text-ink-1")}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCatFilter(c)}
            className={clsx("rounded-full border px-3 py-1 text-xs capitalize transition",
              catFilter === c ? "border-accent bg-accent/15 text-accent" : "border-line text-ink-3 hover:text-ink-1")}>
            {c}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty text="No models match your filters." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((m) => {
            const assigned = assignMap.get(m.id) ?? new Set<ProfileKey>();
            return (
              <div key={m.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold text-ink-1">{m.name}</h3>
                      <span className="font-mono text-[11px] text-ink-3">v{m.version}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.category && <Badge tone={CATEGORY_TONE[m.category]}>{m.category}</Badge>}
                      <Badge>{m.runtime}</Badge>
                      {m.framework && <span className="text-[11px] text-ink-3">{m.framework}</span>}
                    </div>
                  </div>
                  <Badge tone={m.status === "published" ? "ok" : m.status === "deprecated" ? "danger" : "warn"}>{m.status}</Badge>
                </div>

                {m.description && <p className="mt-2.5 text-xs leading-relaxed text-ink-2">{m.description}</p>}

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-ink-3">
                  <span className="flex items-center gap-1.5"><HardDrive size={12} /> {fmtBytes(m.size_bytes)}</span>
                  <span className="flex items-center gap-1.5"><Cpu size={12} /> {m.cpu_requirement || "—"}</span>
                  <span className="flex items-center gap-1.5"><Boxes size={12} /> GPU {m.gpu_requirement || "—"}</span>
                  <span className="flex items-center gap-1.5"><MemoryStick size={12} /> {m.ram_requirement || "—"}</span>
                  {m.cuda_requirement && <span className="col-span-2">CUDA {m.cuda_requirement}</span>}
                </div>

                {/* Profile assignment chips (click to bind/unbind) */}
                <div className="mt-3 border-t border-line pt-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Assigned profiles</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PROFILES.map((p) => {
                      const on = assigned.has(p.key);
                      const Icon = p.icon;
                      return (
                        <button key={p.key} onClick={() => toggleAssign(m, p.key)}
                          className={clsx("flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition",
                            on ? p.cls : "border-line text-ink-3 hover:text-ink-1")}>
                          <Icon size={12} /> {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
                  <button className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink-1" onClick={() => setEditing(m)}>
                    <Pencil size={13} /> Edit
                  </button>
                  <button className="flex items-center gap-1 text-xs text-danger hover:underline" onClick={() => setConfirmDelete(m)}>
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} wide title={editing?.id ? "Edit model" : "New model"}>
        {editing && (
          <ModelForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["ai-models"] }); }}
            onError={setErr}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => { if (confirmDelete) await deleteModel(confirmDelete); }}
        danger
        title="Delete model"
        body={`Remove "${confirmDelete?.name}" from the catalog. Existing assignments are removed too. This can be re-created later.`}
        confirmLabel="Delete model"
      />
    </>
  );
}

function ModelForm({ initial, onCancel, onSaved, onError }: {
  initial: Partial<ModelRow>;
  onCancel: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [f, setF] = useState<Partial<ModelRow>>(initial);
  const [sizeMb, setSizeMb] = useState<string>(initial.size_bytes ? String((initial.size_bytes / (1024 * 1024)).toFixed(1)) : "0");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ModelRow, v: unknown) => setF((prev) => ({ ...prev, [k]: v }));

  async function submit() {
    if (!f.name?.trim()) return onError("Model name is required.");
    setBusy(true);
    const payload = {
      name: f.name!.trim(),
      version: f.version || "1.0.0",
      category: f.category || "custom",
      framework: f.framework || null,
      runtime: f.runtime || "onnx",
      task: f.category || "custom",
      description: f.description || null,
      size_bytes: Math.round(parseFloat(sizeMb || "0") * 1024 * 1024),
      cpu_requirement: f.cpu_requirement || null,
      gpu_requirement: f.gpu_requirement || null,
      ram_requirement: f.ram_requirement || null,
      cuda_requirement: f.cuda_requirement || null,
      checksum: f.checksum || null,
      signature: f.signature || null,
      download_url: f.download_url || null,
      release_notes: f.release_notes || null,
      status: f.status || "published",
    };
    let error;
    if (f.id) {
      ({ error } = await supabase.from("ai_model_packages").update(payload).eq("id", f.id));
      if (!error) audit("model.update", "ai_model", f.id, { module: "models", new: { name: payload.name } });
    } else {
      const { data, error: insErr } = await supabase.from("ai_model_packages").insert({ ...payload, org_id: null }).select().single();
      error = insErr;
      if (!error) audit("model.create", "ai_model", data?.id, { module: "models", new: { name: payload.name } });
    }
    setBusy(false);
    if (error) return onError(error.message);
    onSaved();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name"><input className="input" value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
        <Field label="Version"><input className="input" value={f.version ?? ""} onChange={(e) => set("version", e.target.value)} /></Field>
      </div>

      <Field label="Description">
        <textarea className="input h-16 resize-none" value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Category">
          <select className="input" value={f.category ?? "detection"} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Runtime">
          <select className="input" value={f.runtime ?? "onnx"} onChange={(e) => set("runtime", e.target.value)}>
            {RUNTIMES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Framework"><input className="input" value={f.framework ?? ""} onChange={(e) => set("framework", e.target.value)} placeholder="Megvii, PaddlePaddle…" /></Field>
        <Field label="Size (MB)"><input className="input" type="number" min={0} step={0.1} value={sizeMb} onChange={(e) => setSizeMb(e.target.value)} /></Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="CPU Requirement"><input className="input" value={f.cpu_requirement ?? ""} onChange={(e) => set("cpu_requirement", e.target.value)} placeholder="4 cores" /></Field>
        <Field label="GPU Requirement"><input className="input" value={f.gpu_requirement ?? ""} onChange={(e) => set("gpu_requirement", e.target.value)} placeholder="RTX-class / Optional" /></Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="RAM Requirement"><input className="input" value={f.ram_requirement ?? ""} onChange={(e) => set("ram_requirement", e.target.value)} placeholder="8 GB" /></Field>
        <Field label="CUDA Requirement"><input className="input" value={f.cuda_requirement ?? ""} onChange={(e) => set("cuda_requirement", e.target.value)} placeholder="11.8+ / None" /></Field>
      </div>

      <Field label="Release notes">
        <textarea className="input h-14 resize-none" value={f.release_notes ?? ""} onChange={(e) => set("release_notes", e.target.value)} />
      </Field>

      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer text-xs font-medium text-ink-2">Distribution & integrity (optional — set when binaries exist)</summary>
        <div className="mt-3 space-y-3">
          <Field label="Download URL" hint="Left blank until a signed binary is hosted."><input className="input" value={f.download_url ?? ""} onChange={(e) => set("download_url", e.target.value)} /></Field>
          <Field label="SHA256 Checksum"><input className="input font-mono text-xs" value={f.checksum ?? ""} onChange={(e) => set("checksum", e.target.value)} /></Field>
          <Field label="Digital Signature"><input className="input font-mono text-xs" value={f.signature ?? ""} onChange={(e) => set("signature", e.target.value)} /></Field>
        </div>
      </details>

      <Field label="Status">
        <select className="input" value={f.status ?? "published"} onChange={(e) => set("status", e.target.value)}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="deprecated">Deprecated</option>
        </select>
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save model"}</button>
      </div>
    </div>
  );
}
