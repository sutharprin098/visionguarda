/**
 * Local Telegram delivery — sends alerts directly from the desktop to the
 * Telegram Bot API. No Supabase storage involved. Snapshots are read from the
 * local engine's HTTP static mount and sent as multipart/form-data to sendPhoto.
 * This avoids the photo-loop bug: we never upsert to storage, so the DB trigger
 * never re-fires, and old alerts are never re-sent.
 *
 * Settings (bot_token + chat_id) are loaded from public.telegram_settings via
 * Supabase, but the send itself is 100% local machine → Telegram API.
 */

import { getSupabase } from "./session";

const ENGINE_BASE = "http://127.0.0.1:8000";

interface TelegramConfig {
  enabled: boolean;
  bot_token: string;
  chat_id: string;
}

// Cached for the session — Telegram settings don't change often.
let cachedConfig: TelegramConfig | null = null;
let configLoadedAt = 0;
const CONFIG_TTL_MS = 60_000; // re-fetch every minute

export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const now = Date.now();
  if (cachedConfig && now - configLoadedAt < CONFIG_TTL_MS) return cachedConfig;
  try {
    const sb = await getSupabase();
    const { data } = await sb
      .from("telegram_settings")
      .select("enabled, bot_token, chat_id")
      .maybeSingle();
    cachedConfig = data ?? null;
    configLoadedAt = now;
    return cachedConfig;
  } catch {
    return null;
  }
}

export function invalidateTelegramConfig() {
  cachedConfig = null;
  configLoadedAt = 0;
}

const SEVERITY_MARK: Record<string, string> = {
  critical: "🔴 CRITICAL",
  warning:  "🟠 WARNING",
  info:     "🔵 INFO",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function humanize(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Send a single engine alert to Telegram. Called from reportEvents() instead
 * of uploading to Supabase storage. Returns true on success.
 *
 * Photo flow:
 *   1. Fetch the JPEG from the local engine's static file server (ENGINE_BASE + screenshot_path).
 *   2. POST it as multipart/form-data to Telegram's sendPhoto — Telegram receives
 *      and caches the image; we never touch Supabase storage.
 *   3. If the fetch fails (no snapshot, engine busy), fall back to sendMessage.
 */
export async function sendLocalTelegramAlert(alert: {
  id: string;
  camera_id: string;
  alert_type: string;
  message: string;
  timestamp: string;
  screenshot_path?: string | null;
  detail?: string | null;
  cameraName?: string;
}): Promise<boolean> {
  const cfg = await getTelegramConfig();
  if (!cfg || !cfg.enabled || !cfg.bot_token || !cfg.chat_id) return false;

  let d: Record<string, unknown> = {};
  try { d = alert.detail ? JSON.parse(alert.detail) : {}; } catch { /* keep {} */ }

  const severity = (d.severity as string) || "info";
  const detectionName = (d.detection_name as string) || humanize(alert.alert_type);
  const confidence = typeof d.confidence === "number"
    ? `${Math.round((d.confidence as number) * 100)}%`
    : null;
  const trackId = d.track_id != null ? String(d.track_id) : null;

  const lines = [
    `${SEVERITY_MARK[severity] ?? "🔔 ALERT"} — <b>${esc(detectionName)}</b>`,
    "",
    `<b>${esc(alert.message)}</b>`,
    "",
    `📷 <b>Camera:</b> ${esc(alert.cameraName ?? alert.camera_id)}`,
    confidence ? `🎯 <b>Confidence:</b> ${esc(confidence)}` : null,
    trackId ? `🔖 <b>Track ID:</b> ${esc(trackId)}` : null,
    d.plate_text ? `🚘 <b>Plate:</b> ${esc(d.plate_text)}` : null,
    d.speed_kmh != null ? `⚡ <b>Speed:</b> ${esc(d.speed_kmh)} km/h` : null,
    `⏰ <b>Time:</b> ${esc(new Date(alert.timestamp).toLocaleString())}`,
  ].filter(Boolean).join("\n");

  const base = `https://api.telegram.org/bot${cfg.bot_token}`;

  // Try to get snapshot from local engine
  if (alert.screenshot_path) {
    try {
      const imgRes = await fetch(`${ENGINE_BASE}${alert.screenshot_path}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (imgRes.ok) {
        const blob = await imgRes.blob();
        const form = new FormData();
        form.append("chat_id", cfg.chat_id);
        form.append("photo", blob, "snapshot.jpg");
        form.append("caption", lines.slice(0, 1024));
        form.append("parse_mode", "HTML");
        const res = await fetch(`${base}/sendPhoto`, { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.ok) return true;
        // sendPhoto failed — fall through to sendMessage
      }
    } catch {
      // fetch timeout or parse error — fall through
    }
  }

  // Fallback: text message only
  try {
    const res = await fetch(`${base}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.chat_id,
        text: lines,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const body = await res.json().catch(() => ({}));
    return res.ok && body?.ok;
  } catch {
    return false;
  }
}

/** Quick test send — used by the Alerts tab "Test" button. */
export async function sendTelegramTest(bot_token: string, chat_id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: "✅ <b>CamAI Test</b>\n\nYour Telegram notifications are working! Alerts from your cameras will be sent here automatically.",
        parse_mode: "HTML",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.ok) return { ok: false, error: body?.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
