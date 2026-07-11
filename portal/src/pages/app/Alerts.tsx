import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { Alert } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Drawer } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";

type AlertRow = Alert & {
  cameras: { name: string } | null;
  ack_profile: { full_name: string } | null;
};

export default function AlertsPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [viewing, setViewing] = useState<AlertRow | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () =>
      (await supabase
        .from("alerts")
        .select("*, cameras(name), ack_profile:profiles!alerts_acknowledged_by_fkey(full_name)")
        .order("created_at", { ascending: false })
        .limit(500)).data as AlertRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["alerts"] });

  // new AI events appear without a reload
  useEffect(() => {
    const ch = supabase
      .channel("alerts-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // signed snapshot URL when a row with a snapshot is opened
  useEffect(() => {
    setSnapshotUrl(null);
    if (!viewing?.snapshot_path) return;
    supabase.storage.from("snapshots").createSignedUrl(viewing.snapshot_path, 300)
      .then(({ data }) => setSnapshotUrl(data?.signedUrl ?? null));
  }, [viewing?.id]);

  async function acknowledge(rows: AlertRow[]) {
    const ids = rows.filter((a) => !a.acknowledged_at).map((a) => a.id);
    if (!ids.length) return;
    await supabase.from("alerts")
      .update({ acknowledged_by: profile?.id, acknowledged_at: new Date().toISOString() })
      .in("id", ids);
    audit("alert.acknowledge", "alert", ids.join(","), { module: "alerts", detail: { count: ids.length } });
    refresh();
  }

  const columns: Column<AlertRow>[] = [
    {
      key: "severity", header: "Severity", filter: true, value: (a) => a.severity,
      render: (a) => <Badge tone={statusTone[a.severity]}>{a.severity}</Badge>,
    },
    {
      key: "kind", header: "Kind", filter: true, value: (a) => a.kind,
      render: (a) => <span className="text-ink-2">{a.kind.replaceAll("_", " ")}</span>,
    },
    {
      key: "title", header: "Alert", sortable: true, value: (a) => a.title,
      render: (a) => <span className="text-ink-1">{a.title}</span>,
    },
    {
      key: "camera", header: "Camera", filter: true, value: (a) => a.cameras?.name ?? "—",
      render: (a) => <span className="text-ink-2">{a.cameras?.name ?? "—"}</span>,
    },
    {
      key: "time", header: "Time", sortable: true, value: (a) => a.created_at,
      render: (a) => <span className="whitespace-nowrap text-xs text-ink-3">{fmtAgo(a.created_at)}</span>,
    },
    {
      key: "ack", header: "Acknowledged", filter: true, value: (a) => (a.acknowledged_at ? "yes" : "no"),
      render: (a) => a.acknowledged_at
        ? <span className="text-xs text-ink-3">{a.ack_profile?.full_name ?? "—"} · {fmtAgo(a.acknowledged_at)}</span>
        : <Badge tone="warn">unacknowledged</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="AI events from your cameras — intrusion, line crossing, speed, jams, plus platform alerts. Live via Realtime."
      />
      <DataTable
        rows={alerts ?? []}
        columns={columns}
        rowKey={(a) => a.id}
        searchText={(a) => `${a.title} ${a.kind} ${a.severity} ${a.cameras?.name ?? ""}`}
        exportName="alerts"
        onRowClick={setViewing}
        pageSize={15}
        emptyText="No alerts yet — they appear here the moment the AI engine raises one."
        bulkActions={[{ label: "Acknowledge", run: acknowledge }]}
      />

      <Drawer open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title ?? ""}>
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone={statusTone[viewing.severity]}>{viewing.severity}</Badge>
              <Badge>{viewing.kind.replaceAll("_", " ")}</Badge>
              <span className="text-xs text-ink-3">{fmtDateTime(viewing.created_at)}</span>
            </div>
            {viewing.cameras && <p className="text-sm text-ink-2">Camera: {viewing.cameras.name}</p>}
            {snapshotUrl && (
              <img src={snapshotUrl} alt="Alert snapshot"
                   className="w-full rounded-md border border-line" />
            )}
            {Object.keys(viewing.detail ?? {}).length > 0 && (
              <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 text-xs text-ink-2">
                {JSON.stringify(viewing.detail, null, 2)}
              </pre>
            )}
            {!viewing.acknowledged_at ? (
              <button className="btn-primary w-full" onClick={async () => { await acknowledge([viewing]); setViewing(null); }}>
                Acknowledge
              </button>
            ) : (
              <p className="text-xs text-ink-3">
                Acknowledged by {viewing.ack_profile?.full_name ?? "—"} · {fmtDateTime(viewing.acknowledged_at)}
              </p>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
