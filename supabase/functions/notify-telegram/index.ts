// POST /functions/v1/notify-telegram
// Called ONLY by app.trg_alert_notify_telegram() via pg_net (never by a
// browser) — verify_jwt is off (see config.toml) because the caller is
// Postgres, not a user, so the service-role bearer is checked by hand,
// exactly like send-email.
//
// This is the whole Telegram delivery path and it is completely model
// agnostic: it is handed an alert_id, reloads that row from public.alerts,
// and sends WHATEVER it finds. It never branches on the detection type —
// human, vehicle, helmet, ANPR, speed, intrusion, face, or anything a future
// detector adds all travel the same code. The message it sends is built from
// the same row the Admin Dashboard renders, so the two are identical by
// construction (no mapping table, no per-model formatting).
import { adminClient, json, corsHeaders, safeEqual } from "../_shared/util.ts";

// Priority marker from the alert's own severity — not from the detection type.
const SEVERITY_MARK: Record<string, string> = {
  critical: "🔴 CRITICAL",
  warning: "🟠 WARNING",
  info: "🔵 INFO",
};

// Telegram HTML parse_mode requires these three escaped in text nodes.
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A human label for the detection when the engine didn't supply an explicit
// detection_name — derived straight from the alert's own `kind`, never from a
// hardcoded per-model map. "helmet_violation" -> "Helmet Violation".
function humanize(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Deliver a Telegram API call with bounded retries. Telegram (and the network
// in between) fail transiently: rate limits (429 with retry_after), transient
// 5xx, and a bot that is briefly unreachable all resolve on a retry. We retry
// those with backoff, honour Telegram's own retry_after, and treat a 4xx other
// than 429 as permanent (a bad chat_id or malformed payload won't fix itself).
// Returns the final parsed body plus whether it ultimately succeeded.
async function tgSend(
  base: string,
  method: string,
  payload: unknown,
): Promise<{ ok: boolean; description?: string; status: number }> {
  const MAX_ATTEMPTS = 4;
  let lastDesc = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${base}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      lastStatus = res.status;
      const body = await res.json().catch(() => ({} as any));
      if (res.ok && body?.ok !== false) return { ok: true, status: res.status };

      lastDesc = String(body?.description ?? res.status);
      // 429 → wait exactly what Telegram asks (parameters.retry_after seconds).
      if (res.status === 429) {
        const retryAfter = Number(body?.parameters?.retry_after ?? 1);
        if (attempt < MAX_ATTEMPTS) { await sleep((retryAfter || 1) * 1000); continue; }
      } else if (res.status >= 500) {
        // Transient Telegram-side failure — exponential backoff.
        if (attempt < MAX_ATTEMPTS) { await sleep(400 * 2 ** (attempt - 1)); continue; }
      }
      // 4xx other than 429: permanent, don't waste more attempts.
      return { ok: false, description: lastDesc, status: res.status };
    } catch (e) {
      // Network error / bot unreachable — retry with backoff.
      lastDesc = e instanceof Error ? e.message : String(e);
      lastStatus = 0;
      if (attempt < MAX_ATTEMPTS) { await sleep(400 * 2 ** (attempt - 1)); continue; }
    }
  }
  return { ok: false, description: lastDesc, status: lastStatus };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Authenticate the caller (the alerts AFTER INSERT trigger, via pg_net).
  // Primary: a dedicated shared secret this function and the trigger both hold
  // (TELEGRAM_WEBHOOK_SECRET) — independent of which key type the runtime
  // injects, since projects with the new API-key system inject sb_secret_… into
  // SUPABASE_SERVICE_ROLE_KEY, which won't match a legacy service_role JWT.
  // Fallback: the service-role key, so a plain service-role invocation also works.
  const authHeader = req.headers.get("Authorization") ?? "";
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Constant-time compares: verify_jwt is off here, so this bearer check is the
  // only gate, and an unauthenticated caller can probe it without limit.
  const authorized =
    (!!webhookSecret && safeEqual(authHeader, `Bearer ${webhookSecret}`)) ||
    (!!serviceKey && safeEqual(authHeader, `Bearer ${serviceKey}`));
  if (!authorized) {
    return json({ error: "forbidden — service role only" }, 403);
  }

  let body: { alert_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.alert_id) return json({ error: "alert_id required" }, 400);

  const db = adminClient();

  // The exact row the dashboard shows, plus the camera + org names it joins.
  const { data: alert, error: alertErr } = await db
    .from("alerts")
    .select("id, org_id, camera_id, kind, severity, title, detail, snapshot_path, created_at, " +
            "cameras(name), organizations(name)")
    .eq("id", body.alert_id)
    .maybeSingle();
  if (alertErr) return json({ error: alertErr.message }, 500);
  if (!alert) return json({ error: "alert not found" }, 404);

  // Resolve the destination: try the new QR-connect table (shared CamAI bot)
  // first; fall back to the legacy per-org telegram_settings for orgs still
  // using their own bot. This lets both flows coexist with zero migration risk.
  let botToken: string | null = null;
  let chatId: string | null = null;

  // 1. QR-connect: CamAI shared bot (TELEGRAM_BOT_TOKEN secret) + per-org chat_id
  const sharedToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (sharedToken) {
    const { data: conn } = await db
      .from("telegram_connections")
      .select("chat_id, connected")
      .eq("org_id", alert.org_id)
      .eq("connected", true)
      .maybeSingle();
    if (conn?.chat_id) {
      botToken = sharedToken;
      chatId = conn.chat_id;
    }
  }

  // 2. Legacy: per-org bot token + chat id in telegram_settings
  if (!botToken || !chatId) {
    const { data: tg } = await db
      .from("telegram_settings")
      .select("enabled, bot_token, chat_id")
      .eq("org_id", alert.org_id)
      .maybeSingle();
    if (tg?.enabled && tg.bot_token && tg.chat_id) {
      botToken = tg.bot_token;
      chatId = tg.chat_id;
    }
  }

  if (!botToken || !chatId) {
    return json({ ok: true, skipped: "telegram disabled or unconfigured" });
  }

  const detail = (alert.detail ?? {}) as Record<string, unknown>;
  // Detection name taken directly from the AI module when it supplied one
  // (report-events preserves the engine's raw type as detail.detection_name);
  // otherwise humanize the alert's kind. Either way it is the model's own
  // output, never a value this function invents.
  const detectionName = (detail.detection_name as string) || humanize(alert.kind);
  const cameraName = (alert as any).cameras?.name ?? "—";
  const orgName = (alert as any).organizations?.name ?? "—";
  const confidence = typeof detail.confidence === "number"
    ? `${Math.round((detail.confidence as number) * 100)}%`
    : null;
  const trackId = detail.track_id != null ? String(detail.track_id) : null;

  // Build the message from the row. Only fields that are actually present are
  // shown, so a text-only human alert and a plate alert both render cleanly.
  const lines = [
    `${SEVERITY_MARK[alert.severity] ?? "🔔 ALERT"} — <b>${esc(detectionName)}</b>`,
    "",
    `<b>${esc(alert.title)}</b>`,
    "",
    `📷 <b>Camera:</b> ${esc(cameraName)}`,
    `🆔 <b>Camera ID:</b> <code>${esc(alert.camera_id ?? "—")}</code>`,
    `🏢 <b>Organization:</b> ${esc(orgName)}`,
    confidence ? `🎯 <b>Confidence:</b> ${esc(confidence)}` : null,
    trackId ? `🔖 <b>Tracking ID:</b> ${esc(trackId)}` : null,
    detail.plate_text ? `🚘 <b>Plate:</b> ${esc(detail.plate_text)}` : null,
    detail.speed_kmh != null ? `⚡ <b>Speed:</b> ${esc(detail.speed_kmh)} km/h` : null,
    `⏰ <b>Time:</b> ${esc(new Date(alert.created_at).toISOString().replace("T", " ").slice(0, 19))} UTC`,
  ].filter(Boolean);
  const text = lines.join("\n");

  // Snapshot: alerts.snapshot_path is a storage object in the `snapshots`
  // bucket (the desktop uploads it on sync). A short-lived signed URL lets
  // Telegram fetch it for sendPhoto. If there's no snapshot (or signing
  // fails), fall back to a text message — the alert is never dropped.
  let photoUrl: string | null = null;
  if (alert.snapshot_path && !alert.snapshot_path.startsWith("/")) {
    const { data: signed } = await db.storage
      .from("snapshots")
      .createSignedUrl(alert.snapshot_path, 3600);
    photoUrl = signed?.signedUrl ?? null;
  }

  // Optional video clip: a signed URL if the engine attached a recordings
  // object path. Appended as a link since Telegram photo captions can't hold
  // an arbitrary attachment.
  let clipUrl: string | null = null;
  if (typeof detail.video_path === "string" && detail.video_path && !detail.video_path.startsWith("/")) {
    const { data: signedClip } = await db.storage
      .from("recordings")
      .createSignedUrl(detail.video_path, 3600);
    clipUrl = signedClip?.signedUrl ?? null;
  }

  // Inline action buttons under every alert — jump straight to the live
  // cameras view or the dashboard in the web portal. Telegram requires https
  // URLs; there is no per-camera route in the portal, so "Open Camera" lands on
  // the cameras list (honest — no fabricated deep link).
  const portalUrl = (Deno.env.get("PORTAL_URL") ?? "https://portal-gilt-iota.vercel.app").replace(/\/+$/, "");
  const replyMarkup = {
    inline_keyboard: [[
      { text: "📷 Open Camera", url: `${portalUrl}/app/cameras` },
      { text: "📊 Open Dashboard", url: `${portalUrl}/app` },
    ]],
  };

  const base = `https://api.telegram.org/bot${botToken}`;
  let result: { ok: boolean; description?: string; status: number };
  if (photoUrl) {
    const caption = clipUrl ? `${text}\n\n🎬 <a href="${esc(clipUrl)}">Video clip</a>` : text;
    result = await tgSend(base, "sendPhoto", {
      chat_id: chatId, photo: photoUrl,
      caption: caption.slice(0, 1024), parse_mode: "HTML",
      reply_markup: replyMarkup,
    });
    // If the photo failed for a reason tied to the image (e.g. Telegram couldn't
    // fetch the signed URL in time), still deliver the alert as text so the event
    // is never silently dropped.
    if (!result.ok) {
      const full = clipUrl ? `${text}\n\n🎬 <a href="${esc(clipUrl)}">Video clip</a>` : text;
      result = await tgSend(base, "sendMessage", {
        chat_id: chatId, text: full,
        parse_mode: "HTML", disable_web_page_preview: true,
        reply_markup: replyMarkup,
      });
    }
  } else {
    const full = clipUrl ? `${text}\n\n🎬 <a href="${esc(clipUrl)}">Video clip</a>` : text;
    result = await tgSend(base, "sendMessage", {
      chat_id: chatId, text: full,
      parse_mode: "HTML", disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  }
  if (!result.ok) {
    return json({ error: `telegram send failed: ${result.description ?? result.status}` }, 502);
  }
  return json({ ok: true });
});
