import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, ConfirmDialog } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";

interface ActivationRow {
  id: string;
  license_id: string;
  device_id: string;
  activated_at: string;
  revoked_at: string | null;
  licenses: { key_hint: string; profiles: { full_name: string; email: string } | null } | null;
  devices: { name: string; is_online: boolean; last_seen_at: string | null } | null;
}

export default function ActivationsPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => Promise<void> } | null>(null);

  const { data: activations } = useQuery({
    queryKey: ["activations"],
    queryFn: async () =>
      (await supabase
        .from("license_activations")
        .select("*, licenses(key_hint, profiles(full_name, email)), devices(name, is_online, last_seen_at)")
        .order("activated_at", { ascending: false })).data as ActivationRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["activations"] });

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
      key: "connection", header: "Connection", value: (a) => (a.devices?.is_online ? "online" : "offline"),
      render: (a) => a.devices?.is_online
        ? <Badge tone="ok">online</Badge>
        : <span className="text-xs text-ink-3">{fmtAgo(a.devices?.last_seen_at)}</span>,
    },
    {
      key: "status", header: "Status", filter: true, value: (a) => (a.revoked_at ? "revoked" : "active"),
      render: (a) => a.revoked_at
        ? <Badge tone="danger">revoked {fmtAgo(a.revoked_at)}</Badge>
        : <Badge tone="ok">active</Badge>,
    },
    ...(can("devices.manage")
      ? [{
          key: "actions", header: "", render: (a: ActivationRow) => (
            <div className="text-right" onClick={(e) => e.stopPropagation()}>
              {!a.revoked_at && (
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
