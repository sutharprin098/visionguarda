import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { Device } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Modal, ConfirmDialog, Field } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo } from "../../lib/format";

type DeviceRow = Device & { profiles: { id: string; full_name: string } | null };

export default function DevicesPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [renameFor, setRenameFor] = useState<DeviceRow | null>(null);
  const [transferFor, setTransferFor] = useState<DeviceRow | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; run: () => Promise<void> } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn: async () =>
      (await supabase
        .from("devices")
        .select("*, profiles(id, full_name)")
        .order("created_at", { ascending: false })).data as DeviceRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["devices"] });

  async function setStatus(d: DeviceRow, status: Device["status"]) {
    setActionError(null);
    const { error } = await supabase.from("devices").update({ status, is_online: false }).eq("id", d.id);
    if (error) return setActionError(error.message);
    if (status !== "active") {
      // revoke any activation bound to this device (policy: 0005 activations_revoke)
      const { error: revokeErr } = await supabase.from("license_activations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("device_id", d.id).is("revoked_at", null);
      if (revokeErr) return setActionError(revokeErr.message);
    } else {
      // reactivating must also clear the revoke, or desktop-sync keeps
      // failing closed (it requires an unrevoked activation row) even
      // though the device now shows "active"
      const { error: clearErr } = await supabase.from("license_activations")
        .update({ revoked_at: null })
        .eq("device_id", d.id).not("revoked_at", "is", null);
      if (clearErr) return setActionError(clearErr.message);
    }
    audit(`device.${status}`, "device", d.id, { module: "devices", old: { status: d.status }, new: { status } });
    refresh();
  }

  async function resetDevice(d: DeviceRow) {
    setActionError(null);
    const { error } = await supabase.from("license_activations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("device_id", d.id).is("revoked_at", null);
    if (error) return setActionError(error.message);
    audit("device.reset", "device", d.id, { module: "devices" });
    refresh();
  }

  const columns: Column<DeviceRow>[] = [
    {
      key: "device", header: "Device", sortable: true, value: (d) => d.name,
      render: (d) => (
        <div className="flex items-center gap-2">
          <MonitorSmartphone size={14} className="shrink-0 text-ink-3" />
          <div className="min-w-0">
            <div className="truncate text-ink-1">{d.name}</div>
            <div className="truncate text-xs text-ink-3">{(d.os_info as any)?.release ?? "Windows"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "owner", header: "Owner", filter: true, sortable: true, value: (d) => d.profiles?.full_name ?? "—",
      render: (d) => <span className="text-ink-2">{d.profiles?.full_name ?? "—"}</span>,
    },
    {
      key: "hardware", header: "Hardware", value: (d) => d.hardware?.cpu ?? "",
      render: (d) => (
        <div className="text-xs text-ink-3">
          <div className="max-w-[220px] truncate">{d.hardware?.cpu ?? "—"}</div>
          <div>
            {d.hardware?.ram_gb ? `${d.hardware.ram_gb} GB RAM` : ""}
            {d.hardware?.gpu ? ` · ${d.hardware.gpu}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "ip", header: "Last IP", value: (d) => d.last_ip ?? "",
      render: (d) => <span className="font-mono text-xs text-ink-3">{d.last_ip ?? "—"}</span>,
    },
    {
      key: "fingerprint", header: "Fingerprint", value: (d) => d.fingerprint_hash,
      render: (d) => <span className="keychip font-mono text-[11px]" title={d.fingerprint_hash}>{d.fingerprint_hash.slice(0, 12)}…</span>,
    },
    {
      key: "online", header: "Connection", filter: true, value: (d) => (d.is_online ? "online" : "offline"),
      render: (d) => d.is_online
        ? <Badge tone="ok">online</Badge>
        : <span className="text-xs text-ink-3">{fmtAgo(d.last_seen_at)}</span>,
    },
    {
      key: "status", header: "Status", filter: true, value: (d) => d.status,
      render: (d) => <Badge tone={statusTone[d.status]}>{d.status}</Badge>,
    },
    ...(can("devices.manage")
      ? [{
          key: "actions", header: "", render: (d: DeviceRow) => (
            <div className="space-x-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
              <button className="text-xs text-ink-2 hover:underline" onClick={() => setRenameFor(d)}>Rename</button>
              <button className="text-xs text-accent hover:underline" onClick={() => setTransferFor(d)}>Transfer</button>
              <button className="text-xs text-warn hover:underline" onClick={() =>
                setConfirm({
                  title: "Reset device",
                  body: `Reset ${d.name}? Its current license activation is revoked; the user must enter a license key again on next launch. The device itself stays enabled.`,
                  danger: true,
                  run: () => resetDevice(d),
                })}>Reset</button>
              {d.status === "active" ? (
                <button className="text-xs text-warn hover:underline" onClick={() =>
                  setConfirm({
                    title: "Deactivate device",
                    body: `Deactivate ${d.name}? Its desktop session is revoked and it must re-activate with a valid license.`,
                    danger: true,
                    run: () => setStatus(d, "deactivated"),
                  })}>Deactivate</button>
              ) : d.status === "deactivated" ? (
                <button className="text-xs text-ok hover:underline" onClick={() => setStatus(d, "active")}>Reactivate</button>
              ) : null}
              {d.status !== "removed" && (
                <button className="text-xs text-danger hover:underline" onClick={() =>
                  setConfirm({
                    title: "Remove device",
                    body: `Remove ${d.name} permanently? The hardware fingerprint stays blocked until an admin reactivates it.`,
                    danger: true,
                    run: () => setStatus(d, "removed"),
                  })}>Remove</button>
              )}
            </div>
          ),
        } as Column<DeviceRow>]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Windows machines bound to licenses via encrypted hardware fingerprints (CPU · board · disk · TPM · MachineGuid)."
      />
      {actionError && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          <span>{actionError}</span>
          <button className="text-xs underline" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}
      <DataTable
        rows={devices ?? []}
        columns={columns}
        rowKey={(d) => d.id}
        searchText={(d) => `${d.name} ${d.profiles?.full_name ?? ""} ${d.hardware?.cpu ?? ""} ${d.last_ip ?? ""}`}
        exportName="devices"
        emptyText="No devices activated yet. Install the desktop app and enter a license key."
      />

      <Modal open={!!renameFor} onClose={() => setRenameFor(null)} title="Rename device">
        {renameFor && (
          <RenameForm device={renameFor} onDone={() => { setRenameFor(null); refresh(); }} />
        )}
      </Modal>

      <Modal open={!!transferFor} onClose={() => setTransferFor(null)} title={`Transfer ${transferFor?.name}`}>
        {transferFor && (
          <TransferForm device={transferFor} onDone={() => { setTransferFor(null); refresh(); }} />
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

function RenameForm({ device, onDone }: { device: DeviceRow; onDone: () => void }) {
  const [name, setName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    const { error: err } = await supabase.from("devices").update({ name }).eq("id", device.id);
    if (err) {
      setBusy(false);
      return setError(err.message);
    }
    audit("device.rename", "device", device.id, { module: "devices", old: { name: device.name }, new: { name } });
    setBusy(false);
    onDone();
  }
  return (
    <div className="space-y-3">
      <Field label="Device name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !name.trim()}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function TransferForm({ device, onDone }: { device: DeviceRow; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").order("full_name")).data ?? [],
  });

  async function submit() {
    setBusy(true);
    setError("");
    const { error: updErr } = await supabase.from("devices").update({ user_id: userId }).eq("id", device.id);
    if (updErr) {
      setBusy(false);
      return setError(updErr.message);
    }
    // old owner's activation no longer applies on this machine
    const { error: revokeErr } = await supabase.from("license_activations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("device_id", device.id).is("revoked_at", null);
    if (revokeErr) {
      setBusy(false);
      return setError(revokeErr.message);
    }
    audit("device.transfer", "device", device.id, {
      module: "devices",
      old: { user_id: device.user_id },
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
          {users?.filter((u: any) => u.id !== device.user_id)
                 .map((u: any) => <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>)}
        </select>
      </Field>
      <p className="text-xs text-warn">
        The current activation is revoked; the new owner activates on this machine with their own license key.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !userId}>
        {busy ? "Transferring…" : "Transfer Device"}
      </button>
    </div>
  );
}
