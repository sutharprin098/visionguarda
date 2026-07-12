import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LifeBuoy, Plus, ChevronDown, BookOpen, FileText, Bug, Lightbulb,
  CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import clsx from "clsx";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { SupportTicket, ThreadEntry } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, statusTone, Modal, Drawer, Field, Tabs, Kpi } from "../../components/ui";
import DataTable, { Column } from "../../components/DataTable";
import { fmtAgo, fmtDateTime } from "../../lib/format";

type TicketRow = SupportTicket & {
  profiles: { full_name: string; email: string } | null;
  assignee: { id: string; full_name: string } | null;
};

const CATEGORY_LABEL: Record<string, string> = { general: "General", bug: "Bug Report", feature_request: "Feature Request" };
const PAGE_TABS = ["Help Center", "Tickets", "System Status"];

export default function SupportPage() {
  const [tab, setTab] = useState("Tickets");
  return (
    <>
      <PageHeader
        title="Support"
        subtitle="Help articles, tickets, bug reports, feature requests and live system status."
      />
      <Tabs tabs={PAGE_TABS} active={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === "Help Center" && <HelpCenter />}
        {tab === "Tickets" && <Tickets />}
        {tab === "System Status" && <SystemStatus />}
      </div>
    </>
  );
}

// --------------------------------------------------------------- Help Center
const FAQ = [
  { q: "How do I activate the Windows desktop app?", a: "Generate a license key for the user on the Licenses page, then have them enter it on the desktop app's first-launch activation screen. It verifies against your organization and syncs cameras, permissions and settings automatically — the key is only ever entered once." },
  { q: "Why isn't my camera connecting?", a: "Use \"Test Connection\" on the Add Camera form before saving — it verifies the IP/port is reachable. Common causes: wrong port (RTSP/NVR/DVR default 554, ONVIF/IP default 80), camera not port-forwarded if it's behind a router, or wrong username/password." },
  { q: "What camera types are supported?", a: "RTSP, ONVIF, USB, generic IP cameras, NVR and DVR. Add each from the Cameras page with its IP, port, and credentials." },
  { q: "How do I get the camera to show up on a user's desktop app?", a: "Assign it to them from the Cameras page (\"Assign\"). It appears on their desktop instantly via Supabase Realtime — no restart needed." },
  { q: "A license shows expired/revoked — what now?", a: "Go to Licenses and use Reset (issues a fresh key) or generate a new one and assign it. The affected user gets a notification automatically." },
  { q: "Where do I download the latest desktop build?", a: "The Downloads page always shows the newest published GitHub Release — version, notes, size and a direct download link, refreshed automatically." },
];

const ARTICLES = [
  { title: "Setting up your organization", body: "Create roles under Roles & Permissions, invite your team from Users, and assign each person a role before handing out licenses. Owners and Admins can manage members, suspend/reactivate accounts, and reset passwords or licenses at any time." },
  { title: "Camera onboarding checklist", body: "1) Confirm the camera's IP is reachable from wherever this portal runs. 2) Add it with Name, Source Type, IP, Port, Username, Password. 3) Test Connection before saving. 4) Assign it to the users who need it — it syncs to their desktop app in real time." },
  { title: "License lifecycle", body: "Every user gets a license (Trial, Personal, Enterprise, Lifetime or Subscription). Admins can generate, assign, transfer, suspend, revoke and reset licenses. Each license binds to a device fingerprint on activation, capped by its max-devices setting." },
  { title: "Security model", body: "Every organization's data is isolated with Postgres row-level security — nothing crosses org boundaries, even for shared tables. Camera credentials are AES-256-GCM encrypted at rest, license keys are stored only as SHA-256 hashes, and desktop tokens are encrypted locally via Windows DPAPI." },
];

function HelpCenter() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-1">
          <BookOpen size={15} /> Help Articles
        </h2>
        <div className="space-y-3">
          {ARTICLES.map((a) => (
            <div key={a.title} className="card p-4">
              <h3 className="text-sm font-medium text-ink-1">{a.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{a.body}</p>
            </div>
          ))}
        </div>
        <a href="https://github.com/sutharprin098/visionguarda" target="_blank" rel="noreferrer"
           className="mt-3 flex items-center gap-1.5 text-xs text-accent hover:underline">
          <FileText size={13} /> Full documentation (README / PLATFORM.md in the repo)
        </a>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-ink-1">Frequently Asked Questions</h2>
        <div className="space-y-2">
          {FAQ.map((f, i) => (
            <div key={f.q} className="card overflow-hidden p-0">
              <button className="flex w-full items-center justify-between p-4 text-left"
                      onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span className="text-sm text-ink-1">{f.q}</span>
                <ChevronDown size={15} className={clsx("shrink-0 text-ink-3 transition-transform", openFaq === i && "rotate-180")} />
              </button>
              {openFaq === i && <p className="border-t border-line px-4 py-3 text-sm text-ink-3">{f.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Tickets
function Tickets() {
  const qc = useQueryClient();
  const { can } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [createCategory, setCreateCategory] = useState<SupportTicket["category"]>("general");
  const [viewingId, setViewingId] = useState<string | null>(null);

  const { data: tickets } = useQuery({
    queryKey: ["tickets"],
    queryFn: async () =>
      (await supabase
        .from("support_tickets")
        .select("*, profiles!support_tickets_user_id_fkey(full_name, email), assignee:profiles!support_tickets_assigned_to_fkey(id, full_name)")
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
      key: "category", header: "Category", filter: true, value: (t) => t.category,
      render: (t) => (
        <Badge tone={t.category === "bug" ? "danger" : t.category === "feature_request" ? "accent" : "default"}>
          {CATEGORY_LABEL[t.category]}
        </Badge>
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
      key: "assignee", header: "Assigned To", filter: true, value: (t) => t.assignee?.full_name ?? "Unassigned",
      render: (t) => <span className="text-ink-2">{t.assignee?.full_name ?? "Unassigned"}</span>,
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-3">
          {can("support.manage")
            ? "All tickets in your organization — respond, prioritize and close."
            : "Track responses from your organization's support team."}
        </p>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => { setCreateCategory("bug"); setCreateOpen(true); }}>
            <Bug size={14} /> Report a Bug
          </button>
          <button className="btn-ghost" onClick={() => { setCreateCategory("feature_request"); setCreateOpen(true); }}>
            <Lightbulb size={14} /> Request a Feature
          </button>
          <button className="btn-primary" onClick={() => { setCreateCategory("general"); setCreateOpen(true); }}>
            <Plus size={15} /> Contact Support
          </button>
        </div>
      </div>
      <DataTable
        rows={tickets ?? []}
        columns={columns}
        rowKey={(t) => t.id}
        searchText={(t) => `${t.subject} ${t.status} ${t.priority} ${t.category} ${t.profiles?.full_name ?? ""} ${t.assignee?.full_name ?? ""}`}
        exportName="tickets"
        onRowClick={(t) => setViewingId(t.id)}
        emptyText="No tickets. If something's wrong, open one — we track it here end to end."
      />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={
        createCategory === "bug" ? "Report a bug" : createCategory === "feature_request" ? "Request a feature" : "Contact support"
      }>
        <CreateForm category={createCategory} onDone={() => { setCreateOpen(false); refresh(); }} />
      </Modal>

      <Drawer open={!!viewing} onClose={() => setViewingId(null)} title={viewing?.subject ?? ""}>
        {viewing && <TicketDetail ticket={viewing} onChanged={refresh} />}
      </Drawer>
    </>
  );
}

// --------------------------------------------------------------- System Status
function SystemStatus() {
  const { data: stats } = useQuery({
    queryKey: ["org-stats"],
    queryFn: async () => (await supabase.rpc("org_stats")).data as Record<string, any> | null,
  });

  const cameras = stats?.cameras ?? 0;
  const camerasOnline = stats?.cameras_online ?? 0;
  const devices = stats?.devices ?? 0;
  const devicesOnline = stats?.devices_online ?? 0;
  const incidentsOpen = stats?.incidents_open ?? 0;

  const cameraHealth = cameras === 0 ? "unknown" : camerasOnline === cameras ? "operational" : camerasOnline > 0 ? "degraded" : "down";
  const deviceHealth = devices === 0 ? "unknown" : devicesOnline > 0 ? "operational" : "degraded";
  const incidentHealth = incidentsOpen === 0 ? "operational" : incidentsOpen < 3 ? "degraded" : "down";
  const overall = [cameraHealth, deviceHealth, incidentHealth].includes("down")
    ? "down"
    : [cameraHealth, deviceHealth, incidentHealth].includes("degraded")
    ? "degraded"
    : "operational";

  const rows: { label: string; status: string; detail: string }[] = [
    { label: "Cameras", status: cameraHealth, detail: `${camerasOnline} / ${cameras} online` },
    { label: "Desktop devices", status: deviceHealth, detail: `${devicesOnline} online now` },
    { label: "Incidents", status: incidentHealth, detail: `${incidentsOpen} open` },
    { label: "Portal & database", status: "operational", detail: "Live — you're looking at it" },
  ];

  const icon = (s: string) => s === "operational"
    ? <CheckCircle2 size={16} className="text-ok" />
    : s === "degraded"
    ? <AlertTriangle size={16} className="text-warn" />
    : <XCircle size={16} className="text-danger" />;

  return (
    <div className="space-y-4">
      <div className={clsx(
        "card flex items-center gap-3 p-5",
        overall === "operational" && "border-ok/30", overall === "degraded" && "border-warn/30", overall === "down" && "border-danger/30",
      )}>
        {icon(overall)}
        <div>
          <div className="text-sm font-semibold text-ink-1">
            {overall === "operational" ? "All systems operational" : overall === "degraded" ? "Partial degradation" : "Active outage"}
          </div>
          <div className="text-xs text-ink-3">Computed live from your organization's cameras, devices and incidents.</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Cameras online" value={`${camerasOnline}/${cameras}`} />
        <Kpi label="Devices online" value={devicesOnline} />
        <Kpi label="Open incidents" value={incidentsOpen} />
      </div>

      <div className="card divide-y divide-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between p-4">
            <div className="flex items-center gap-2.5">
              {icon(r.status)}
              <span className="text-sm text-ink-1">{r.label}</span>
            </div>
            <span className="text-xs text-ink-3">{r.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketDetail({ ticket, onChanged }: { ticket: TicketRow; onChanged: () => void }) {
  const { profile, can } = useAuth();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");
  const manage = can("support.manage");
  const mine = ticket.user_id === profile?.id;

  const { data: users } = useQuery({
    queryKey: ["users-brief"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email").order("full_name")).data ?? [],
    enabled: manage,
  });

  async function assign(userId: string) {
    await supabase.from("support_tickets").update({ assigned_to: userId || null }).eq("id", ticket.id);
    audit("ticket.assign", "ticket", ticket.id, { module: "support", old: { assigned_to: ticket.assigned_to }, new: { assigned_to: userId || null } });
    onChanged();
  }

  async function send() {
    if (!reply.trim() || !profile) return;
    setBusy(true);
    setSendError("");
    const entry: ThreadEntry = { by: profile.id, by_name: profile.full_name, at: new Date().toISOString(), text: reply.trim() };
    const { error } = await supabase.from("support_tickets")
      .update({
        thread: [...(ticket.thread ?? []), entry],
        // a support answer moves the ticket to pending-on-requester; a requester reply reopens it
        status: ticket.status === "closed" ? "open" : manage && !mine ? "pending" : "open",
      })
      .eq("id", ticket.id);
    setBusy(false);
    if (error) return setSendError(error.message);
    setReply("");
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

      {manage && (
        <div className="mb-3">
          <Field label="Assigned to">
            <select className="input" value={ticket.assigned_to ?? ""} onChange={(e) => assign(e.target.value)}>
              <option value="">Unassigned</option>
              {users?.map((u: any) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {!manage && ticket.assignee && (
        <p className="mb-3 text-xs text-ink-3">Assigned to {ticket.assignee.full_name}</p>
      )}

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
          {sendError && <p className="text-sm text-danger">{sendError}</p>}
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

function CreateForm({ category, onDone }: { category: SupportTicket["category"]; onDone: () => void }) {
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
      category,
      thread: [entry],
    }).select("id").maybeSingle();
    setBusy(false);
    if (error || !data) return setError(error?.message ?? "create failed");
    audit("ticket.create", "ticket", data.id, { module: "support", new: { subject: form.subject, priority: form.priority, category } });
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
      <Field label={category === "feature_request" ? "Describe the request" : category === "bug" ? "Describe the bug (steps to reproduce help)" : "Describe the issue"}>
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
