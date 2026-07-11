import { format, formatDistanceToNow } from "date-fns";

export const fmtDate = (d?: string | null) => (d ? format(new Date(d), "dd MMM yyyy") : "—");
export const fmtDateTime = (d?: string | null) => (d ? format(new Date(d), "dd MMM yyyy HH:mm") : "—");
export const fmtAgo = (d?: string | null) =>
  d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : "never";
export const fmtBytes = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
export const fmtMoney = (cents: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

/** Client-side CSV download (values escaped, UTF-8 BOM for Excel). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function browserInfo() {
  const ua = navigator.userAgent;
  const browser =
    ua.includes("Edg/") ? "Edge" :
    ua.includes("Chrome/") ? "Chrome" :
    ua.includes("Firefox/") ? "Firefox" :
    ua.includes("Safari/") ? "Safari" : "Other";
  const os =
    ua.includes("Windows") ? "Windows" :
    ua.includes("Mac") ? "macOS" :
    ua.includes("Linux") ? "Linux" : "Other";
  return { browser, os };
}
