import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { UserPlus, Video, KeyRound, Download, AlertTriangle, RefreshCw } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Kpi, Badge, statusTone, Empty } from "../../components/ui";
import { TimeSeries, Spark } from "../../components/charts";
import { fmtAgo, fmtBytes } from "../../lib/format";

export default function Dashboard() {
  const { org, profile, can } = useAuth();
  const qc = useQueryClient();

  const { data: stats, isLoading: statsLoading, isError: statsError, error: statsErr, refetch: refetchStats } = useQuery({
    queryKey: ["org-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("org_stats");
      if (error) throw error;
      return data as Record<string, any> | null;
    },
  });

  const { data: recent, isLoading: recentLoading, isError: recentError, error: recentErr, refetch: refetchRecent } = useQuery({
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

      {(statsError || recentError) && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>Couldn't load part of the dashboard: {(statsErr as any)?.message ?? (recentErr as any)?.message ?? "unknown error"}.</span>
          </div>
          <button
            className="btn-ghost shrink-0 gap-1.5 px-2 py-1 text-xs text-danger"
            onClick={() => { if (statsError) refetchStats(); if (recentError) refetchRecent(); }}
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* quick actions */}
      <div className="mb-6 flex flex-wrap gap-2">
        {can("users.manage") && (
          <Link to="/app/users" className="btn-ghost text-xs"><UserPlus size={14} /> Add User</Link>
        )}
        {can("cameras.manage") && (
          <Link to="/app/cameras" className="btn-ghost text-xs"><Video size={14} /> Add Camera</Link>
        )}
        {can("licenses.manage") && (
          <Link to="/app/licenses" className="btn-ghost text-xs"><KeyRound size={14} /> Generate License</Link>
        )}
        <Link to="/app/downloads" className="btn-ghost text-xs"><Download size={14} /> Download Desktop App</Link>
      </div>

      {/* KPI row */}
      {statsLoading && !stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="card h-[74px] animate-pulse p-4">
              <div className="h-3 w-16 rounded bg-surface-3" />
              <div className="mt-3 h-6 w-10 rounded bg-surface-3" />
            </div>
          ))}
        </div>
      ) : (
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
      )}

      {/* events chart */}
      <div className="card mt-6 p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-1">AI events — last 7 days</h2>
        {statsLoading && !stats ? (
          <p className="py-10 text-center text-sm text-ink-3">Loading…</p>
        ) : events7d.length ? (
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
          {recentLoading && !recent ? (
            <p className="py-6 text-center text-sm text-ink-3">Loading…</p>
          ) : !recent?.alerts.length ? (
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
          {recentLoading && !recent ? (
            <p className="py-6 text-center text-sm text-ink-3">Loading…</p>
          ) : !recent?.cameras.length ? (
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
          {recentLoading && !recent ? (
            <p className="py-6 text-center text-sm text-ink-3">Loading…</p>
          ) : !recent?.users.length ? (
            <p className="py-6 text-center text-sm text-ink-3">No users yet.</p>
          ) : (
            <div className="divide-y divide-line">
              {recent.users.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink-1">{u.full_name}</div>
                    <div className="truncate text-xs text-ink-3">{u.email}</div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-3">{fmtAgo(u.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* recent activations */}
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink-1">Recent desktop activations</h2>
            <Link to="/app/activations" className="link-action">All activations</Link>
          </div>
          {recentLoading && !recent ? (
            <p className="py-6 text-center text-sm text-ink-3">Loading…</p>
          ) : !recent?.activations.length ? (
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
