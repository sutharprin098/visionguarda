import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { fmtAgo } from "../lib/format";

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { session } = useAuth();

  const { data: unread } = useQuery({
    queryKey: ["notif-unread"],
    queryFn: async () =>
      (await supabase
        .from("notifications")
        .select("id, title, body, kind, created_at")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(8)).data ?? [],
  });

  // realtime: new notifications appear instantly; ask for browser permission once
  useEffect(() => {
    if (!session) return;
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    const ch = supabase
      .channel("notif-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["notif-unread"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
        const n = payload.new as { title?: string; body?: string };
        if ("Notification" in window && Notification.permission === "granted" && n.title) {
          new Notification(`CamAI — ${n.title}`, { body: n.body ?? "" });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session?.user.id]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  async function markAllRead() {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["notif-unread"] });
  }

  return (
    <div className="relative" ref={ref}>
      <button className="relative rounded-md p-2 text-ink-3 transition hover:bg-surface-2 hover:text-ink-1"
              onClick={() => setOpen((o) => !o)}>
        <Bell size={16} />
        {!!unread?.length && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />
        )}
      </button>
      {/* max-w: w-80 is 320px measured leftward from the bell, which runs off
          the left edge on a narrow phone. Clamped to the viewport minus the
          shell's gutters so the panel always lands on screen. */}
      {open && (
        <div className="card absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden shadow-2xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Notifications</span>
            {!!unread?.length && (
              <button className="text-xs text-accent hover:underline" onClick={markAllRead}>Mark all read</button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {!unread?.length && <p className="px-3 py-6 text-center text-sm text-ink-3">All caught up.</p>}
            {unread?.map((n: any) => (
              <div key={n.id} className="border-b border-line px-3 py-2.5 last:border-0">
                <div className="text-sm text-ink-1">{n.title}</div>
                {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{n.body}</div>}
                <div className="mt-1 text-[10px] text-ink-3">{fmtAgo(n.created_at)}</div>
              </div>
            ))}
          </div>
          <Link to="/app/notifications" className="block border-t border-line px-3 py-2 text-center text-xs text-accent hover:bg-surface-2"
                onClick={() => setOpen(false)}>
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
