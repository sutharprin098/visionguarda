// POST /functions/v1/telegram-test  { bot_token?, chat_id? }
// The "Test Connection" button on Settings > Telegram. Sends a one-off
// confirmation message so an admin can verify their bot token + chat id
// before relying on live alerts. verify_jwt is on (config.toml): the caller
// is a signed-in admin, and we require org.manage in their own org — the
// same gate that guards the telegram_settings row itself.
//
// If bot_token/chat_id are omitted, the currently-saved settings are tested,
// so "Test" works both while editing and after saving.
import { adminClient, userClient, json, corsHeaders } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const caller = userClient(req);
  const { data: auth } = await caller.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // The caller's own profile gives their org; org.manage authorises the test.
  // Both come from the RLS-scoped client, so a member can only ever test their
  // own org's Telegram destination.
  const { data: profile } = await caller
    .from("profiles").select("org_id").eq("id", auth.user.id).maybeSingle();
  if (!profile?.org_id) return json({ error: "no organization" }, 403);

  // Authorise with the same app.has_perm() the RLS policies use, called in the
  // caller's own JWT context (the app schema is exposed to PostgREST — see
  // config.toml — and util.rateLimit calls app RPCs the same way).
  const { data: allowed } = await caller.schema("app").rpc("has_perm", { perm: "org.manage" });
  if (allowed !== true) return json({ error: "forbidden — org.manage required" }, 403);

  const body = await req.json().catch(() => ({})) as { bot_token?: string; chat_id?: string };

  // Prefer explicitly-provided creds (admin is mid-edit); otherwise fall back
  // to the saved row. Read the saved row with the service client so an unsaved
  // token still works and a saved one is found regardless of RLS timing.
  const db = adminClient();
  let botToken = (body.bot_token ?? "").trim();
  let chatId = (body.chat_id ?? "").trim();
  if (!botToken || !chatId) {
    const { data: saved } = await db
      .from("telegram_settings").select("bot_token, chat_id").eq("org_id", profile.org_id).maybeSingle();
    botToken = botToken || (saved?.bot_token ?? "");
    chatId = chatId || (saved?.chat_id ?? "");
  }
  if (!botToken || !chatId) {
    return json({ error: "bot token and chat id are required" }, 400);
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "✅ <b>CamAI connected</b>\nTelegram notifications are working. Live alerts from your active detection models will arrive here automatically.",
        parse_mode: "HTML",
      }),
    });
    const tgBody = await res.json().catch(() => ({}));
    if (!res.ok || tgBody?.ok === false) {
      return json({ error: tgBody?.description ?? `Telegram returned ${res.status}` }, 400);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: `request failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
