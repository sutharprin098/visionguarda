// Bulk export for the Alerts page — CSV/JSON/PDF over a whole (filtered or
// selected) set of alerts, as opposed to incidentExport.ts's single-incident
// deep dive. Shares its download plumbing and PDF primitives so there is one
// place that knows how to write a PDF and one place that knows how to name a
// file.

import type { AlertEvent } from "./alertEngine";
import { incidentReport } from "./incidentExport";
import {
  triggerDownload, stamp, pdfText, serializePdf, PAGE_W, PAGE_H, MARGIN,
} from "./incidentExport";

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRows(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

const stemFor = () => `camai_alerts_${stamp(Date.now())}`;

export function exportAlertsCsv(events: AlertEvent[]): void {
  const rows: unknown[][] = [
    [
      "id", "detected_at", "event", "category", "severity", "camera", "site",
      "confidence", "track_id", "plate_text", "speed_kmh", "acknowledged", "live",
    ],
    ...events.map((e) => [
      e.id,
      new Date(e.ts).toISOString(),
      e.def.title,
      e.def.group,
      e.severity,
      e.cameraName,
      e.siteName,
      e.confidence,
      e.trackId,
      e.meta.plate,
      e.meta.speed,
      e.acknowledged,
      e.live,
    ]),
  ];
  triggerDownload(
    new Blob([csvRows(rows)], { type: "text/csv;charset=utf-8" }),
    `${stemFor()}.csv`,
  );
}

export function exportAlertsJson(events: AlertEvent[]): void {
  const payload = {
    generated_at: new Date().toISOString(),
    schema: "camai.alerts-export/1",
    count: events.length,
    alerts: events.map((e) => incidentReport(e, e.timeline)),
  };
  triggerDownload(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `${stemFor()}.json`,
  );
}

/**
 * A summary table PDF — one row per alert, paginated. Deliberately no
 * per-incident evidence images here: that level of detail already exists in
 * the single-incident PDF (see IncidentWindow's Downloads tab); this is the
 * "hand a shift's worth of alerts to someone" report.
 */
export function exportAlertsPdf(events: AlertEvent[]): void {
  const objects: Array<Uint8Array | string> = [];
  const push = (body: Uint8Array | string): number => { objects.push(body); return objects.length; };

  const catalogNo = push("");
  const pagesNo = push("");
  const fontNo = push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
  const fontBoldNo = push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>");
  const res = `<</Font<</F1 ${fontNo} 0 R/F2 ${fontBoldNo} 0 R>>>>`;

  const ROWS_PER_PAGE = 40;
  const pageNos: number[] = [];

  const cols: Array<[string, number, (e: AlertEvent) => string]> = [
    ["Time", MARGIN, (e) => new Date(e.ts).toLocaleString()],
    ["Severity", MARGIN + 130, (e) => e.severity.toUpperCase()],
    ["Event", MARGIN + 200, (e) => e.def.title],
    ["Camera", MARGIN + 340, (e) => e.cameraName],
    ["Conf.", MARGIN + 460, (e) => (e.confidence != null ? `${(e.confidence * 100).toFixed(0)}%` : "—")],
    ["Ack", MARGIN + 505, (e) => (e.acknowledged ? "yes" : "no")],
  ];

  for (let p = 0; p * ROWS_PER_PAGE < Math.max(events.length, 1); p++) {
    const slice = events.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    const L: string[] = [];
    let y = PAGE_H - MARGIN;
    const text = (s: string, size: number, x: number, yy: number, bold = false) => {
      L.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yy} Td (${pdfText(s)}) Tj ET`);
    };
    const rule = (yy: number) => {
      L.push(`0.82 0.82 0.85 RG 0.7 w ${MARGIN} ${yy} m ${PAGE_W - MARGIN} ${yy} l S`);
    };

    if (p === 0) {
      text("CamAI — Alerts Export", 17, MARGIN, y, true);
      y -= 14;
      text(
        `${events.length} alert${events.length === 1 ? "" : "s"} · generated ${new Date().toLocaleString()}`,
        9, MARGIN, y,
      );
      y -= 10;
    } else {
      text(`CamAI — Alerts Export (page ${p + 1})`, 11, MARGIN, y, true);
      y -= 10;
    }
    rule(y);
    y -= 14;

    for (const [label, x] of cols) text(label, 8, x, y, true);
    y -= 10;
    rule(y);
    y -= 12;

    for (const e of slice) {
      if (y < MARGIN + 10) break;
      for (const [, x, get] of cols) {
        const v = get(e);
        text(v.length > 32 ? `${v.slice(0, 31)}…` : v, 8, x, y);
      }
      y -= 12;
    }

    const content = L.join("\n");
    const contentNo = push(`<</Length ${content.length}>>stream\n${content}\nendstream`);
    pageNos.push(push(
      `<</Type/Page/Parent ${pagesNo} 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]/Resources ${res}/Contents ${contentNo} 0 R>>`,
    ));
  }

  objects[catalogNo - 1] = `<</Type/Catalog/Pages ${pagesNo} 0 R>>`;
  objects[pagesNo - 1] =
    `<</Type/Pages/Kids[${pageNos.map((n) => `${n} 0 R`).join(" ")}]/Count ${pageNos.length}>>`;

  triggerDownload(serializePdf(objects, catalogNo), `${stemFor()}.pdf`);
}
