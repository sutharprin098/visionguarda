// POST /functions/v1/telegram-link-code
// Called by the desktop (JWT-authenticated) to mint a one-time Telegram
// connection code. The user types that code to the CamAI bot as
// `/start <CODE>`; the telegram-bot webhook validates it and links their chat.
// No QR, no deep link — the only Telegram link is the plain bot link.
//
// Returns: { ok, code, expires_at, bot_username }
//
// Security:
//   - JWT required (verify_jwt = true in config.toml).
//   - Caller must have org.manage in their own org — the Telegram destination
//     is org-wide, so only admins may (re)link it, matching the desktop gating.
//   - The code is single-use, cryptographically random, and expires in 5 min.
import { userClient, adminClient, json, corsHeaders } from "../_shared/util.ts";

// Unambiguous uppercase alphanumeric charset (no 0/O/1/I) — the code is TYPED
// into Telegram, so confusable characters are removed. 32 symbols ^ 8 ≈ 2^40.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// A cryptographically-secure 8-character connection code, e.g. "ABC123XY".
function connectionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    // 1. Authenticate the desktop user (RLS-scoped client).
    const uc = userClient(req);
    const { data: { user }, error: authErr } = await uc.auth.getUser();
    if (authErr || !user) return json({ error: "unauthenticated" }, 401);

    // 2. Resolve org from the caller's own profile.
    const { data: profile } = await uc
      .from("profiles").select("org_id").eq("id", user.id).maybeSingle();
    if (!profile?.org_id) return json({ error: "no org found for this user" }, 400);

    // 3. Only org admins may link the org-wide Telegram destination.
    const { data: allowed } = await uc.schema("app").rpc("has_perm", { perm: "org.manage" });
    if (allowed !== true) return json({ error: "forbidden — org.manage required" }, 403);

    const db = adminClient();

    // 4a. Housekeeping: delete this user's prior unused codes so "Generate New
    //     Code" cleanly invalidates the previous one, and globally sweep expired
    //     codes so the active-unique index never fills with dead rows.
    await db.from("telegram_link_codes").delete().eq("user_id", user.id).eq("used", false);
    await db.from("telegram_link_codes").delete().lt("expires_at", new Date().toISOString());

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // exactly 5 min

    // 4b. Insert a fresh code, retrying on the (rare) active-index collision.
    let code = "";
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = connectionCode();
      const { error } = await db.from("telegram_link_codes").insert({
        link_code: candidate,
        user_id: user.id,
        org_id: profile.org_id,
        expires_at: expiresAt,
        used: false,
      });
      if (!error) { code = candidate; break; }
      lastErr = error;
    }
    if (!code) {
      console.error("[telegram-link-code] insert failed:", lastErr);
      return json({ error: "could not allocate a connection code — please try again" }, 500);
    }

    const botUsername = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "CamAiAdmin_bot";
    // Telegram deep link: opening it sends "/start <code>" to the bot with a
    // single tap, so the desktop never needs the user to type the command by
    // hand. The bot's /start handler validates the code and links the chat.
    const deepLink = `https://t.me/${botUsername}?start=${code}`;
    console.log(`[telegram-link-code] minted code for user=${user.id} org=${profile.org_id}`);
    return json({ ok: true, code, expires_at: expiresAt, bot_username: botUsername, deep_link: deepLink });
  } catch (e) {
    console.error("[telegram-link-code] error:", e);
    return json({ error: "internal error" }, 500);  // details stay in the function log, not the response
  }
});
