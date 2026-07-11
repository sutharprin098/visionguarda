import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { PageHeader, Badge, Drawer } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtDateTime } from "../../lib/format";

interface AuditRow {
  id: number;
  actor_email: string;
  action: string;
  module: string;
  target_type: string;
  target_id: string;
  ip: string | null;
  browser: string;
  os: string;
  detail: Record<string, unknown>;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

const actionTone = (action: string) =>
  /revoke|delete|remove|suspend|fail/.test(action) ? "danger"
  : /create|generate|activate|invite/.test(action) ? "ok"
  : "default";

export default function AuditPage() {
  const [viewing, setViewing] = useState<AuditRow | null>(null);

  const { data: logs } = useQuery({
    queryKey: ["audit"],
    queryFn: async () =>
      (await supabase
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500)).data as AuditRow[] | null,
  });

  const columns: Column<AuditRow>[] = [
    {
      key: "time", header: "Time", sortable: true, value: (l) => l.created_at,
      render: (l) => <span className="whitespace-nowrap text-xs text-ink-3">{fmtDateTime(l.created_at)}</span>,
    },
    {
      key: "actor", header: "Actor", filter: true, sortable: true, value: (l) => l.actor_email || "system",
      render: (l) => <span className="text-ink-2">{l.actor_email || "system"}</span>,
    },
    {
      key: "action", header: "Action", filter: true, value: (l) => l.action,
      render: (l) => <Badge tone={actionTone(l.action)}>{l.action}</Badge>,
    },
    {
      key: "module", header: "Module", filter: true, value: (l) => l.module || "—",
      render: (l) => <span className="text-ink-3">{l.module || "—"}</span>,
    },
    {
      key: "target", header: "Target", value: (l) => l.target_type ? `${l.target_type} ${l.target_id}` : "",
      render: (l) => l.target_type
        ? <span className="text-ink-2">{l.target_type} <span className="font-mono text-xs text-ink-3">{l.target_id.slice(0, 8)}</span></span>
        : <span className="text-ink-3">—</span>,
    },
    {
      key: "client", header: "Client", value: (l) => [l.browser, l.os].filter(Boolean).join(" · "),
      render: (l) => <span className="text-xs text-ink-3">{[l.browser, l.os].filter(Boolean).join(" · ") || "—"}</span>,
    },
    {
      key: "ip", header: "IP", value: (l) => l.ip ?? "",
      render: (l) => <span className="font-mono text-xs text-ink-3">{l.ip ?? "—"}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only record of every action: who, what, when, from where. Click a row for old → new values."
      />
      <DataTable
        rows={logs ?? []}
        columns={columns}
        rowKey={(l) => String(l.id)}
        searchText={(l) => `${l.actor_email} ${l.action} ${l.module} ${l.target_type} ${l.target_id} ${l.ip ?? ""}`}
        exportName="audit-logs"
        onRowClick={setViewing}
        pageSize={20}
        emptyText="No audit entries yet."
      />

      <Drawer open={!!viewing} onClose={() => setViewing(null)} title={viewing?.action ?? ""}>
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Meta label="Actor" value={viewing.actor_email || "system"} />
              <Meta label="Time" value={fmtDateTime(viewing.created_at)} />
              <Meta label="Module" value={viewing.module || "—"} />
              <Meta label="Target" value={viewing.target_type ? `${viewing.target_type} · ${viewing.target_id}` : "—"} />
              <Meta label="IP" value={viewing.ip ?? "—"} mono />
              <Meta label="Client" value={[viewing.browser, viewing.os].filter(Boolean).join(" · ") || "—"} />
            </div>
            {viewing.old_value && <Json label="Old value" data={viewing.old_value} tone="danger" />}
            {viewing.new_value && <Json label="New value" data={viewing.new_value} tone="ok" />}
            {Object.keys(viewing.detail ?? {}).length > 0 && <Json label="Detail" data={viewing.detail} />}
          </div>
        )}
      </Drawer>
    </>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <div className={`mt-0.5 text-ink-1 ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}

function Json({ label, data, tone }: { label: string; data: unknown; tone?: "ok" | "danger" }) {
  const border = tone === "ok" ? "border-ok/40" : tone === "danger" ? "border-danger/40" : "border-line";
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-3">{label}</div>
      <pre className={`overflow-x-auto rounded-md border ${border} bg-surface-2 p-3 text-xs text-ink-2`}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
