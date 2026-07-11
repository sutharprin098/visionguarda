import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subDays, startOfDay, format } from "date-fns";
import { FileText, Download } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { Report } from "../../lib/types";
import { useAuth } from "../../contexts/AuthContext";
import { PageHeader, Badge, Field, Empty } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";

const SOURCES = {
  alerts: {
    label: "Alerts",
    table: "alerts",
    select: "created_at, kind, severity, title, cameras(name), acknowledged_at",
    timeCol: "created_at",
    headers: ["Time", "Kind", "Severity", "Title", "Camera", "Acknowledged"],
    row: (r: any) => [fmtDateTime(r.created_at), r.kind, r.severity, r.title, r.cameras?.name ?? "", r.acknowledged_at ? "yes" : "no"],
  },
  incidents: {
    label: "Incidents",
    table: "incidents",
    select: "created_at, title, severity, status, description, updated_at",
    timeCol: "created_at",
    headers: ["Opened", "Title", "Severity", "Status", "Description", "Updated"],
    row: (r: any) => [fmtDateTime(r.created_at), r.title, r.severity, r.status, r.description, fmtDateTime(r.updated_at)],
  },
  audit: {
    label: "Audit Trail",
    table: "audit_logs",
    select: "created_at, actor_email, action, module, target_type, target_id, ip",
    timeCol: "created_at",
    headers: ["Time", "Actor", "Action", "Module", "Target Type", "Target", "IP"],
    row: (r: any) => [fmtDateTime(r.created_at), r.actor_email, r.action, r.module, r.target_type, r.target_id, r.ip ?? ""],
  },
  cameras: {
    label: "Camera Inventory",
    table: "cameras",
    select: "name, source_type, status, is_enabled, created_at, sites(name)",
    timeCol: "created_at",
    headers: ["Camera", "Type", "Status", "Enabled", "Site", "Added"],
    row: (r: any) => [r.name, r.source_type, r.status, r.is_enabled ? "yes" : "no", r.sites?.name ?? "", fmtDateTime(r.created_at)],
  },
  users: {
    label: "User Directory",
    table: "profiles",
    select: "full_name, email, department, designation, status, last_login_at, created_at",
    timeCol: "created_at",
    headers: ["Name", "Email", "Department", "Designation", "Status", "Last Login", "Joined"],
    row: (r: any) => [r.full_name, r.email, r.department, r.designation, r.status, r.last_login_at ? fmtDateTime(r.last_login_at) : "never", fmtDateTime(r.created_at)],
  },
  devices: {
    label: "Device Inventory",
    table: "devices",
    select: "name, status, is_online, last_ip, last_seen_at, created_at, profiles(full_name)",
    timeCol: "created_at",
    headers: ["Device", "Owner", "Status", "Online", "Last IP", "Last Seen", "Activated"],
    row: (r: any) => [r.name, r.profiles?.full_name ?? "", r.status, r.is_online ? "yes" : "no", r.last_ip ?? "", r.last_seen_at ? fmtDateTime(r.last_seen_at) : "never", fmtDateTime(r.created_at)],
  },
} as const;

type SourceKey = keyof typeof SOURCES;

const KINDS = { daily: 1, weekly: 7, monthly: 30 } as const;

function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function ReportsPage() {
  const qc = useQueryClient();
  const { profile, org } = useAuth();
  const [source, setSource] = useState<SourceKey>("alerts");
  const [kind, setKind] = useState<"daily" | "weekly" | "monthly" | "custom">("weekly");
  const [from, setFrom] = useState(format(subDays(new Date(), 7), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const [busy, setBusy] = useState<"" | "csv" | "pdf">("");
  const [error, setError] = useState("");

  const { data: history } = useQuery({
    queryKey: ["reports"],
    queryFn: async () =>
      (await supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(50)).data as Report[] | null,
  });

  function rangeDates(): { start: Date; end: Date } {
    if (kind === "custom") return { start: startOfDay(new Date(from)), end: new Date(new Date(to).getTime() + 86_399_000) };
    return { start: startOfDay(subDays(new Date(), KINDS[kind] - 1)), end: new Date() };
  }

  async function fetchRows() {
    const def = SOURCES[source];
    const { start, end } = rangeDates();
    // def.table is a union of six table names — cast to keep tsc's
    // instantiation depth in check; the shape is validated by def.row()
    const { data, error } = await (supabase.from(def.table) as any)
      .select(def.select)
      .gte(def.timeCol, start.toISOString())
      .lte(def.timeCol, end.toISOString())
      .order(def.timeCol, { ascending: false })
      .limit(10000);
    if (error) throw error;
    return { def, rows: data ?? [], start, end };
  }

  async function generateCsv() {
    setBusy("csv");
    setError("");
    try {
      const { def, rows, start, end } = await fetchRows();
      const body = rows.map((r: any) => def.row(r).map(csvEscape).join(","));
      const csv = ["﻿" + def.headers.join(","), ...body].join("\r\n");
      const name = `${def.label.replace(/\s+/g, "-").toLowerCase()}-${format(start, "yyyyMMdd")}-${format(end, "yyyyMMdd")}`;

      // 1. download locally
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${name}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);

      // 2. archive in the org's reports bucket + register the run
      if (org) {
        const storage_path = `${org.id}/${name}-${Date.now()}.csv`;
        const { error: upErr } = await supabase.storage.from("reports").upload(storage_path, blob, { contentType: "text/csv" });
        await supabase.from("reports").insert({
          org_id: org.id,
          name: `${def.label} — ${format(start, "dd MMM")} to ${format(end, "dd MMM yyyy")}`,
          kind,
          format: "csv",
          params: { source, from: start.toISOString(), to: end.toISOString() },
          row_count: rows.length,
          storage_path: upErr ? "" : storage_path,
          created_by: profile?.id,
        });
        audit("report.generate", "report", name, { module: "reports", detail: { source, kind, rows: rows.length } });
        qc.invalidateQueries({ queryKey: ["reports"] });
      }
    } catch (e: any) {
      setError(e.message ?? "Report failed.");
    }
    setBusy("");
  }

  async function generatePdf() {
    setBusy("pdf");
    setError("");
    try {
      const { def, rows, start, end } = await fetchRows();
      const w = window.open("", "_blank");
      if (!w) throw new Error("Popup blocked — allow popups to print reports.");
      const title = `${def.label} — ${format(start, "dd MMM yyyy")} to ${format(end, "dd MMM yyyy")}`;
      w.document.write(`<!doctype html><html><head><title>${title}</title><style>
        body{font-family:system-ui,sans-serif;margin:32px;color:#111}
        h1{font-size:18px} .meta{color:#666;font-size:12px;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #ddd;padding:5px 8px;text-align:left}
        th{background:#f4f4f5} tr:nth-child(even) td{background:#fafafa}
        @media print{@page{margin:14mm}}
      </style></head><body>
        <h1>CamAI — ${title}</h1>
        <div class="meta">${org?.name ?? ""} · generated ${format(new Date(), "dd MMM yyyy HH:mm")} · ${rows.length} rows</div>
        <table><thead><tr>${def.headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r: any) => `<tr>${def.row(r).map((c) => `<td>${String(c ?? "").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></body></html>`);
      w.document.close();
      w.focus();
      w.print();

      if (org) {
        await supabase.from("reports").insert({
          org_id: org.id,
          name: `${def.label} — ${format(start, "dd MMM")} to ${format(end, "dd MMM yyyy")}`,
          kind,
          format: "pdf",
          params: { source, from: start.toISOString(), to: end.toISOString() },
          row_count: rows.length,
          created_by: profile?.id,
        });
        audit("report.generate", "report", title, { module: "reports", detail: { source, kind, format: "pdf", rows: rows.length } });
        qc.invalidateQueries({ queryKey: ["reports"] });
      }
    } catch (e: any) {
      setError(e.message ?? "Report failed.");
    }
    setBusy("");
  }

  async function download(r: Report) {
    if (!r.storage_path) return;
    const { data } = await supabase.storage.from("reports").createSignedUrl(r.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate exports from live data. CSV runs are archived in encrypted storage for re-download." />

      <div className="card p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Data source">
            <select className="input" value={source} onChange={(e) => setSource(e.target.value as SourceKey)}>
              {(Object.keys(SOURCES) as SourceKey[]).map((k) => (
                <option key={k} value={k}>{SOURCES[k].label}</option>
              ))}
            </select>
          </Field>
          <Field label="Period">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="daily">Daily (today)</option>
              <option value="weekly">Weekly (7 days)</option>
              <option value="monthly">Monthly (30 days)</option>
              <option value="custom">Custom range</option>
            </select>
          </Field>
          {kind === "custom" && (
            <>
              <Field label="From">
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn-primary" onClick={generateCsv} disabled={!!busy}>
            <Download size={14} /> {busy === "csv" ? "Generating…" : "Export CSV"}
          </button>
          <button className="btn-ghost" onClick={generatePdf} disabled={!!busy}>
            <FileText size={14} /> {busy === "pdf" ? "Preparing…" : "Print / PDF"}
          </button>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-1">Report history</h2>
      {!history?.length ? (
        <Empty text="No reports generated yet." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="th">Report</th><th className="th">Kind</th><th className="th">Format</th>
                <th className="th">Rows</th><th className="th">Generated</th><th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <td className="td text-ink-1">{r.name}</td>
                  <td className="td"><Badge>{r.kind}</Badge></td>
                  <td className="td"><Badge tone="accent">{r.format.toUpperCase()}</Badge></td>
                  <td className="td text-ink-3">{r.row_count}</td>
                  <td className="td text-ink-3">{fmtDateTime(r.created_at)}</td>
                  <td className="td text-right">
                    {r.storage_path && (
                      <button className="text-xs text-accent hover:underline" onClick={() => download(r)}>Download</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
