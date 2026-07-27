// Evidence export: PNG, JPEG, PDF, CSV, JSON.
//
// WHY THE PDF IS WRITTEN BY HAND
//
// A PDF incident report is a hard requirement for handing evidence to someone
// who is not running the software — insurers, police, a site manager's email.
// The usual answer is jsPDF or pdfmake, and both were rejected: they are
// ~300KB of dependency for one report, they pull a licence into a product that
// is being SOLD as source, and this renderer already ships a strict local-only
// posture with no CDN. A PDF that embeds a JPEG is genuinely simple — JPEG is a
// native PDF filter (DCTDecode), so the image bytes go in verbatim with no
// re-encoding and no pixel work at all. About 200 lines, no dependency, no
// licence question, and the output opens in every reader.
//
// The writer below is deliberately minimal: one font (Helvetica, a PDF base-14
// face that needs no embedding), DeviceRGB images, no compression on the
// content stream. It is not a general PDF library and should not grow into one.

import type { AlertEvent } from "./alertEngine";
import type { TimelineEntry } from "./trackLedger";

// --- shared download plumbing ------------------------------------------------

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked late on purpose: revoking synchronously races the download in
  // Chromium and silently yields a zero-byte file.
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

export const stamp = (ts: number): string =>
  new Date(ts).toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);

export const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "camera";

export function stemFor(event: AlertEvent): string {
  return `${slug(event.cameraName)}_${slug(event.def.title)}_${stamp(event.ts)}`;
}

async function blobFromUrl(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    return await res.blob();
  } catch {
    return null;
  }
}

// --- CSV ---------------------------------------------------------------------

/** RFC4180 quoting. Excel opens this correctly including embedded commas. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRows(rows: unknown[][]): string {
  // BOM so Excel detects UTF-8 rather than mangling non-ASCII site names.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function exportCsv(event: AlertEvent, timeline: TimelineEntry[]): void {
  const rows: unknown[][] = [
    ["field", "value"],
    ["incident_id", event.id],
    ["detected_at", new Date(event.ts).toISOString()],
    ["event", event.def.title],
    ["category", event.def.group],
    ["severity", event.severity],
    ["engine_key", event.sourceKey],
    ["confidence", event.confidence],
    ["track_id", event.trackId],
    ["camera_id", event.cameraId],
    ["camera_name", event.cameraName],
    ["site", event.siteName],
    ["acknowledged", event.acknowledged],
    ["plate_text", event.meta.plate],
    ["plate_ocr_confidence", event.meta.plateConfidence],
    ["plate_failure", event.meta.plateFailure],
    ["speed_kmh", event.meta.speed],
    ["speed_status", event.meta.speedStatus],
    ["direction", event.meta.direction],
    ["dwell_seconds", event.meta.dwellSeconds],
    ["lane", event.meta.lane],
    ["tracking_status", event.meta.trackStatus],
    ["pipeline_fps", event.meta.fps],
    ["inference_device", event.meta.device],
    ["snapshot_kind", event.meta.cropKind],
    ["crop_zoom", event.meta.zoom],
    ["crop_refreshes", event.refreshes],
    ["bbox_x1", event.bbox?.x1], ["bbox_y1", event.bbox?.y1],
    ["bbox_x2", event.bbox?.x2], ["bbox_y2", event.bbox?.y2],
    [],
    ["timeline_ts", "timeline_event", "basis", "detail"],
    ...timeline.map((e) => [new Date(e.ts).toISOString(), e.label, e.basis, e.detail ?? ""]),
    [],
    ["frame_detection_class", "confidence", "track_id", "x1", "y1", "x2", "y2"],
    ...event.frameDetections.map((d: any) => [
      d.class, d.confidence, d.track_id,
      d.bbox?.x1, d.bbox?.y1, d.bbox?.x2, d.bbox?.y2,
    ]),
  ];
  triggerDownload(
    new Blob([csvRows(rows)], { type: "text/csv;charset=utf-8" }),
    `${stemFor(event)}_metadata.csv`,
  );
}

// --- images ------------------------------------------------------------------

export async function exportJpeg(event: AlertEvent, which: "crop" | "full"): Promise<boolean> {
  const url = which === "crop" ? event.cropUrl : event.fullUrl;
  if (!url) return false;
  const blob = await blobFromUrl(url);
  if (!blob) return false;
  triggerDownload(blob, `${stemFor(event)}_${which}.jpg`);
  return true;
}

export async function exportPngFile(event: AlertEvent, which: "crop" | "full"): Promise<boolean> {
  const url = which === "crop" ? event.cropUrl : event.fullUrl;
  if (!url) return false;
  const src = await blobFromUrl(url);
  if (!src) return false;
  const { toPng } = await import("./smartCrop");
  const png = await toPng(src);
  if (!png) return false;
  triggerDownload(png, `${stemFor(event)}_${which}.png`);
  return true;
}

// --- PDF ---------------------------------------------------------------------

/** Latin-1 bytes. PDF's base encoding for simple strings and all syntax. */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** Escape for a PDF literal string, and strip anything outside Latin-1 so a
 *  stray character can never corrupt the file structure. */
function pdfText(s: string): string {
  return String(s ?? "")
    .replace(/[Ā-￿]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

interface PdfImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

async function jpegForPdf(url: string | null): Promise<PdfImage | null> {
  if (!url) return null;
  const blob = await blobFromUrl(url);
  if (!blob) return null;
  const dims = await new Promise<{ w: number; h: number } | null>((resolve) => {
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(objUrl);
    };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(objUrl); };
    img.src = objUrl;
  });
  if (!dims || !dims.w || !dims.h) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: dims.w, height: dims.h };
}

const PAGE_W = 595.28; // A4 portrait, points
const PAGE_H = 841.89;
const MARGIN = 42;

/**
 * Build the incident PDF.
 *
 * Page 1 is the record: header, the facts as a label/value table, the evidence
 * crop, and the object timeline. Page 2 is the full frame, when one exists.
 */
export async function exportPdf(event: AlertEvent, timeline: TimelineEntry[]): Promise<void> {
  const crop = await jpegForPdf(event.cropUrl);
  const full = await jpegForPdf(event.fullUrl);

  const objects: Array<Uint8Array | string> = [];
  const push = (body: Uint8Array | string): number => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1..3 for catalog/pages/font by pushing placeholders we overwrite.
  const catalogNo = push("");
  const pagesNo = push("");
  const fontNo = push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>");
  const fontBoldNo = push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>");

  const imageObjNo = new Map<"crop" | "full", number>();
  for (const [key, img] of [["crop", crop], ["full", full]] as const) {
    if (!img) continue;
    const header =
      `<</Type/XObject/Subtype/Image/Width ${img.width}/Height ${img.height}` +
      `/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${img.bytes.length}>>stream\n`;
    const merged = new Uint8Array(header.length + img.bytes.length + "\nendstream".length);
    merged.set(latin1(header), 0);
    merged.set(img.bytes, header.length);
    merged.set(latin1("\nendstream"), header.length + img.bytes.length);
    imageObjNo.set(key, push(merged));
  }

  // ---- page 1 content ----
  const L: string[] = [];
  let y = PAGE_H - MARGIN;
  const text = (s: string, size: number, yy: number, bold = false, x = MARGIN) => {
    L.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${yy} Td (${pdfText(s)}) Tj ET`);
  };
  const rule = (yy: number) => {
    L.push(`0.82 0.82 0.85 RG 0.7 w ${MARGIN} ${yy} m ${PAGE_W - MARGIN} ${yy} l S`);
  };

  text("CamAI — Incident Report", 19, y, true);
  y -= 16;
  text(`${event.def.title}  ·  ${event.severity.toUpperCase()}`, 11, y);
  y -= 12;
  text(
    `${event.cameraName} · ${event.siteName} · ${new Date(event.ts).toLocaleString()}`,
    9.5, y,
  );
  y -= 10;
  rule(y);
  y -= 18;

  const facts: Array<[string, string]> = [
    ["Incident ID", event.id],
    ["Detected at", new Date(event.ts).toISOString()],
    ["Category", event.def.group],
    ["Engine class", event.sourceKey],
    ["Confidence", event.confidence != null ? `${(event.confidence * 100).toFixed(1)}%` : "not reported"],
    ["Track ID", event.trackId != null ? `#${event.trackId}` : "untracked"],
    ["Camera ID", event.cameraId],
    ["Acknowledged", event.acknowledged ? "yes" : "no"],
  ];
  if (event.meta.plate) facts.push(["Plate text", event.meta.plate]);
  if (event.meta.plateConfidence != null) {
    facts.push(["Plate OCR confidence", `${(event.meta.plateConfidence * 100).toFixed(1)}%`]);
  }
  if (event.meta.speed != null) {
    const st = event.meta.speedStatus === "calibrated" ? "measured" : `${event.meta.speedStatus ?? "unknown"}`;
    facts.push(["Speed", `${Math.round(event.meta.speed)} km/h (${st})`]);
  }
  if (event.meta.direction) facts.push(["Direction", event.meta.direction]);
  if (event.meta.dwellSeconds != null) facts.push(["Dwell", `${Math.round(event.meta.dwellSeconds)} s`]);
  facts.push(["Snapshot", event.meta.cropKind === "detection" ? "object crop" : "scene (no single subject)"]);
  if (event.meta.device) facts.push(["Inference device", event.meta.device]);

  text("DETECTION RECORD", 8.5, y, true);
  y -= 13;
  for (const [k, v] of facts) {
    text(k, 9, y);
    text(v, 9, y, false, MARGIN + 140);
    y -= 12.5;
  }

  // Evidence image, scaled to fit the remaining column width.
  if (crop) {
    y -= 8;
    text("EVIDENCE SNAPSHOT", 8.5, y, true);
    y -= 6;
    const maxW = PAGE_W - MARGIN * 2;
    const maxH = 210;
    const scale = Math.min(maxW / crop.width, maxH / crop.height);
    const w = crop.width * scale;
    const h = crop.height * scale;
    y -= h;
    L.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${MARGIN} ${y.toFixed(2)} cm /Im0 Do Q`);
    y -= 12;
    text(
      `Cropped from the live frame · zoom ${event.meta.zoom?.toFixed(2) ?? "1.00"}x` +
      (event.refreshes ? ` · refreshed ${event.refreshes}x while subject in view` : ""),
      7.5, y,
    );
    y -= 14;
  }

  if (timeline.length) {
    rule(y);
    y -= 14;
    text("OBJECT TIMELINE", 8.5, y, true);
    y -= 13;
    for (const e of timeline.slice(-16)) {
      if (y < MARGIN + 30) break;
      const t = new Date(e.ts).toLocaleTimeString();
      text(t, 8, y);
      text(e.label, 8, y, false, MARGIN + 62);
      text(e.basis, 7, y, false, PAGE_W - MARGIN - 58);
      y -= 11;
    }
  }

  // Provenance footer — this matters on a document that may be handed to a
  // third party as evidence.
  text(
    "Generated by CamAI from local engine telemetry. Times are the operator node's local clock.",
    7, MARGIN - 12,
  );

  const content1 = L.join("\n");
  const contentNo1 = push(`<</Length ${content1.length}>>stream\n${content1}\nendstream`);

  const pageNos: number[] = [];
  const res1 =
    `<</Font<</F1 ${fontNo} 0 R/F2 ${fontBoldNo} 0 R>>` +
    (imageObjNo.has("crop") ? `/XObject<</Im0 ${imageObjNo.get("crop")} 0 R>>` : "") + ">>";
  pageNos.push(push(
    `<</Type/Page/Parent ${pagesNo} 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]` +
    `/Resources ${res1}/Contents ${contentNo1} 0 R>>`,
  ));

  // ---- page 2: full frame ----
  if (full && imageObjNo.has("full")) {
    const P: string[] = [];
    let y2 = PAGE_H - MARGIN;
    P.push(`BT /F2 13 Tf ${MARGIN} ${y2} Td (${pdfText("Full frame at detection")}) Tj ET`);
    y2 -= 14;
    P.push(`BT /F1 8.5 Tf ${MARGIN} ${y2} Td (${pdfText(
      `${event.cameraName} · ${new Date(event.ts).toLocaleString()} · ${event.frameDetections.length} object(s) in frame`,
    )}) Tj ET`);
    y2 -= 10;
    const maxW = PAGE_W - MARGIN * 2;
    const maxH = y2 - MARGIN - 100;
    const scale = Math.min(maxW / full.width, maxH / full.height);
    const w = full.width * scale;
    const h = full.height * scale;
    y2 -= h + 6;
    P.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${MARGIN} ${y2.toFixed(2)} cm /Im1 Do Q`);

    y2 -= 18;
    P.push(`BT /F2 8.5 Tf ${MARGIN} ${y2} Td (${pdfText("OBJECTS IN FRAME")}) Tj ET`);
    y2 -= 12;
    for (const d of event.frameDetections.slice(0, 22) as any[]) {
      if (y2 < MARGIN) break;
      const line =
        `${d.class}` +
        (d.track_id != null ? ` #${d.track_id}` : "") +
        `  ${Math.round((d.confidence ?? 0) * 100)}%` +
        (d.bbox ? `  [${d.bbox.x1.toFixed(3)}, ${d.bbox.y1.toFixed(3)} - ${d.bbox.x2.toFixed(3)}, ${d.bbox.y2.toFixed(3)}]` : "");
      P.push(`BT /F1 8 Tf ${MARGIN} ${y2} Td (${pdfText(line)}) Tj ET`);
      y2 -= 10.5;
    }

    const content2 = P.join("\n");
    const contentNo2 = push(`<</Length ${content2.length}>>stream\n${content2}\nendstream`);
    pageNos.push(push(
      `<</Type/Page/Parent ${pagesNo} 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]` +
      `/Resources<</Font<</F1 ${fontNo} 0 R/F2 ${fontBoldNo} 0 R>>/XObject<</Im1 ${imageObjNo.get("full")} 0 R>>>>` +
      `/Contents ${contentNo2} 0 R>>`,
    ));
  }

  objects[catalogNo - 1] = `<</Type/Catalog/Pages ${pagesNo} 0 R>>`;
  objects[pagesNo - 1] =
    `<</Type/Pages/Kids[${pageNos.map((n) => `${n} 0 R`).join(" ")}]/Count ${pageNos.length}>>`;

  // ---- serialise with a correct xref table ----
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const add = (u: Uint8Array) => { chunks.push(u); offset += u.length; };

  add(latin1("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    add(latin1(`${i + 1} 0 obj\n`));
    const body = objects[i];
    add(typeof body === "string" ? latin1(body) : body);
    add(latin1("\nendobj\n"));
  }
  const xrefStart = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  add(latin1(xref));
  add(latin1(`trailer\n<</Size ${objects.length + 1}/Root ${catalogNo} 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`));

  triggerDownload(new Blob(chunks as BlobPart[], { type: "application/pdf" }), `${stemFor(event)}_incident.pdf`);
}

// --- JSON --------------------------------------------------------------------

export function incidentReport(event: AlertEvent, timeline: TimelineEntry[]): Record<string, unknown> {
  return {
    incident_id: event.id,
    generated_at: new Date().toISOString(),
    schema: "camai.incident/1",
    event: {
      title: event.def.title,
      category: event.def.group,
      severity: event.severity,
      engine_key: event.sourceKey,
      detected_at: new Date(event.ts).toISOString(),
      confidence: event.confidence,
      track_id: event.trackId,
      bbox_normalised: event.bbox,
      acknowledged: event.acknowledged,
    },
    camera: { id: event.cameraId, name: event.cameraName, site: event.siteName },
    snapshot: {
      kind: event.meta.cropKind,
      source_region_px: event.meta.region,
      zoom: event.meta.zoom,
      aspect: event.meta.aspect,
      live_refreshes: event.refreshes,
      has_crop: event.cropUrl != null,
      has_full_frame: event.fullUrl != null,
    },
    telemetry: {
      plate_text: event.meta.plate,
      plate_ocr_confidence: event.meta.plateConfidence,
      plate_failure: event.meta.plateFailure,
      lane: event.meta.lane,
      speed_kmh: event.meta.speed,
      speed_status: event.meta.speedStatus,
      tracking_status: event.meta.trackStatus,
      dwell_seconds: event.meta.dwellSeconds,
      direction: event.meta.direction,
      pipeline_fps: event.meta.fps,
      inference_device: event.meta.device,
    },
    // Each row states whether it was reported by the engine, observed across
    // payloads, or correlated from a camera-scope counter. A consumer of this
    // file must be able to tell those apart.
    timeline: timeline.map((e) => ({
      at: new Date(e.ts).toISOString(),
      kind: e.kind,
      label: e.label,
      basis: e.basis,
      detail: e.detail ?? null,
    })),
    frame_detections: event.frameDetections,
  };
}

export function exportJson(event: AlertEvent, timeline: TimelineEntry[]): void {
  triggerDownload(
    new Blob([JSON.stringify(incidentReport(event, timeline), null, 2)], { type: "application/json" }),
    `${stemFor(event)}_incident.json`,
  );
}

/** Everything, as separate files under one name stem. */
export async function exportBundle(event: AlertEvent, timeline: TimelineEntry[]): Promise<void> {
  await exportJpeg(event, "crop");
  await exportJpeg(event, "full");
  exportJson(event, timeline);
  exportCsv(event, timeline);
  await exportPdf(event, timeline);
}
