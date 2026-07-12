import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, Modal, ConfirmDialog, Field } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";

interface ActivationRow {
  id: string;
  license_id: string;
  device_id: string;
  activated_at: string;
  revoked_at: string | null;
  licenses: { key_hint: string; profiles: { full_name: string; email: string } | null } | null;
  devices: {
    name: string; is_online: boolean; last_seen_at: string | null; status: string; fingerprint_hash: string;
    desktop_sessions: { app_version: string; created_at: string }[];
  } | null;
}

export default function ActivationsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);
  const [transferFor, setTransferFor] = useState<ActivationRow | null>(null);

  const { data: activations } = useQuery({
    queryKey: ["activations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("license_activations")
        .select(
          "*, licenses(key_hint, profiles(full_name, email)), " +
          "devices(name, is_online, last_seen_at, status, fingerprint_hash, desktop_sessions(app_version, created_at))",
        )
        .order("activated_at", { ascending: false })
        .order("created_at", { referencedTable: "devices.desktop_sessions", ascending: false })
        .limit(1, { referencedTable: "devices.desktop_sessions" });
      return data as ActivationRow[] | null;
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["activations"] });

  async function setDeviceStatus(a: ActivationRow, status: "active" | "deactivated") {
    await supabase.from("devices").update({ status, is_online: false }).eq("id", a.device_id);
    if (status !== "active") {
      await supabase.from("license_activations")
        .update({ revoked_at: new Date().toISOString() }).eq("device_id", a.device_id).is("revoked_at", null);
    }
    audit(`device.${status}`, "device", a.device_id, { module: "licenses" });
    refresh();
  }

  const columns: Column<ActivationRow>[] = [
    {
      key: "device", header: "Device", sortable: true, value: (a) => a.devices?.name ?? "—",
      render: (a) => <span className="text-ink-1">{a.devices?.name ?? "—"}</span>,
    },
    {
      key: "license", header: "License", value: (a) => a.licenses?.key_hint ?? "—",
      render: (a) => <span className="keychip">{a.licenses?.key_hint ?? "—"}</span>,
    },
    {
      key: "user", header: "User", filter: true, sortable: true,
      value: (a) => a.licenses?.profiles?.full_name ?? "—",
      render: (a) => (
        <div className="min-w-0">
          <div className="truncate text-ink-1">{a.licenses?.profiles?.full_name ?? "—"}</div>
          <div className="truncate text-xs text-ink-3">{a.licenses?.profiles?.email}</div>
        </div>
      ),
    },
    {
      key: "activated", header: "Activated", sortable: true, value: (a) => a.activated_at,
      render: (a) => <span className="text-ink-3">{fmtDateTime(a.activated_at)}</span>,
    },
    {
      key: "connection", header: "Last Online", value: (a) => (a.devices?.is_online ? "online" : "offline"),
      render: (a) => a.devices?.is_online
        ? <Badge tone="ok">online</Badge>
        : <span className="text-xs text-ink-3">{fmtAgo(a.devices?.last_seen_at)}</span>,
    },
    {
      key: "version", header: "Version", value: (a) => a.devices?.desktop_sessions?.[0]?.app_version ?? "",
      render: (a) => <span className="font-mono text-xs text-ink-3">{a.devices?.desktop_sessions?.[0]?.app_version || "—"}</span>,
    },
    {
      key: "fingerprint", header: "Fingerprint", value: (a) => a.devices?.fingerprint_hash ?? "",
      render: (a) => a.devices?.fingerprint_hash
        ? <span className="keychip font-mono text-[11px]" title={a.devices.fingerprint_hash}>{a.devices.fingerprint_hash.slice(0, 12)}…</span>
        : <span className="text-ink-3">—</span>,
    },
    {
      key: "status", header: "Status", filter: true,
      value: (a) => (a.revoked_at ? "revoked" : a.devices?.status === "deactivated" ? "deactivated" : "active"),
      render: (a) => a.revoked_at
        ? <Badge tone="danger">revoked {fmtAgo(a.revoked_at)}</Badge>
        : a.devices?.status === "deactivated"
        ? <Badge tone="warn">deactivated</Badge>
        : <Badge tone="ok">active</Badge>,
    },
    ...(can("devices.manage")
      ? [{
          key: "actions", header: "", render: (a: ActivationRow) => (
            <div className="space-x-2 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
              <button className="text-xs text-accent hover:underline" onClick={() => setTransferFor(a)}>Transfer</button>
              {a.devices?.status === "deactivated" ? (
                <button className="text-xs text-ok hover:underline" onClick={() => setDeviceStatus(a, "active")}>Reactivate</button>
              ) : (
                <button className="text-xs text-warn hover:underline" onClick={() =>
                  setConfirm({
                    title: "Deactivate device",
                    body: `Deactivate ${a.devices?.name ?? "this device"}? It is blocked from re-activating until an admin reactivates it.`,
                    run: () => setDeviceStatus(a, "deactivated"),
                  })}>Deactivate</button>
              )}
              {a.revoked_at ? (
                <button className="text-xs text-ink-2 hover:underline" onClick={() =>
                  setConfirm({
                    title: "Reset activation",
                    body: `Restore this activation for ${a.devices?.name ?? "the device"} on ${a.licenses?.key_hint}, undoing the earlier revoke? The device counts against the license's device limit again immediately.`,
                    run: async () => {
                      await supabase.from("license_activations")
                        .update({ revoked_at: null }).eq("id", a.id);
                      audit("activation.reset", "activation", a.id, { module: "licenses" });
                      refresh();
                    },
                  })}>Reset</button>
              ) : (
                <button className="text-xs text-danger hover:underline" onClick={() =>
                  setConfirm({
                    title: "Revoke activation",
                    body: `Unbind ${a.devices?.name ?? "this device"} from ${a.licenses?.key_hint}? The desktop falls back to the activation screen on its next sync.`,
                    run: async () => {
                      await supabase.from("license_activations")
                        .update({ revoked_at: new Date().toISOString() }).eq("id", a.id);
                      audit("activation.revoke", "activation", a.id, { module: "licenses" });
                      refresh();
                    },
                  })}>Revoke</button>
              )}
            </div>
          ),
        } as Column<ActivationRow>]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Desktop Activations"
        subtitle="Every license → device binding. Revoking forces the desktop back to the activation screen within one sync."
      />
      <DataTable
        rows={activations ?? []}
        columns={columns}
        rowKey={(a) => a.id}
        searchText={(a) => `${a.devices?.name ?? ""} ${a.licenses?.key_hint ?? ""} ${a.licenses?.profiles?.full_name ?? ""}`}
        exportName="activations"
        emptyText="No desktop activations yet."
      />
      <Modal open={!!transferFor} onClose={() => setTransferFor(null)} title={`Transfer ${transferFor?.devices?.name ?? "device"}`}>
        {transferFor && (
          <TransferDeviceForm activation={transferFor} onDone={() => { setTransferFor(null); refresh(); }} />
        )}
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

function TransferDeviceForm({ activation, onDone }: { activation: ActivationRow; onDone: () => void }) {
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").order("full_name")).data ?? [],
  });

  async function submit() {
    setBusy(true);
    await supabase.from("devices").update({ user_id: userId }).eq("id", activation.device_id);
    await supabase.from("license_activations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("device_id", activation.device_id).is("revoked_at", null);
    audit("device.transfer", "device", activation.device_id, { module: "licenses" });
    setBusy(false);
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="New owner">
        <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Select user…</option>
          {users?.map((u: any) => <option key={u.id} value={u.id}>{u.full_name} — {u.email}</option>)}
        </select>
      </Field>
      <p className="text-xs text-warn">
        The current activation is revoked; the new owner activates on this machine with their own license key.
      </p>
      <button className="btn-primary w-full" onClick={submit} disabled={busy || !userId}>
        {busy ? "Transferring…" : "Transfer Device"}
      </button>
    </div>
  );
}
