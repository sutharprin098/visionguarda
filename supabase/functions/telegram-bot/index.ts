// POST /functions/v1/telegram-bot   (Telegram webhook target)
// The INTERACTIVE side of the CamAI bot: Telegram POSTs every incoming message
// here (webhook set via setWebhook). This function handles:
//
//   /start <CODE> — connection-code flow. The user generates a code in CamAI
//                   Desktop and sends it as `/start ABC123XY`; we validate it
//                   (exists, not used, not expired, rate-limited) and link the
//                   chat into telegram_connections. No QR, no deep link — the
//                   only Telegram link is the plain bot link.
//   /start        — bare: connect instructions only (never auto-connect).
//   /help         — command list (only once connected)
//   /status       — camera status summary
//   /alerts       — recent alerts
//   /critical     — critical alerts only
//   /cameras      — list cameras
//   /health       — system health
//   /disconnect   — unlink this chat
//
// verify_jwt is off (config.toml) — the caller is Telegram, not a Supabase user.
// The TELEGRAM_WEBHOOK_SECRET header guards against non-Telegram callers.
import { adminClient, json, safeEqual } from "../_shared/util.ts";

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const SEV: Record<string, string> = { critical: "🔴", warning: "🟠", info: "🔵" };

// Structured step logging. Every stage of the /start flow logs one line so the
// full path (incoming update → parsed param → lookup → validation → db update →
// success/error) is reconstructable from the function logs. Never logs secrets.
function log(step: string, data?: Record<string, unknown>): void {
  try {
    console.log(`[telegram-bot] ${step}${data ? " " + JSON.stringify(data) : ""}`);
  } catch {
    console.log(`[telegram-bot] ${step}`);
  }
}

// Send a Telegram message using CamAI's shared bot token.
async function tg(method: string, payload: unknown) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!botToken) return {};
  const r = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => ({}));
}

const HELP = [
  "🤖 <b>CamAI Bot</b> — available commands:",
  "",
  "/status — camera status summary",
  "/cameras — list all cameras",
  "/alerts — recent alerts",
  "/critical — critical alerts only",
  "/health — system health",
  "/auto — confirm real-time alerts are on",
  "/disconnect — unlink this Telegram chat",
  "/help — show this help",
].join("\n");

// Distinct, user-safe replies. None ever contains a chat id or user id.
const MSG = {
  invalid:   "❌ <b>Invalid connection code.</b>",
  expired:   "❌ <b>This connection code has expired.</b>\n\nPlease generate a new code from CamAI Desktop.",
  used:      "❌ <b>This code has already been used.</b>",
  already:   "✅ <b>Your Telegram account is already connected.</b>",
  rateLimit: "⏳ <b>Too many attempts.</b> Please wait a minute, then try again.",
  saveErr:   "⚠️ Could not save the connection. Please try again in a moment.",
  needCode:  "Please enter your CamAI connection code.",
};

// The command list shown once a chat is connected (also appended to the success
// message). Kept in one place so HELP and the success reply never drift.
const COMMANDS = [
  "/status — camera status summary",
  "/cameras — list all cameras",
  "/alerts — recent alerts",
  "/critical — critical alerts only",
  "/health — system health",
  "/help — show all commands",
  "/disconnect — unlink this chat",
].join("\n");

// The success reply (spec §5): confirmation + org name + "alerts enabled" +
// the available-commands list.
function successMsg(orgName: string): string {
  return [
    "✅ <b>CamAI connected successfully.</b>",
    "",
    `<b>Organization:</b> ${esc(orgName)}`,
    "",
    "Telegram alerts are now enabled — every AI alert is delivered here in real time, automatically.",
    "",
    "<b>Available commands:</b>",
    COMMANDS,
  ].join("\n");
}

// Rate limit: at most RATE_MAX_FAILS failed /start CODE attempts per chat per
// window. Backed by public.telegram_connect_attempts so it holds across the
// stateless, multi-instance edge runtime.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_FAILS = 5;

async function tooManyFails(db: any, chatId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("telegram_connect_attempts")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", chatId)
    .gte("attempted_at", since);
  return (count ?? 0) >= RATE_MAX_FAILS;
}
async function recordFail(db: any, chatId: string): Promise<void> {
  await db.from("telegram_connect_attempts").insert({ chat_id: chatId });
}

// The ONE place a connection code is validated + consumed + turned into a live
// connection. Every branch replies and never throws → the webhook always 200s.
async function connectWithCode(
  db: any,
  rawCode: string,
  ctx: { chatId: string; firstName: string; chatName: string; tgUsername: string; tgUserId: string },
): Promise<void> {
  const code = rawCode.trim().toUpperCase();
  log("connect: parsed code", { chat: ctx.chatId, codeLen: code.length });

  // Brute-force guard, BEFORE any lookup.
  if (await tooManyFails(db, ctx.chatId)) {
    log("connect: rate-limited", { chat: ctx.chatId });
    await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: MSG.rateLimit });
    return;
  }

  // Already connected? Report and stop (reconnect requires /disconnect first).
  // limit(1) — a chat could in theory be linked to more than one org.
  const { data: existingRows } = await db
    .from("telegram_connections")
    .select("org_id")
    .eq("chat_id", ctx.chatId)
    .eq("connected", true)
    .limit(1);
  if (existingRows && existingRows.length > 0) {
    log("connect: already connected", { chat: ctx.chatId, org: existingRows[0].org_id });
    await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: MSG.already });
    return;
  }

  // Validate as three distinct outcomes: invalid / used / expired.
  const { data: row, error: lookupErr } = await db
    .from("telegram_link_codes")
    .select("id, org_id, user_id, expires_at, used")
    .eq("link_code", code)
    .maybeSingle();
  if (lookupErr) console.error("[telegram-bot] code lookup error:", lookupErr);
  log("connect: code lookup", { chat: ctx.chatId, found: !!row });

  if (!row) {
    await recordFail(db, ctx.chatId);
    log("connect: INVALID code", { chat: ctx.chatId });
    await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: MSG.invalid });
    return;
  }
  if (row.used) {
    await recordFail(db, ctx.chatId);
    log("connect: USED code", { chat: ctx.chatId, code_id: row.id });
    await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: MSG.used });
    return;
  }
  if (new Date(row.expires_at) < new Date()) {
    await recordFail(db, ctx.chatId);
    log("connect: EXPIRED code", { chat: ctx.chatId, code_id: row.id, expires_at: row.expires_at });
    await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: MSG.expired });
    return;
  }
  log("connect: validation ok", { chat: ctx.chatId, org: row.org_id, code_id: row.id });

  // Consume atomically — first caller flips used=false→true (replay guard).
  const { data: consumed } = await db
    .from("telegram_link_codes")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("used", false)
    .select("id")
    .maybeSingle();
  if (!consumed) {
    await recordFail(db, ctx.chatId);
    await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: MSG.used });
    return;
  }

  // Link the chat to the org. Realtime UPDATE/INSERT here flips the desktop UI
  // to "Connected" with no refresh. Spec fields persisted (mapped to columns):
  //   telegram_chat_id → chat_id · telegram_user_id → telegram_user_id
  //   telegram_username → tg_username · connected_at → connected_at
  //   user_id → linked_by · first_name → chat_name
  const { error: upErr } = await db.from("telegram_connections").upsert({
    org_id: row.org_id,
    chat_id: ctx.chatId,
    telegram_user_id: ctx.tgUserId,
    chat_name: ctx.firstName || ctx.chatName,
    tg_username: ctx.tgUsername,
    linked_by: row.user_id,
    connected: true,
    connected_at: new Date().toISOString(),
    connect_token: null,
    token_expires_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "org_id" });
  if (upErr) {
    console.error("[telegram-bot] telegram_connections upsert failed:", upErr);
    log("connect: db update FAILED", { chat: ctx.chatId, org: row.org_id });
    await tg("sendMessage", { chat_id: ctx.chatId, text: MSG.saveErr });
    return;
  }
  log("connect: db update ok — chat linked", { chat: ctx.chatId, org: row.org_id });

  // Clear this chat's failed-attempt history now that it succeeded.
  await db.from("telegram_connect_attempts").delete().eq("chat_id", ctx.chatId);

  // Resolve the org name for the success reply (spec §5). Never fatal — if the
  // name can't be read, the connection still stands and we show a neutral label.
  let orgName = "your organization";
  const { data: org } = await db
    .from("organizations").select("name").eq("id", row.org_id).maybeSingle();
  if (org?.name) orgName = org.name;

  log("connect: SUCCESS", { chat: ctx.chatId, org: row.org_id });
  await tg("sendMessage", { chat_id: ctx.chatId, parse_mode: "HTML", text: successMsg(orgName) });
}

Deno.serve(async (req) => {
 try {
  if (req.method !== "POST") return json({ ok: true });

  // Only Telegram (which knows the secret set in setWebhook) may call this.
  //
  // FAIL CLOSED. This was `if (secret && ...)`: with TELEGRAM_WEBHOOK_SECRET
  // unset, the check was skipped entirely — and verify_jwt is off for this
  // function (config.toml), so that left a public, unauthenticated endpoint
  // that accepts a forged Telegram update. Every identity downstream (chat_id,
  // telegram_user_id, username) is read straight out of that body, so a forged
  // update means attacker-chosen identity: connection-code guessing with a
  // fresh chat_id per attempt (which resets telegram_connect_attempts, the
  // only brute-force guard codes have), and /disconnect against a live chat.
  // An unset secret is a deployment error, not a reason to trust the caller.
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  if (!secret) {
    console.error("[telegram-bot] TELEGRAM_WEBHOOK_SECRET is not set — refusing every webhook call");
    return json({ ok: true }); // 200 so Telegram doesn't retry-storm
  }
  // Constant-time: this endpoint is unauthenticated and probeable without limit.
  if (!safeEqual(req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "", secret)) {
    return json({ ok: true }); // silently ignore
  }

  const update = await req.json().catch(() => null) as any;
  const msg = update?.message ?? update?.edited_message;
  const chatId = String(msg?.chat?.id ?? "");
  const chatName = msg?.chat?.first_name ?? msg?.chat?.title ?? msg?.from?.first_name ?? "";
  const text: string = (msg?.text ?? "").trim();
  if (!chatId || chatId === "" || !text) return json({ ok: true });

  const db = adminClient();
  const cmd = text.split(/\s+/)[0].replace(/@.*$/, "").toLowerCase();
  const isCommand = text.startsWith("/");
  const tgUsername: string = msg?.from?.username ?? msg?.chat?.username ?? "";
  const firstName: string = msg?.from?.first_name ?? msg?.chat?.first_name ?? "";
  const tgUserId: string = String(msg?.from?.id ?? "");

  const ctx = { chatId, firstName, chatName, tgUsername, tgUserId };

  // Spec §12: log every incoming update (never the full text — just a short,
  // non-sensitive shape) so the flow is traceable end to end.
  log("incoming update", {
    chat: chatId, user: tgUserId, cmd: isCommand ? cmd : "(text)", len: text.length,
  });

  // ── /start ────────────────────────────────────────────────────────────────
  //   /start <CODE>  — validate the connection code and link the chat.
  //   /start         — bare (Start button / opening the bot): prompt for the
  //                    code and wait. NEVER auto-connect, NEVER show the help
  //                    menu before the chat is linked.
  if (cmd === "/start") {
    // Parse the start parameter (everything after "/start" or "/start@bot").
    const startArg = text.replace(/^\/start(@\w+)?/i, "").trim();
    log("/start parsed", { chat: chatId, hasParam: !!startArg });
    if (startArg) {
      await connectWithCode(db, startArg, ctx);
      return json({ ok: true });
    }
    // Bare /start — ask for the code (spec §2). The next message carrying a
    // code is handled by the code-extraction path below and auto-linked; no
    // manual Settings action is ever required.
    await tg("sendMessage", {
      chat_id: chatId, parse_mode: "HTML",
      text: [
        MSG.needCode,
        "",
        "Open <b>CamAI Desktop → Alerts</b>, tap <b>Connect Telegram</b>, then either tap the link it shows or paste the 8-character code here.",
      ].join("\n"),
    });
    return json({ ok: true });
  }

  // Is this chat already linked? Needed to decide whether a bare message should
  // be tried as a connection code, to re-prompt unlinked chats, and to gate the
  // slash-commands below.
  const { data: conn } = await db
    .from("telegram_connections")
    .select("org_id, connected")
    .eq("chat_id", chatId)
    .eq("connected", true)
    .maybeSingle();

  // ── Connection code typed without /start ── same connect path ─────────────
  // Forgiving (spec §2 "if the next message is a valid code, process it"): after
  // the bare-/start prompt the user typically pastes just the code, but we also
  // pull a code token out of a short sentence ("my code is ABCD2345"). Only for
  // UNconnected chats, so a connected user's ordinary words are never mistaken
  // for a code. Commands start with "/" so they can never match here.
  if (!isCommand && !conn) {
    const upper = text.trim().toUpperCase();
    // The code alphabet excludes 0/O/1/I; accept a standalone 6–8 char token
    // anywhere in a short message.
    const codeMatch = upper.match(/(^|[^A-Z0-9])([A-Z2-9]{6,8})($|[^A-Z0-9])/);
    const candidate = /^[A-Z0-9]{6,8}$/.test(upper) ? upper : (codeMatch?.[2] ?? "");
    if (candidate) {
      log("bare code detected", { chat: chatId });
      await connectWithCode(db, candidate, ctx);
      return json({ ok: true });
    }
  }

  // ── Non-command plain text that was NOT a valid code ──────────────────────
  // An UNconnected chat only ever needs the connect instructions — never the
  // help menu (spec: don't reveal commands until connected). A connected chat
  // gets the command list.
  if (!isCommand) {
    await tg("sendMessage", {
      chat_id: chatId, parse_mode: "HTML",
      text: conn
        ? HELP
        : [
            "To connect, open <b>CamAI Desktop</b>, generate a <b>Connection Code</b>, then send:",
            "<code>/start YOUR_CODE</code>",
          ].join("\n"),
    });
    return json({ ok: true });
  }

  // ── Slash commands — require a connected chat (no help menu before that) ──
  if (!conn) {
    await tg("sendMessage", {
      chat_id: chatId, parse_mode: "HTML",
      text: "This chat isn't connected yet.\n\nOpen <b>CamAI Desktop</b>, generate a <b>Connection Code</b>, then send <code>/start YOUR_CODE</code> here to connect.",
    });
    return json({ ok: true });
  }

  const orgIds = [conn.org_id];

  try {
    if (cmd === "/help") {
      await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: HELP });

    } else if (cmd === "/auto") {
      // Alerts already push automatically to every linked chat (the alerts
      // AFTER INSERT trigger → notify-telegram), so there is no manual mode to
      // toggle — /auto confirms real-time delivery is on AND sends the latest
      // camera snapshot. NOTE: this bot runs in Supabase (cloud) and has no LAN
      // path to the cameras, so it can only send a snapshot the desktop already
      // uploaded to the `snapshots` bucket (never a live/continuous feed).
      const confirmText = [
        "🟢 <b>Auto Mode Enabled</b>",
        "",
        "All AI alerts are delivered here automatically in real time. No commands needed.",
      ].join("\n");

      // Most recent alert that actually carries an uploaded snapshot.
      const { data: snap } = await db.from("alerts")
        .select("kind, detail, snapshot_path, created_at, cameras(name)")
        .in("org_id", orgIds)
        .not("snapshot_path", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let photoSent = false;
      // snapshot_path is a `snapshots` bucket object; a "/"-prefixed value is a
      // stale local path that was never uploaded — skip those.
      if (snap?.snapshot_path && !String(snap.snapshot_path).startsWith("/")) {
        const { data: signed } = await db.storage
          .from("snapshots").createSignedUrl(snap.snapshot_path, 3600);
        if (signed?.signedUrl) {
          const det = ((snap.detail as any)?.detection_name as string) || snap.kind;
          const cam = (snap as any).cameras?.name ?? "—";
          const caption = [
            confirmText,
            "",
            `📷 <b>Latest snapshot</b> — ${esc(humanize(det))}`,
            `${esc(cam)} · ${ago(snap.created_at)}`,
          ].join("\n");
          const r = await tg("sendPhoto", {
            chat_id: chatId, photo: signed.signedUrl,
            caption: caption.slice(0, 1024), parse_mode: "HTML",
          });
          photoSent = !!(r as any)?.ok;
        }
      }
      // No uploaded snapshot (or the send failed) → still confirm as text so the
      // command is never silent.
      if (!photoSent) {
        await tg("sendMessage", {
          chat_id: chatId, parse_mode: "HTML",
          text: snap ? confirmText : `${confirmText}\n\n<i>No camera snapshot available yet — one will appear here with the next alert.</i>`,
        });
      }

    } else if (cmd === "/disconnect") {
      await db.from("telegram_connections").update({
        chat_id: null,
        chat_name: null,
        connected: false,
        connected_at: null,
        updated_at: new Date().toISOString(),
      }).eq("org_id", conn.org_id);
      await tg("sendMessage", {
        chat_id: chatId,
        text: "✅ Disconnected. You will no longer receive CamAI alerts here. Generate a new Connection Code in CamAI Desktop and send /start YOUR_CODE to reconnect.",
      });

    } else if (cmd === "/status") {
      const { data: cams } = await db.from("cameras")
        .select("status").in("org_id", orgIds).is("deleted_at", null);
      const total = cams?.length ?? 0;
      const online = (cams ?? []).filter((c) => c.status === "online").length;
      const offline = (cams ?? []).filter((c) => c.status === "offline").length;
      await tg("sendMessage", {
        chat_id: chatId, parse_mode: "HTML",
        text: `📷 <b>Camera Status</b>\n\n🟢 Online: <b>${online}</b>\n🔴 Offline: <b>${offline}</b>\n⚪ Other: <b>${total - online - offline}</b>\n📊 Total: <b>${total}</b>`,
      });

    } else if (cmd === "/cameras") {
      const { data: cams } = await db.from("cameras")
        .select("name, status").in("org_id", orgIds).is("deleted_at", null)
        .order("name").limit(40);
      const dot = (s: string) => s === "online" ? "🟢" : s === "offline" ? "🔴" : "⚪";
      const lines = (cams ?? []).map((c) => `${dot(c.status)} ${esc(c.name)} — <i>${esc(c.status ?? "unknown")}</i>`);
      await tg("sendMessage", {
        chat_id: chatId, parse_mode: "HTML",
        text: lines.length ? `📷 <b>Cameras (${lines.length})</b>\n\n${lines.join("\n")}` : "No cameras found.",
      });

    } else if (cmd === "/alerts" || cmd === "/critical") {
      let q = db.from("alerts")
        .select("title, kind, severity, detail, created_at, cameras(name)")
        .in("org_id", orgIds).order("created_at", { ascending: false }).limit(6);
      if (cmd === "/critical") q = q.eq("severity", "critical");
      const { data: alerts } = await q;
      if (!alerts?.length) {
        await tg("sendMessage", { chat_id: chatId, text: cmd === "/critical" ? "No critical alerts. ✅" : "No alerts yet." });
      } else {
        const lines = alerts.map((a: any) => {
          const det = (a.detail?.detection_name as string) || a.kind;
          const cam = a.cameras?.name ?? "—";
          return `${SEV[a.severity] ?? "🔔"} <b>${esc(humanize(det))}</b> — ${esc(a.title)}\n   📷 ${esc(cam)} · ${ago(a.created_at)}`;
        });
        await tg("sendMessage", {
          chat_id: chatId, parse_mode: "HTML",
          text: `${cmd === "/critical" ? "🔴 <b>Critical Alerts</b>" : "🔔 <b>Recent Alerts</b>"}\n\n${lines.join("\n\n")}`,
        });
      }

    } else if (cmd === "/health") {
      const { data: h } = await db.from("camera_health")
        .select("is_online, fps, recording, checked_at").in("org_id", orgIds);
      const rows = h ?? [];
      const online = rows.filter((r) => r.is_online).length;
      const recording = rows.filter((r) => r.recording).length;
      const fpsVals = rows.map((r) => Number(r.fps)).filter((n) => Number.isFinite(n) && n > 0);
      const avgFps = fpsVals.length ? (fpsVals.reduce((a, b) => a + b, 0) / fpsVals.length).toFixed(1) : "—";
      const last = rows.map((r) => r.checked_at).filter(Boolean).sort().slice(-1)[0];
      await tg("sendMessage", {
        chat_id: chatId, parse_mode: "HTML",
        text: `🩺 <b>System Health</b>\n\n🟢 Online: <b>${online}/${rows.length}</b>\n🎥 Recording: <b>${recording}</b>\n⚡ Avg FPS: <b>${avgFps}</b>\n🕒 Last report: <b>${last ? ago(last) : "—"}</b>`,
      });

    } else if (cmd.startsWith("/")) {
      await tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `Unknown command.\n\n${HELP}` });
    }
  } catch (e) {
    await tg("sendMessage", { chat_id: chatId, text: "Sorry — something went wrong handling that command." });
    console.error("telegram-bot error", e);
  }

  return json({ ok: true });
 } catch (e) {
  // Any unexpected failure (bad JSON, Telegram API down, etc.): log it, but
  // STILL return 200 so Telegram does not retry-storm the webhook.
  console.error("[telegram-bot] unhandled webhook error:", e);
  return json({ ok: true });
 }
});
