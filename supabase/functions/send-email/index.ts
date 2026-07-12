// POST /functions/v1/send-email
// Called only by app.dispatch_pending_emails() via pg_net (never by a
// browser) — verify_jwt is off (see config.toml) because the caller is
// Postgres, not a user, so we check the service-role bearer token by hand
// instead. Sends through the calling org's SMTP relay (host/port/username
// come from the request body — org_settings.smtp — the password is this
// deployment's single CAMAI_SMTP_PASSWORD secret, never stored in the DB).
import { json, corsHeaders } from "../_shared/util.ts";
import nodemailer from "npm:nodemailer@6";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
    return json({ error: "forbidden — service role only" }, 403);
  }

  const password = Deno.env.get("CAMAI_SMTP_PASSWORD");
  if (!password) return json({ error: "CAMAI_SMTP_PASSWORD is not configured" }, 500);

  let body: { to?: string; subject?: string; text?: string; smtp?: { host?: string; port?: number; username?: string; from?: string } };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { to, subject, text, smtp } = body;
  if (!to || !subject || !smtp?.host || !smtp?.username) {
    return json({ error: "to, subject, and smtp.{host,username} are required" }, 400);
  }

  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port ?? 587,
      secure: (smtp.port ?? 587) === 465,
      auth: { user: smtp.username, pass: password },
    });
    await transport.sendMail({
      from: smtp.from || smtp.username,
      to,
      subject: `CamAI — ${subject}`,
      text: text ?? "",
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: `smtp send failed: ${e instanceof Error ? e.message : String(e)}` }, 502);
  }
});
