import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Megaphone } from "lucide-react";
import clsx from "clsx";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Empty } from "../../components/ui";
import { fmtAgo } from "../../lib/format";

interface Notification {
  id: string;
  user_id: string | null;    // null = org-wide announcement
  channel: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () =>
      (await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200)).data as Notification[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  useEffect(() => {
    const ch = supabase
      .channel("notifications-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const mine = notifications?.filter((n) => n.user_id === profile?.id) ?? [];
  const orgWide = notifications?.filter((n) => n.user_id === null) ?? [];
  const unread = mine.filter((n) => !n.read_at);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    await supabase.from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    refresh();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Alerts, license expiry, device and camera events routed to you — live via Realtime."
        actions={
          unread.length > 0 && (
            <button className="btn-ghost" onClick={() => markRead(unread.map((n) => n.id))}>
              <CheckCheck size={14} /> Mark all read ({unread.length})
            </button>
          )
        }
      />

      {orgWide.length > 0 && (
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Organization announcements</h2>
          <div className="mb-6 space-y-2">
            {orgWide.slice(0, 5).map((n) => (
              <div key={n.id} className="card flex items-start gap-3 border-accent/30 p-4">
                <Megaphone size={16} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-1">{n.title}</span>
                    <span className="shrink-0 text-xs text-ink-3">{fmtAgo(n.created_at)}</span>
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-ink-2">{n.body}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">Your notifications</h2>
      {!mine.length ? (
        <Empty text="Nothing yet. Alerts, license and device events addressed to you will appear here." />
      ) : (
        <div className="space-y-2">
          {mine.map((n) => (
            <div key={n.id}
                 className={clsx("card flex items-start gap-3 p-4 transition", !n.read_at && "border-accent/40 bg-accent/5")}>
              <Bell size={16} className={clsx("mt-0.5 shrink-0", n.read_at ? "text-ink-3" : "text-accent")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={clsx("truncate", n.read_at ? "text-ink-2" : "font-medium text-ink-1")}>{n.title}</span>
                    <Badge tone={statusTone[n.kind] ?? "default"}>{n.kind}</Badge>
                    <Badge>{n.channel}</Badge>
                  </div>
                  <span className="shrink-0 text-xs text-ink-3">{fmtAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-sm text-ink-3">{n.body}</p>}
              </div>
              {!n.read_at && (
                <button className="shrink-0 text-xs text-accent hover:underline" onClick={() => markRead([n.id])}>
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
