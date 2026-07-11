import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { SupportTicket, ThreadEntry } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Modal, Drawer, Field } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";

type TicketRow = SupportTicket & { profiles: { full_name: string; email: string } | null };

export default function SupportPage() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: tickets } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () =>
      (await supabase
        .from("support_tickets")
        .select("*, profiles(full_name, email)")
        .order("updated_at", { ascending: false })).data as TicketRow[] | null,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["tickets"] });

  useEffect(() => {
    const ch = supabase
      .channel("tickets-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const viewing = tickets?.find((t) => t.id === viewingId) ?? null;

  const columns: Column<TicketRow>[] = [
    {
      key: "subject", header: "Ticket", sortable: true, value: (t) => t.subject,
      render: (t) => (
        <div className="min-w-0">
          <div className="truncate text-ink-1">{t.subject}</div>
          <div className="truncate text-xs text-ink-3">{t.profiles?.full_name ?? "—"}</div>
        </div>
      ),
    },
    {
      key: "priority", header: "Priority", filter: true, value: (t) => t.priority,
      render: (t) => <Badge tone={statusTone[t.priority]}>{t.priority}</Badge>,
    },
    {
      key: "status", header: "Status", filter: true, value: (t) => t.status,
      render: (t) => <Badge tone={statusTone[t.status]}>{t.status}</Badge>,
    },
    {
      key: "messages", header: "Messages", value: (t) => t.thread?.length ?? 0,
      render: (t) => <span className="text-ink-3">{t.thread?.length ?? 0}</span>,
    },
    {
      key: "updated", header: "Updated", sortable: true, value: (t) => t.updated_at,
      render: (t) => <span className="whitespace-nowrap text-xs text-ink-3">{fmtAgo(t.updated_at)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Support"
        subtitle={can("support.manage")
          ? "All tickets in your organization — respond, prioritize and close."
          : "Open a ticket and track responses from your organization's support team."}
        actions={
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={15} /> New Ticket
          </button>
        }
      />
      <DataTable
        rows={tickets ?? []}
        columns={columns}
        rowKey={(t) => t.id}
        searchText={(t) => `${t.subject} ${t.status} ${t.priority} ${t.profiles?.full_name ?? ""}`}
        exportName="tickets"
        onRowClick={(t) => setViewingId(t.id)}
        emptyText="No tickets. If something's wrong, open one — we track it here end to end."
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New support ticket">
        <CreateForm onDone={() => { setCreateOpen(false); refresh(); }} />
      </Modal>

      <Drawer open={!!viewing} onClose={() => setViewingId(null)} title={viewing?.subject ?? ""}>
        {viewing && <TicketDetail ticket={viewing} onChanged={refresh} />}
      </Drawer>
    </>
  );
}

function TicketDetail({ ticket, onChanged }: { ticket: TicketRow; onChanged: () => void }) {
  const { profile, can } = useAuth();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const manage = can("support.manage");
  const mine = ticket.user_id === profile?.id;

  async function send() {
    if (!reply.trim() || !profile) return;
    setBusy(true);
    const entry: ThreadEntry = { by: profile.id, by_name: profile.full_name, at: new Date().toISOString(), text: reply.trim() };
    await supabase.from("support_tickets")
      .update({
        thread: [...(ticket.thread ?? []), entry],
        // a support answer moves the ticket to pending-on-requester; a requester reply reopens it
        status: ticket.status === "closed" ? "open" : manage && !mine ? "pending" : "open",
      })
      .eq("id", ticket.id);
    setReply("");
    setBusy(false);
    onChanged();
  }

  async function setStatus(status: SupportTicket["status"]) {
    await supabase.from("support_tickets").update({ status }).eq("id", ticket.id);
    audit(`ticket.${status}`, "ticket", ticket.id, { module: "support" });
    onChanged();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[ticket.status]}>{ticket.status}</Badge>
        <Badge tone={statusTone[ticket.priority]}>{ticket.priority}</Badge>
        <span className="text-xs text-ink-3">
          {ticket.profiles?.full_name} · opened {fmtDateTime(ticket.created_at)}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {ticket.thread?.map((m, i) => {
          const own = m.by === profile?.id;
          return (
            <div key={i} className={`max-w-[85%] rounded-lg border p-3 ${own ? "ml-auto border-accent/40 bg-accent/10" : "border-line bg-surface-2"}`}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs text-ink-3">
                <span className="font-medium text-ink-2">{m.by_name}</span>
                <span>{fmtDateTime(m.at)}</span>
              </div>
              <p className="whitespace-pre-line text-sm text-ink-1">{m.text}</p>
            </div>
          );
        })}
      </div>

      {(mine || manage) && (
        <div className="mt-4 space-y-2 border-t border-line pt-3">
          <textarea className="input min-h-[70px] w-full" placeholder="Write a reply…"
                    value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary flex-1" onClick={send} disabled={busy || !reply.trim()}>
              {busy ? "Sending…" : "Send Reply"}
            </button>
            {manage && ticket.status !== "closed" && (
              <button className="btn-ghost" onClick={() => setStatus("closed")}>Close</button>
            )}
            {ticket.status === "closed" && (
              <button className="btn-ghost" onClick={() => setStatus("open")}>Reopen</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const { profile, org } = useAuth();
  const [form, setForm] = useState({ subject: "", priority: "normal", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!profile || !org) return;
    setBusy(true);
    setError("");
    const entry: ThreadEntry = { by: profile.id, by_name: profile.full_name, at: new Date().toISOString(), text: form.message.trim() };
    const { data, error } = await supabase.from("support_tickets").insert({
      org_id: org.id,
      user_id: profile.id,
      subject: form.subject.trim(),
      priority: form.priority,
      thread: [entry],
    }).select("id").single();
    setBusy(false);
    if (error) return setError(error.message);
    audit("ticket.create", "ticket", data.id, { module: "support", new: { subject: form.subject, priority: form.priority } });
    onDone();
  }

  return (
    <div className="space-y-3">
      <Field label="Subject">
        <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
      </Field>
      <Field label="Priority">
        <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
      <Field label="Describe the issue">
        <textarea className="input min-h-[100px]" value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <button className="btn-primary w-full" onClick={submit}
              disabled={busy || !form.subject.trim() || !form.message.trim()}>
        {busy ? "Opening…" : "Open Ticket"}
      </button>
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <LifeBuoy size={12} /> Your organization's support engineers see this immediately via Realtime.
      </p>
    </div>
  );
}
