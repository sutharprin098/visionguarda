// Super-admin console: every organization on the platform.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { audit } from "../../lib/audit";
import { PageHeader, Badge, statusTone, Kpi, ConfirmDialog } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtDate, fmtMoney } from "../../lib/format";

interface OrgRow {
  id: string; org_code: string; name: string; kind: string; plan: string;
  is_active: boolean; created_at: string;
  profiles: { count: number }[]; devices: { count: number }[]; licenses: { count: number }[];
}

export default function OrganizationsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<{ org: OrgRow; action: "suspend" | "reactivate" | "delete" } | null>(null);

  const { data: platform } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: async () => (await supabase.rpc("platform_stats")).data as Record<string, any> | null,
  });

  const { data: orgs } = useQuery({
    queryKey: ["all-orgs"],
    queryFn: async () =>
      (await supabase
        .from("organizations")
        .select("*, profiles(count), devices(count), licenses(count)")
        .order("created_at", { ascending: false })).data as OrgRow[] | null,
  });

  if (!profile?.is_super_admin) return <Navigate to="/app" replace />;

  async function run() {
    if (!confirm) return;
    const { org, action } = confirm;
    if (action === "delete") {
      await supabase.from("organizations").delete().eq("id", org.id);
      audit("org.delete", "organization", org.id, { module: "organizations", old: { name: org.name } });
    } else {
      const is_active = action === "reactivate";
      await supabase.from("organizations").update({ is_active }).eq("id", org.id);
      audit(`org.${action}`, "organization", org.id, {
        module: "organizations", old: { is_active: org.is_active }, new: { is_active },
      });
    }
    qc.invalidateQueries({ queryKey: ["all-orgs"] });
  }

  const columns: Column<OrgRow>[] = [
    {
      key: "name", header: "Organization", sortable: true, value: (o) => o.name,
      render: (o) => (
        <div>
          <div className="text-ink-1">{o.name}</div>
          <div className="font-mono text-xs text-ink-3">{o.org_code}</div>
        </div>
      ),
    },
    { key: "kind", header: "Type", filter: true, value: (o) => o.kind, render: (o) => <Badge>{o.kind}</Badge> },
    { key: "plan", header: "Plan", filter: true, value: (o) => o.plan, render: (o) => <Badge tone="accent">{o.plan}</Badge> },
    { key: "users", header: "Users", sortable: true, value: (o) => o.profiles?.[0]?.count ?? 0, render: (o) => o.profiles?.[0]?.count ?? 0 },
    { key: "devices", header: "Devices", sortable: true, value: (o) => o.devices?.[0]?.count ?? 0, render: (o) => o.devices?.[0]?.count ?? 0 },
    { key: "licenses", header: "Licenses", sortable: true, value: (o) => o.licenses?.[0]?.count ?? 0, render: (o) => o.licenses?.[0]?.count ?? 0 },
    {
      key: "status", header: "Status", filter: true, value: (o) => (o.is_active ? "active" : "suspended"),
      render: (o) => <Badge tone={statusTone[o.is_active ? "active" : "suspended"]}>{o.is_active ? "active" : "suspended"}</Badge>,
    },
    { key: "created", header: "Created", sortable: true, value: (o) => o.created_at, render: (o) => fmtDate(o.created_at) },
    {
      key: "actions", header: "", width: "140px",
      render: (o) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          {o.is_active ? (
            <button className="text-xs text-warn hover:underline" onClick={() => setConfirm({ org: o, action: "suspend" })}>Suspend</button>
          ) : (
            <button className="text-xs text-ok hover:underline" onClick={() => setConfirm({ org: o, action: "reactivate" })}>Reactivate</button>
          )}
          <button className="text-xs text-danger hover:underline" onClick={() => setConfirm({ org: o, action: "delete" })}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Organizations" subtitle="Platform-wide tenant administration (super admin)." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Organizations" value={platform?.organizations ?? "—"} />
        <Kpi label="Total Users" value={platform?.users ?? "—"} />
        <Kpi label="Active Licenses" value={platform?.licenses ?? "—"} />
        <Kpi label="Revenue" value={platform ? fmtMoney(Number(platform.revenue_cents)) : "—"}
             hint={`${platform?.subscriptions ?? 0} active subscriptions`} />
      </div>
      <DataTable
        rows={orgs ?? []}
        columns={columns}
        rowKey={(o) => o.id}
        searchText={(o) => `${o.name} ${o.org_code}`}
        exportName="organizations"
        emptyText="No organizations."
      />
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={run}
        danger={confirm?.action !== "reactivate"}
        title={`${confirm?.action === "delete" ? "Delete" : confirm?.action === "suspend" ? "Suspend" : "Reactivate"} organization`}
        body={
          confirm?.action === "delete"
            ? `Permanently delete "${confirm.org.name}" and ALL its users, cameras, licenses and data. This cannot be undone.`
            : confirm?.action === "suspend"
            ? `Suspend "${confirm?.org.name}". Its users keep their data but the org is marked inactive.`
            : `Reactivate "${confirm?.org.name}".`
        }
        confirmLabel={confirm?.action === "delete" ? "Delete permanently" : "Confirm"}
      />
    </>
  );
}
