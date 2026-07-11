import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subDays, format, startOfDay } from "date-fns";
import { supabase } from "../../lib/supabase";
import { PageHeader, Kpi, Badge, statusTone } from "../../components/ui";
import { TimeSeries } from "../../components/charts";
import { fmtBytes } from "../../lib/format";

const RANGES = { "7 days": 7, "30 days": 30, "90 days": 90 } as const;
type RangeKey = keyof typeof RANGES;

interface AlertSlim {
  kind: string;
  severity: string;
  camera_id: string | null;
  created_at: string;
  cameras: { name: string } | null;
}

export default function AnalyticsPage() {
  const qc = useQueryClient();
  const [range, setRange] = useState<RangeKey>("30 days");
  const days = RANGES[range];
  const since = useMemo(() => subDays(startOfDay(new Date()), days - 1), [days]);

  const { data: stats } = useQuery({
    queryKey: ["org-stats"],
    queryFn: async () => (await supabase.rpc("org_stats")).data as Record<string, any> | null,
  });

  const { data: alerts } = useQuery({
    queryKey: ["analytics-alerts", days],
    queryFn: async () =>
      (await supabase
        .from("alerts")
        .select("kind, severity, camera_id, created_at, cameras(name)")
        .gte("created_at", since.toISOString())
        .order("created_at")).data as AlertSlim[] | null,
  });

  const { data: usage } = useQuery({
    queryKey: ["analytics-usage", days],
    queryFn: async () =>
      (await supabase
        .from("usage_logs")
        .select("metric, quantity, recorded_at")
        .in("metric", ["stream_minutes", "inference_frames"])
        .gte("recorded_at", since.toISOString())
        .order("recorded_at")).data ?? [],
  });

  useEffect(() => {
    const ch = supabase
      .channel("analytics-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, () =>
        qc.invalidateQueries({ queryKey: ["analytics-alerts", days] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [days]);

  // ---- aggregations (all from live rows; nothing synthesized) ----
  const byDay = useMemo(() => {
    const buckets = new Map<string, { day: string; critical: number; warning: number; info: number }>();
    for (let i = 0; i < days; i++) {
      const d = format(subDays(new Date(), days - 1 - i), days > 31 ? "dd MMM" : "dd MMM");
      buckets.set(d, { day: d, critical: 0, warning: 0, info: 0 });
    }
    for (const a of alerts ?? []) {
      const d = format(new Date(a.created_at), "dd MMM");
      const b = buckets.get(d);
      if (b) (b as any)[a.severity] = ((b as any)[a.severity] ?? 0) + 1;
    }
    return [...buckets.values()];
  }, [alerts, days]);

  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alerts ?? []) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
    return [...m.entries()]
      .map(([kind, count]) => ({ kind: kind.replaceAll("_", " "), count }))
      .sort((a, b) => b.count - a.count);
  }, [alerts]);

  const byCamera = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alerts ?? []) {
      const name = a.cameras?.name ?? "platform";
      m.set(name, (m.get(name) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([camera, count]) => ({ camera, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [alerts]);

  const usageByDay = useMemo(() => {
    const buckets = new Map<string, { day: string; stream_minutes: number; inference_frames: number }>();
    for (let i = 0; i < days; i++) {
      const d = format(subDays(new Date(), days - 1 - i), "dd MMM");
      buckets.set(d, { day: d, stream_minutes: 0, inference_frames: 0 });
    }
    for (const u of usage as any[]) {
      const d = format(new Date(u.recorded_at), "dd MMM");
      const b = buckets.get(d);
      if (b) (b as any)[u.metric] += Number(u.quantity);
    }
    return [...buckets.values()];
  }, [usage, days]);

  const total = alerts?.length ?? 0;
  const critical = alerts?.filter((a) => a.severity === "critical").length ?? 0;
  const hasUsage = (usage as any[]).length > 0;

  return (
    <>
      <PageHeader
        title="AI Analytics"
        subtitle="Detection and platform activity for your organization, computed from live event data."
        actions={
          <div className="flex gap-1 rounded-md border border-line p-0.5">
            {(Object.keys(RANGES) as RangeKey[]).map((r) => (
              <button key={r}
                      className={`rounded px-2.5 py-1 text-xs transition ${range === r ? "bg-accent/15 font-medium text-accent" : "text-ink-3 hover:text-ink-1"}`}
                      onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`Events (${range})`} value={total} />
        <Kpi label="Critical" value={critical}
             hint={total ? `${Math.round((critical / total) * 100)}% of all events` : undefined} />
        <Kpi label="Cameras Online" value={`${stats?.cameras_online ?? 0} / ${stats?.cameras ?? 0}`} />
        <Kpi label="Storage Used" value={stats ? fmtBytes(Number(stats.storage_mb)) : "—"} />
      </div>

      <div className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-1">Events by severity</h2>
        {total > 0 ? (
          <TimeSeries data={byDay} xKey="day" kind="area" height={260}
                      series={[
                        { key: "critical", name: "Critical" },
                        { key: "warning", name: "Warning" },
                        { key: "info", name: "Info" },
                      ]} />
        ) : (
          <EmptyChart text={`No events in the last ${range}.`} />
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-1">Events by type</h2>
          {byKind.length ? (
            <TimeSeries data={byKind} xKey="kind" kind="bar" height={240}
                        series={[{ key: "count", name: "Events" }]} />
          ) : (
            <EmptyChart text="No events to categorize." />
          )}
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-ink-1">Top cameras by events</h2>
          {byCamera.length ? (
            <div className="space-y-2">
              {byCamera.map((c) => (
                <div key={c.camera} className="flex items-center gap-3">
                  <span className="w-36 truncate text-sm text-ink-2">{c.camera}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-accent"
                         style={{ width: `${(c.count / byCamera[0].count) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs text-ink-3">{c.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyChart text="No camera events yet." />
          )}
        </div>
      </div>

      <div className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-1">Engine usage</h2>
        {hasUsage ? (
          <TimeSeries data={usageByDay} xKey="day" kind="line" height={240}
                      series={[
                        { key: "stream_minutes", name: "Stream minutes" },
                        { key: "inference_frames", name: "Inference frames" },
                      ]} />
        ) : (
          <EmptyChart text="Usage metrics appear once a desktop AI engine reports stream_minutes / inference_frames." />
        )}
      </div>

      {/* recent critical events */}
      <div className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-1">Latest critical events</h2>
        {!alerts?.some((a) => a.severity === "critical") ? (
          <p className="py-4 text-center text-sm text-ink-3">No critical events in this range.</p>
        ) : (
          <div className="divide-y divide-line">
            {alerts.filter((a) => a.severity === "critical").slice(-8).reverse().map((a, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={statusTone[a.severity]}>{a.kind.replaceAll("_", " ")}</Badge>
                  <span className="truncate text-sm text-ink-2">{a.cameras?.name ?? "platform"}</span>
                </div>
                <span className="shrink-0 text-xs text-ink-3">{format(new Date(a.created_at), "dd MMM HH:mm")}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function EmptyChart({ text }: { text: string }) {
  return <p className="py-12 text-center text-sm text-ink-3">{text}</p>;
}
