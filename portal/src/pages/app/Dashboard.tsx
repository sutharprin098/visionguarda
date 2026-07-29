import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  UserPlus, Video, KeyRound, Download, AlertTriangle, RefreshCw,
  Users, Cpu, ShieldCheck, Activity, HardDrive, Bell, Zap,
  TrendingUp, Sparkles, ArrowUpRight, CheckCircle2, ShieldAlert,
  Server
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Kpi, Badge, statusTone, statusLabel } from "../../components/ui";
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

  // Realtime subscription setup
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
    <div className="space-y-6 sm:space-y-8 animate-fade-in">
      <PageHeader
        title={`Welcome, ${profile?.full_name?.split(" ")[0] ?? "Commander"}`}
        subtitle={`${org?.name ?? "Enterprise Account"} · ${org?.org_code ?? "ORG-MAIN"}`}
        actions={
          can("cameras.manage") ? (
            <Link to="/app/cameras" className="btn-primary btn-sm">
              <Video size={14} /> Studio Feeds
            </Link>
          ) : undefined
        }
      />

      {/* Hero Command Banner */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-sky-500/20 bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950 p-5 sm:p-8 text-white shadow-xl">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-sky-500/10 blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute right-1/3 bottom-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/15 px-3 py-1 text-[11px] font-semibold text-sky-300 backdrop-blur-md">
              <Sparkles size={13} className="text-sky-400" />
              <span>Realtime AI Engine Active</span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight sm:text-3xl text-white leading-snug">
              Video Telemetry & Edge Intelligence
            </h2>
            <p className="text-xs sm:text-sm font-medium text-slate-300 leading-relaxed">
              Monitoring {stats?.cameras ?? 0} video feeds across your enterprise infrastructure. System status is healthy.
            </p>
          </div>

          {/* Clean Quick Action Launcher */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {can("users.manage") && (
              <Link to="/app/users" className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20 backdrop-blur-md">
                <UserPlus size={14} className="text-sky-400" /> Add User
              </Link>
            )}
            {can("cameras.manage") && (
              <Link to="/app/cameras" className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20 backdrop-blur-md">
                <Video size={14} className="text-sky-400" /> Add Camera
              </Link>
            )}
            <Link to="/app/downloads" className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-white/20 backdrop-blur-md">
              <Download size={14} className="text-sky-400" /> Desktop Node
            </Link>
          </div>
        </div>
      </div>

      {(statsError || recentError) && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs sm:text-sm text-rose-600 dark:text-rose-400">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-rose-500" />
            <span className="font-medium">Couldn't sync telemetry: {(statsErr as any)?.message ?? (recentErr as any)?.message ?? "unknown error"}.</span>
          </div>
          <button
            className="btn-ghost btn-sm shrink-0 text-danger border-danger/30"
            onClick={() => { if (statsError) refetchStats(); if (recentError) refetchRecent(); }}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* KPI Grid Section - 2 columns on mobile, 4 on desktop */}
      {statsLoading && !stats ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            /* One shimmer, shared with every other loading placeholder, rather
               than a pulsing opacity on a flat block — the two read as
               different kinds of "waiting" when they appear on the same
               screen. See .skeleton in index.css. */
            <div key={i} className="card h-24 p-4">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-3 h-6 w-12" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Kpi
            label="Personnel"
            value={stats?.users ?? "—"}
            icon={<Users size={16} />}
            hint="Team members"
          />
          <Kpi
            label="Cameras"
            value={stats?.cameras ?? "—"}
            icon={<Video size={16} />}
            hint={<span><span className="text-emerald-500 font-bold">{stats?.cameras_online ?? 0} online</span> · {Math.max((stats?.cameras ?? 0) - (stats?.cameras_online ?? 0), 0)} off</span>}
          />
          <Kpi
            label="Desktop Nodes"
            value={stats?.devices ?? "—"}
            icon={<Server size={16} />}
            hint={`${stats?.devices_online ?? 0} DPAPI active`}
          />
          <Kpi
            label="Licenses"
            value={stats?.licenses_active ?? "—"}
            icon={<KeyRound size={16} />}
            hint="Active keys"
          />
          <Kpi
            label="AI Events (24h)"
            value={stats?.alerts_today ?? "—"}
            icon={<Activity size={16} />}
            spark={events7d.length ? <Spark data={events7d} dataKey="count" /> : undefined}
          />
          <Kpi
            label="Open Incidents"
            value={stats?.incidents_open ?? "—"}
            icon={<ShieldAlert size={16} />}
            hint="Pending review"
          />
          <Kpi
            label="System Load"
            value={hasTelemetry ? `${Math.round(t.cpu_pct ?? 0)}%` : "Ready"}
            icon={<Cpu size={16} />}
            hint={hasTelemetry ? `CPU ${Math.round(t.cpu_pct ?? 0)}% · MEM ${Math.round(t.mem_pct ?? 0)}%` : "Engine ready"}
          />
        </div>
      )}

      {/* Main Analytics Telemetry Panel */}
      <div className="card p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-ink-1 flex items-center gap-2">
              <TrendingUp size={16} className="text-sky-500" />
              AI Event Telemetry (7 Days)
            </h2>
          </div>
          <span className="badge badge-accent text-[10px]">Live Telemetry</span>
        </div>

        {statsLoading && !stats ? (
          <div className="flex h-44 items-center justify-center text-xs text-ink-3">Loading telemetry…</div>
        ) : events7d.length ? (
          <TimeSeries data={events7d} xKey="day" series={[{ key: "count", name: "Detections" }]} kind="bar" height={190} />
        ) : (
          <div className="flex h-44 items-center justify-center text-xs text-ink-3">No event telemetry recorded.</div>
        )}
      </div>

      {/* Dual Row Feeds & Grid */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Recent Alerts Feed */}
        <div className="card p-4 sm:p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-line/60 pb-3">
            <h2 className="text-sm sm:text-base font-bold text-ink-1 flex items-center gap-2">
              <Bell size={16} className="text-amber-500" />
              Recent Alerts
            </h2>
            <Link to="/app/alerts" className="link-action text-xs flex items-center gap-1">
              All <ArrowUpRight size={13} />
            </Link>
          </div>

          {recentLoading && !recent ? (
            <p className="py-6 text-center text-xs text-ink-3">Loading alerts…</p>
          ) : !recent?.alerts.length ? (
            <p className="py-6 text-center text-xs text-ink-3">No security alerts detected.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {recent.alerts.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 transition hover:bg-surface-2/40 px-1 rounded-lg">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge tone={statusTone[a.severity]}>{a.kind.replaceAll("_", " ")}</Badge>
                    <span className="truncate text-xs font-medium text-ink-1">{a.title}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">{fmtAgo(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Camera Grid Status */}
        <div className="card p-4 sm:p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-line/60 pb-3">
            <h2 className="text-sm sm:text-base font-bold text-ink-1 flex items-center gap-2">
              <Video size={16} className="text-sky-500" />
              Camera Status
            </h2>
            <Link to="/app/cameras" className="link-action text-xs flex items-center gap-1">
              Studio <ArrowUpRight size={13} />
            </Link>
          </div>

          {recentLoading && !recent ? (
            <p className="py-6 text-center text-xs text-ink-3">Loading cameras…</p>
          ) : !recent?.cameras.length ? (
            <p className="py-6 text-center text-xs text-ink-3">No cameras configured yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {recent.cameras.slice(0, 8).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-line/80 bg-surface-2/40 px-3 py-2 transition hover:border-accent/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full ${c.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                    <span className="truncate text-xs font-semibold text-ink-1">{c.name}</span>
                  </div>
                  <Badge tone={statusTone[c.status]}>{statusLabel[c.status] ?? c.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Provisioned Members */}
        <div className="card p-4 sm:p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-line/60 pb-3">
            <h2 className="text-sm sm:text-base font-bold text-ink-1 flex items-center gap-2">
              <Users size={16} className="text-indigo-500" />
              Members
            </h2>
            <Link to="/app/users" className="link-action text-xs flex items-center gap-1">
              Manage <ArrowUpRight size={13} />
            </Link>
          </div>

          {recentLoading && !recent ? (
            <p className="py-6 text-center text-xs text-ink-3">Loading users…</p>
          ) : !recent?.users.length ? (
            <p className="py-6 text-center text-xs text-ink-3">No team members provisioned.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {recent.users.map((u: any) => (
                <div key={u.id} className="flex items-center justify-between py-2.5 transition hover:bg-surface-2/40 px-1 rounded-lg">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-ink-1">{u.full_name}</div>
                    <div className="truncate text-[11px] text-ink-3">{u.email}</div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-ink-3">{fmtAgo(u.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Activations */}
        <div className="card p-4 sm:p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between border-b border-line/60 pb-3">
            <h2 className="text-sm sm:text-base font-bold text-ink-1 flex items-center gap-2">
              <Server size={16} className="text-emerald-500" />
              Desktop Nodes
            </h2>
            <Link to="/app/activations" className="link-action text-xs flex items-center gap-1">
              Nodes <ArrowUpRight size={13} />
            </Link>
          </div>

          {recentLoading && !recent ? (
            <p className="py-6 text-center text-xs text-ink-3">Loading nodes…</p>
          ) : !recent?.activations.length ? (
            <p className="py-6 text-center text-xs text-ink-3">No desktop nodes activated.</p>
          ) : (
            <div className="divide-y divide-line/60">
              {recent.activations.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between py-2.5 transition hover:bg-surface-2/40 px-1 rounded-lg">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-ink-1">{d.name}</div>
                    <div className="truncate text-[11px] text-ink-3">Owner: {d.profiles?.full_name ?? "System"}</div>
                  </div>
                  <Badge tone={d.is_online ? "ok" : "default"}>{d.is_online ? "ONLINE" : fmtAgo(d.last_seen_at)}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


