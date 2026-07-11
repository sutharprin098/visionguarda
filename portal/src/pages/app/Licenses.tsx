import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { License } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import {
  PageHeader, Badge, statusTone, Modal, ConfirmDialog, Field, SecretReveal,
} from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtDate, fmtDateTime } from "../../lib/format";

type LicenseRow = License & {
  profiles: { id: string; full_name: string; email: string } | null;
  license_activations: { device_id: string; revoked_at: string | null }[];
};

export default function LicensesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [genOpen, setGenOpen] = useState(false);
  const [transferFor, setTransferFor] = useState<LicenseRow | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);

  const { data: licenses } = useQuery({
    queryKey: ["licenses"],
    queryFn: async () =>
      (await supabase
        .from("licenses")
        .select("*, profiles(id, full_name, email), license_activations(device_id, revoked_at)")
        .order("created_at", { ascending: false })).data as LicenseRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["licenses"] });

  async function setStatus(l: LicenseRow, status: License["status"]) {
    const { error } = await supabase.from("licenses").update({ status }).eq("id", l.id);
    if (error) return;
    if (status === "revoked" || status === "suspended") {
      await supabase.from("license_activations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("license_id", l.id).is("revoked_at", null);
    }
    audit(`license.${status}`, "license", l.id, { module: "licenses", old: { status: l.status }, new: { status } });
    refresh();
  }

  const columns: Column<LicenseRow>[] = [
    { key: "key", header: "Key", value: (l) => l.key_hint, render: (l) => <span className="keychip">{l.key_hint}</span> },
    {
      key: "user", header: "Assigned To", sortable: true, value: (l) => l.profiles?.full_name ?? "Unassigned",
      render: (l) => (
        <div className="min-w-0">
          <div className="truncate text-ink-1">{l.profiles?.full_name ?? "Unassigned"}</div>
          <div className="truncate text-xs text-ink-3">{l.profiles?.email}</div>
        </div>
      ),
    },
    {
      key: "kind", header: "Kind", filter: true, value: (l) => l.kind,
      render: (l) => <Badge tone={l.kind === "admin" ? "accent" : "default"}>{l.kind}</Badge>,
    },
    {
      key: "type", header: "Type", filter: true, value: (l) => l.license_type,
      render: (l) => <span className="text-ink-2">{l.license_type}</span>,
    },
    {
      key: "devices", header: "Devices", sortable: true,
      value: (l) => l.license_activations?.filter((a) => !a.revoked_at).length ?? 0,
      render: (l) => `${l.license_activations?.filter((a) => !a.revoked_at).length ?? 0} / ${l.max_devices}`,
    },
    {
      key: "status", header: "Status", filter: true, value: (l) => l.status,
      render: (l) => <Badge tone={statusTone[l.status]}>{l.status}</Badge>,
    },
    {
      key: "expires", header: "Expires", sortable: true, value: (l) => l.expires_at ?? "",
      render: (l) => <span className="text-ink-3">{l.expires_at ? fmtDate(l.expires_at) : "Never"}</span>,
    },
    {
      key: "created", header: "Created", sortable: true, value: (l) => l.created_at,
      render: (l) => <span className="text-ink-3">{fmtDateTime(l.created_at)}</span>,
    },
    ...(can("licenses.manage")
      ? [{
          key: "actions", header: "", render: (l: LicenseRow) => (
            <div className="space-x-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
              {l.status === "active" && (
                <>
                  <button className="text-xs text-accent hover:underline" onClick={() => setTransferFor(l)}>Transfer</button>
                  <button className="text-xs text-warn hover:underline" onClick={() =>
                    setConfirm({
                      title: "Suspend license",
                      body: `Suspend ${l.key_hint}? Its device activations are revoked until re-activated.`,
                      danger: true,
                      run: () => setStatus(l, "suspended"),
                    })}>Suspend</button>
                  <button className="text-xs text-danger hover:underline" onClick={() =>
                    setConfirm({
                      title: "Revoke license",
                      body: `Permanently revoke ${l.key_hint}? Bound desktops fail closed to the activation screen. This cannot be undone.`,
                      danger: true,
                      run: () => setStatus(l, "revoked"),
                    })}>Revoke</button>
                </>
              )}
              {(l.status === "suspended" || l.status === "inactive" || l.status === "pending") && (
                <button className="text-xs text-ok hover:underline" onClick={() => setStatus(l, "active")}>Activate</button>
              )}
            </div>
          ),
        } as Column<LicenseRow>]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Licenses"
        subtitle="Keys are stored as SHA-256 hashes; the plaintext is shown exactly once at generation."
        actions={
          can("licenses.manage") && (
            <button className="btn-primary" onClick={() => setGenOpen(true)}>
              <KeyRound size={15} /> Generate License
            </button>
          )
        }
      />
      <DataTable
        rows={licenses ?? []}
        columns={columns}
        rowKey={(l) => l.id}
        searchText={(l) => `${l.key_hint} ${l.profiles?.full_name ?? ""} ${l.profiles?.email ?? ""} ${l.license_type} ${l.status}`}
        exportName="licenses"
        emptyText="No licenses yet."
      />

      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate license">
        <GenerateForm onDone={(key) => { setGenOpen(false); if (key) setRevealed(key); refresh(); }} />
      </Modal>

      <Modal open={!!transferFor} onClose={() => setTransferFor(null)} title={`Transfer ${transferFor?.key_hint}`}>
        {transferFor && (
          <TransferForm license={transferFor} onDone={() => { setTransferFor(null); refresh(); }} />
        )}
      </Modal>

      <Modal open={!!revealed} onClose={() => setRevealed(null)} title="License generated">
        {revealed && (
          <>
            <SecretReveal label="License key" secret={revealed} />
            <button className="btn-primary mt-4 w-full" onClick={() => setRevealed(null)}>Done</button>
          </>
        )}
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

function GenerateForm({ onDone }: { onDone: (key?: string) => void }) {
  const [form, setForm] = useState({ user_id: "", license_type: "personal", expires_at: "", max_devices: 1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").order("full_name")).data ?? [],
  });

  async function submit() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("generate_license", {
      p_user_id: form.user_id,
      p_license_type: form.license_type,
      p_expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      p_max_devices: form.max_devices,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onDone(data as string);
  }

  return (
    <div className="space-y-3">
      <Field label="User">
        <select className="input" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
          <option value="">Select user…</option>
          {users?.map((u: any) => <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className="input" value={form.license_type} onChange={(e) => setForm({ ...form, license_type: e.target.value })}>
            {["personal", "enterprise", "trial", "lifetime", "subscription"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Max devices">
          <input className="input" type="number" min={1} value={form.max_devices}
                 onChange={(e) => setForm({ ...form, max_devices: Math.max(1, Number(e.target.value)) })} />
        </Field>
      </div>
      <Field label="Expires" hint="Leave empty for a perpetual key.">
        <input className="input" type="date" value={form.expires_at}
               onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !form.user_id}>
        {busy ? "Generating…" : "Generate"}
      </button>
    </div>
  );
}

function TransferForm({ license, onDone }: { license: LicenseRow; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").order("full_name")).data ?? [],
  });

  async function submit() {
    setBusy(true);
    await supabase.from("licenses").update({ user_id: userId }).eq("id", license.id);
    // activations belong to the previous owner's devices — revoke them
    await supabase.from("license_activations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("license_id", license.id).is("revoked_at", null);
    audit("license.transfer", "license", license.id, {
      module: "licenses",
      old: { user_id: license.user_id },
      new: { user_id: userId },
    });
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="New owner">
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Select user…</option>
          {users?.filter((u: any) => u.id !== license.user_id)
                 .map((u: any) => <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>)}
        </select>
      </Field>
      <p className="text-xs text-warn">
        Existing device activations are revoked; the new owner activates on their own machine with the same key.
      </p>
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !userId}>
        {busy ? "Transferring…" : "Transfer License"}
      </button>
    </div>
  );
}
