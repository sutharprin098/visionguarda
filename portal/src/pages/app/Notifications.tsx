import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Megaphone, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import clsx from "clsx";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Empty, Tabs } from "../../components/ui";
import { fmtAgo } from "../../lib/format";

interface Notification {
  id: string;
  user_id: string | null;    // null = org-wide announcement
  channel: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  archived_at: string | null;
  created_at: string;
}

const TABS = ["All", "Unread", "Archived"];

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [tab, setTab] = useState("All");
  const [kindFilter, setKindFilter] = useState("");

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
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const kinds = useMemo(
    () => [...new Set((notifications ?? []).map((n) => n.kind))].sort(),
    [notifications],
  );

  const mineAll = notifications?.filter((n) => n.user_id === profile?.id) ?? [];
  const orgWide = (notifications ?? []).filter((n) => n.user_id === null && !n.archived_at);
  const unread = mineAll.filter((n) => !n.read_at && !n.archived_at);

  const mine = mineAll
    .filter((n) => (tab === "Archived" ? !!n.archived_at : !n.archived_at))
    .filter((n) => tab !== "Unread" || !n.read_at)
    .filter((n) => !kindFilter || n.kind === kindFilter);

  async function markRead(ids: string[]) {
    if (!ids.length) return;
    await supabase.from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    refresh();
  }

  async function archive(id: string, archived: boolean) {
    await supabase.from("notifications")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id);
    refresh();
  }

  async function remove(id: string) {
    await supabase.from("notifications").delete().eq("id", id);
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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        {kinds.length > 1 && (
          <select className="input w-auto text-xs" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">All types</option>
            {kinds.map((k) => <option key={k} value={k}>{k.replaceAll("_", " ")}</option>)}
          </select>
        )}
      </div>
      {!mine.length ? (
        <Empty text={tab === "Archived" ? "No archived notifications." : "Nothing yet. Alerts, license and device events addressed to you will appear here."} />
      ) : (
        <div className="space-y-2">
          {mine.map((n) => (
            <div key={n.id}
                 className={clsx("card flex items-start gap-3 p-4 transition", !n.read_at && !n.archived_at && "border-accent/40 bg-accent/5")}>
              <Bell size={16} className={clsx("mt-0.5 shrink-0", n.read_at ? "text-ink-3" : "text-accent")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={clsx("truncate", n.read_at ? "text-ink-2" : "font-medium text-ink-1")}>{n.title}</span>
                    <Badge tone={statusTone[n.kind] ?? "default"}>{n.kind.replaceAll("_", " ")}</Badge>
                    <Badge>{n.channel}</Badge>
                  </div>
                  <span className="shrink-0 text-xs text-ink-3">{fmtAgo(n.created_at)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-sm text-ink-3">{n.body}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!n.read_at && !n.archived_at && (
                  <button className="text-xs text-accent hover:underline" onClick={() => markRead([n.id])}>
                    Mark read
                  </button>
                )}
                <button className="text-ink-3 hover:text-ink-1" title={n.archived_at ? "Unarchive" : "Archive"}
                        onClick={() => archive(n.id, !n.archived_at)}>
                  {n.archived_at ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                </button>
                <button className="text-ink-3 hover:text-danger" title="Delete" onClick={() => remove(n.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
