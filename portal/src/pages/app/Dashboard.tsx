import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Kpi, Badge, statusTone, Empty } from "../../components/ui";
import { TimeSeries, Spark } from "../../components/charts";
import { fmtAgo, fmtBytes } from "../../lib/format";

export default function Dashboard() {
  const { org, profile } = useAuth();
  const qc = useQueryClient();

  const { data: stats } = useQuery({
    queryKey: ["org-stats"],
    queryFn: async () => (await supabase.rpc("org_stats")).data as Record<string, any> | null,
  });

  const { data: recent } = useQuery({
    queryKey: ["dash-recent"],
    queryFn: async () => {
      const [alerts, users, activations, cameras, telemetry] = await Promise.all([
        supabase.from("alerts").select("id, kind, severity, title, created_at")
          .order("created_at", { ascending: false }).limit(6),
        supabase.from("profiles").select("id, full_name, email, created_at")
          .order("created_at", { ascending: false }).limit(5),
        supabase.from("devices").select("id, name, is_online, last_seen_at, profiles(full_name)")
          .order("created_at", { ascending: false }).limit(5),
        supabase.from("cameras").select("id, name, status").order("name"),
        supabase.from("usage_logs").select("metric, quantity, recorded_at")
          .in("metric", ["cpu_pct", "gpu_pct", "mem_pct"])
          .order("recorded_at", { ascending: false }).limit(30),
      ]);
      const latest: Record<string, number> = {};
      for (const row of telemetry.data ?? []) {
        if (!(row.metric in latest)) latest[row.metric] = Number(row.quantity);
      }
      return {
        alerts: alerts.data ?? [],
        users: users.data ?? [],
        activations: activations.data ?? [],
        cameras: cameras.data ?? [],
        telemetry: latest,
      };
    },
  });

  // realtime: refresh stats when alerts/devices/cameras change
  useEffect(() => {
    const ch = supabase
      .channel("dash-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => {
        qc.invalidateQueries({ queryKey: ["org-stats"] });
        qc.invalidateQueries({ queryKey: ["dash-recent"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, () =>
        qc.invalidateQueries({ queryKey: ["dash-recent"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "devices" }, () =>
        qc.invalidateQueries({ queryKey: ["dash-recent"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const events7d: { day: string; count: number }[] = (stats?.events_7d ?? []).map((d: any) => ({
    day: new Date(d.day).toLocaleDateString("en", { weekday: "short" }),
    count: d.count,
  }));

  const t = recent?.telemetry ?? {};
  const hasTelemetry = Object.keys(t).length > 0;

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile?.full_name?.split(" ")[0] ?? ""}`}
        subtitle={`${org?.name} · ${org?.org_code} · ${org?.plan} plan`}
      />

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Users" value={stats?.users ?? "—"} />
        <Kpi label="Cameras" value={stats?.cameras ?? "—"}
             hint={<span><span className="text-ok">{stats?.cameras_online ?? 0} online</span> · {Math.max((stats?.cameras ?? 0) - (stats?.cameras_online ?? 0), 0)} offline</span>} />
        <Kpi label="Devices" value={stats?.devices ?? "—"} hint={`${stats?.devices_online ?? 0} online now`} />
        <Kpi label="Active Licenses" value={stats?.licenses_active ?? "—"} />
        <Kpi label="AI Events (24h)" value={stats?.alerts_today ?? "—"}
             spark={events7d.length ? <Spark data={events7d} dataKey="count" /> : undefined} />
        <Kpi label="Open Incidents" value={stats?.incidents_open ?? "—"} />
        <Kpi label="Storage Used" value={stats ? fmtBytes(Number(stats.storage_mb)) : "—"} />
        <Kpi
          label="System Load"
          value={hasTelemetry ? `${Math.round(t.cpu_pct ?? 0)}%` : "no data"}
          hint={hasTelemetry
            ? `CPU ${Math.round(t.cpu_pct ?? 0)}% · GPU ${Math.round(t.gpu_pct ?? 0)}% · MEM ${Math.round(t.mem_pct ?? 0)}%`
            : "AI engine telemetry appears once a desktop is online"}
        />
      </div>

      {/* events chart */}
      <div className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-1">AI events — last 7 days</h2>
        {events7d.length ? (
          <TimeSeries data={events7d} xKey="day" series={[{ key: "count", name: "Events" }]} kind="bar" height={200} />
        ) : (
          <p className="py-10 text-center text-sm text-ink-3">No events recorded yet.</p>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* recent alerts */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-1">Recent alerts</h2>
            <Link to="/app/alerts" className="link-action">View all</Link>
          </div>
          {!recent?.alerts.length ? (
            <p className="py-6 text-center text-sm text-ink-3">No alerts yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {recent.alerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge tone={statusTone[a.severity]}>{a.kind.replaceAll("_", " ")}</Badge>
                    <span className="truncate text-sm text-ink-1">{a.title}</span>
                  </div>
                  <span className="shrink-0 text-xs text-ink-3">{fmtAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* camera status */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-1">Live camera status</h2>
            <Link to="/app/cameras" className="link-action">Manage</Link>
          </div>
          {!recent?.cameras.length ? (
            <p className="py-6 text-center text-sm text-ink-3">No cameras yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {recent.cameras.slice(0, 8).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2">
                  <span className="truncate text-sm text-ink-2">{c.name}</span>
                  <Badge tone={statusTone[c.status]}>{c.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* recent users */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-1">Recent users</h2>
            <Link to="/app/users" className="link-action">All users</Link>
          </div>
          <div className="divide-y divide-line">
            {recent?.users.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink-1">{u.full_name}</div>
                  <div className="truncate text-xs text-ink-3">{u.email}</div>
                </div>
                <span className="shrink-0 text-xs text-ink-3">{fmtAgo(u.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* recent activations */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-1">Recent desktop activations</h2>
            <Link to="/app/activations" className="link-action">All activations</Link>
          </div>
          {!recent?.activations.length ? (
            <p className="py-6 text-center text-sm text-ink-3">No desktop activations yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {recent.activations.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink-1">{d.name}</div>
                    <div className="truncate text-xs text-ink-3">{d.profiles?.full_name}</div>
                  </div>
                  <Badge tone={d.is_online ? "ok" : "default"}>{d.is_online ? "online" : fmtAgo(d.last_seen_at)}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
