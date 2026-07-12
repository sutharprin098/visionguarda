import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, History } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { License } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import {
  PageHeader, Badge, statusTone, Modal, ConfirmDialog, Field, SecretReveal,
} from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtDate, fmtDateTime } from "../../lib/format";

export const LICENSE_TYPES = ["trial", "monthly", "yearly", "lifetime", "enterprise"] as const;

type LicenseRow = License & {
  profiles: { id: string; full_name: string; email: string } | null;
  license_activations: {
    id: string; device_id: string; activated_at: string; revoked_at: string | null;
    devices: { name: string } | null;
  }[];
};

export default function LicensesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [genOpen, setGenOpen] = useState(false);
  const [transferFor, setTransferFor] = useState<LicenseRow | null>(null);
  const [editFor, setEditFor] = useState<LicenseRow | null>(null);
  const [renewFor, setRenewFor] = useState<LicenseRow | null>(null);
  const [historyFor, setHistoryFor] = useState<LicenseRow | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);

  const { data: licenses } = useQuery({
    queryKey: ["licenses"],
    queryFn: async () =>
      (await supabase
        .from("licenses")
        .select("*, profiles(id, full_name, email), license_activations(id, device_id, activated_at, revoked_at, devices(name))")
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

  async function resetLicense(l: LicenseRow) {
    const { data, error } = await supabase.rpc("reset_license", { p_license_id: l.id });
    if (error) return;
    refresh();
    setRevealed(data as string);
  }

  async function deleteLicense(l: LicenseRow) {
    const { error } = await supabase.rpc("delete_license", { p_license_id: l.id });
    if (error) return;
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
      render: (l) => <span className="capitalize text-ink-2">{l.license_type}</span>,
    },
    {
      key: "devices", header: "Devices", sortable: true,
      value: (l) => l.license_activations?.filter((a) => !a.revoked_at).length ?? 0,
      render: (l) => (
        <button
          className="inline-flex items-center gap-1 text-ink-2 hover:text-accent hover:underline"
          onClick={(e) => { e.stopPropagation(); setHistoryFor(l); }}
          title="View activation history"
        >
          <History size={12} />
          {l.license_activations?.filter((a) => !a.revoked_at).length ?? 0} / {l.max_devices}
        </button>
      ),
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
                  <button className="text-xs text-accent hover:underline" onClick={() => setTransferFor(l)}>
                    {l.user_id ? "Transfer" : "Assign"}
                  </button>
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
              <button className="text-xs text-ink-2 hover:underline" onClick={() => setEditFor(l)}>Edit</button>
              <button className="text-xs text-ink-2 hover:underline" onClick={() => setRenewFor(l)}>Renew</button>
              <button className="text-xs text-warn hover:underline" onClick={() =>
                setConfirm({
                  title: "Reset license",
                  body: `Revoke ${l.key_hint} and issue a fresh key for the same user? Every device currently activated on it is unbound; the new key must be entered manually.`,
                  danger: true,
                  run: () => resetLicense(l),
                })}>Reset</button>
              <button className="text-xs text-danger hover:underline" onClick={() =>
                setConfirm({
                  title: "Delete license",
                  body: `Permanently delete ${l.key_hint}? This removes the record entirely (not just revokes it) and cannot be undone.`,
                  danger: true,
                  run: () => deleteLicense(l),
                })}>Delete</button>
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

      <Modal open={!!transferFor} onClose={() => setTransferFor(null)}
             title={`${transferFor?.user_id ? "Transfer" : "Assign"} ${transferFor?.key_hint}`}>
        {transferFor && (
          <TransferForm license={transferFor} onDone={() => { setTransferFor(null); refresh(); }} />
        )}
      </Modal>

      <Modal open={!!editFor} onClose={() => setEditFor(null)} title={`Edit ${editFor?.key_hint}`}>
        {editFor && (
          <EditForm license={editFor} onDone={() => { setEditFor(null); refresh(); }} />
        )}
      </Modal>

      <Modal open={!!renewFor} onClose={() => setRenewFor(null)} title={`Renew ${renewFor?.key_hint}`}>
        {renewFor && (
          <RenewForm license={renewFor} onDone={() => { setRenewFor(null); refresh(); }} />
        )}
      </Modal>

      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title={`Activation history — ${historyFor?.key_hint}`} wide>
        {historyFor && <ActivationHistory license={historyFor} />}
      </Modal>

      <Modal open={!!revealed} onClose={() => setRevealed(null)} title="License key">
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
  const [form, setForm] = useState({ user_id: "", license_type: "trial", expires_at: "", max_devices: 1 });
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
            {LICENSE_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">{t}</option>
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

function EditForm({ license, onDone }: { license: LicenseRow; onDone: () => void }) {
  const [licenseType, setLicenseType] = useState(license.license_type);
  const [maxDevices, setMaxDevices] = useState(license.max_devices);
  const [expiresAt, setExpiresAt] = useState(license.expires_at ? license.expires_at.slice(0, 10) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("edit_license", {
      p_license_id: license.id,
      p_license_type: licenseType,
      p_max_devices: maxDevices,
      p_expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      p_clear_expiry: !expiresAt,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select className="input" value={licenseType} onChange={(e) => setLicenseType(e.target.value as typeof licenseType)}>
            {LICENSE_TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
          </select>
        </Field>
        <Field label="Max devices">
          <input className="input" type="number" min={1} value={maxDevices}
                 onChange={(e) => setMaxDevices(Math.max(1, Number(e.target.value)))} />
        </Field>
      </div>
      <Field label="Expires" hint="Leave empty for a perpetual key.">
        <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "Saving…" : "Save Changes"}
      </button>
    </div>
  );
}

function RenewForm({ license, onDone }: { license: LicenseRow; onDone: () => void }) {
  const defaultNext = new Date();
  defaultNext.setMonth(defaultNext.getMonth() + (license.license_type === "yearly" ? 12 : 1));
  const [expiresAt, setExpiresAt] = useState(defaultNext.toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("renew_license", {
      p_license_id: license.id,
      p_new_expires_at: new Date(expiresAt).toISOString(),
    });
    setBusy(false);
    if (error) return setError(error.message);
    onDone();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        Currently expires {license.expires_at ? fmtDate(license.expires_at) : "never"}.
      </p>
      <Field label="New expiry date">
        <input className="input" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "Renewing…" : "Renew License"}
      </button>
    </div>
  );
}

function ActivationHistory({ license }: { license: LicenseRow }) {
  const rows = [...(license.license_activations ?? [])].sort(
    (a, b) => new Date(b.activated_at).getTime() - new Date(a.activated_at).getTime(),
  );
  if (!rows.length) return <p className="text-sm text-ink-3">No devices have ever activated this license.</p>;
  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div key={a.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm text-ink-1">{a.devices?.name ?? "Unknown device"}</div>
            <div className="text-xs text-ink-3">Activated {fmtDateTime(a.activated_at)}</div>
          </div>
          {a.revoked_at
            ? <Badge tone="danger">revoked {fmtDate(a.revoked_at)}</Badge>
            : <Badge tone="ok">active</Badge>}
        </div>
      ))}
    </div>
  );
}
