// POST /functions/v1/send-email
// Called only by app.dispatch_pending_emails() via pg_net (never by a
// browser) — verify_jwt is off (see config.toml) because the caller is
// Postgres, not a user, so we check the service-role bearer token by hand
// instead. Sends through the calling org's SMTP relay (host/port/username
// come from the request body — org_settings.smtp — the password is this
// deployment's single CAMAI_SMTP_PASSWORD secret, never stored in the DB).
import { json, corsHeaders, safeEqual, isPrivateHost, resolvesToPrivate } from "../_shared/util.ts";
import nodemailer from "npm:nodemailer@6";

// Hosts this deployment is willing to hand CAMAI_SMTP_PASSWORD to.
//
// `smtp.host` arrives in the request body, sourced from an org's own
// organization_settings.smtp row (writable by any holder of org.manage in that
// org) — but the PASSWORD sent with it is not the org's, it is this
// deployment's single shared CAMAI_SMTP_PASSWORD secret. Unfiltered, that is a
// credential-exfiltration primitive: point smtp.host at a host you control,
// wait for the next queued email, and collect the deployment's SMTP password
// off your own AUTH LOGIN. The same field also aimed a TCP connection from
// inside the edge runtime at any host:port (SSRF).
//
// CAMAI_SMTP_ALLOWED_HOSTS (comma-separated) is the allowlist; CAMAI_SMTP_HOST
// is honoured as a single-value shorthand. When neither is configured the
// behaviour is unchanged except that private/loopback/link-local destinations
// are refused — so nothing breaks on an existing deployment, and setting one
// env var closes the exfiltration path completely.
function allowedSmtpHosts(): string[] {
  const raw = Deno.env.get("CAMAI_SMTP_ALLOWED_HOSTS") ?? Deno.env.get("CAMAI_SMTP_HOST") ?? "";
  return raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Constant-time: verify_jwt is off, so this is the only gate on the endpoint.
  if (!serviceKey || !safeEqual(auth, `Bearer ${serviceKey}`)) {
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

  // Destination guard — see allowedSmtpHosts() for why this matters.
  const host = String(smtp.host).trim().toLowerCase();
  const allowlist = allowedSmtpHosts();
  if (allowlist.length && !allowlist.includes(host)) {
    console.error(`[send-email] refused relay host not in CAMAI_SMTP_ALLOWED_HOSTS: ${host}`);
    return json({ error: "smtp host is not permitted by this deployment" }, 400);
  }
  if (isPrivateHost(host) || await resolvesToPrivate(host)) {
    console.error(`[send-email] refused private/loopback relay host: ${host}`);
    return json({ error: "smtp host is not permitted by this deployment" }, 400);
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
