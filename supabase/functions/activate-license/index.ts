// POST /functions/v1/activate-license
// Desktop-first-run activation: license key + device fingerprint -> session tokens + sync bundle.
// No login screen on the desktop — this is the only credential the user ever types.
import { adminClient, json, corsHeaders, sha256hex, rateLimit } from "../_shared/util.ts";

interface ActivateBody {
  license_key: string;
  fingerprint_hash: string; // sha256 over CPU+board+disk+TPM+MachineGuid+OS, computed on device
  device_name?: string;
  os_info?: Record<string, unknown>;
  hardware?: Record<string, unknown>; // cpu, ram_gb, gpu, disk_gb — admin-portal inventory
  app_version?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`activate:${ip}`, 5, 60_000)) {
    return json({ error: "too many attempts, retry later" }, 429);
  }

  let body: ActivateBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!/^[A-Z]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(body.license_key ?? "")) {
    return json({ error: "invalid license key format" }, 400);
  }
  if (!/^[a-f0-9]{64}$/.test(body.fingerprint_hash ?? "")) {
    return json({ error: "invalid fingerprint" }, 400);
  }

  const db = adminClient();

  // 1. Look up license by hash
  const keyHash = await sha256hex(body.license_key.toUpperCase());
  const { data: lic } = await db
    .from("licenses")
    .select("id, org_id, user_id, status, max_devices, expires_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (!lic) return json({ error: "license not found" }, 404);
  if (lic.status !== "active") return json({ error: `license is ${lic.status}` }, 403);
  if (lic.expires_at && new Date(lic.expires_at) < new Date()) {
    await db.from("licenses").update({ status: "expired" }).eq("id", lic.id);
    return json({ error: "license expired" }, 403);
  }
  if (!lic.user_id) return json({ error: "license not assigned to a user" }, 403);

  // 2. Upsert device (re-activation on same hardware reuses the row)
  const { data: device, error: devErr } = await db
    .from("devices")
    .upsert(
      {
        org_id: lic.org_id,
        user_id: lic.user_id,
        name: body.device_name ?? "Windows PC",
        fingerprint_hash: body.fingerprint_hash,
        os_info: body.os_info ?? {},
        hardware: body.hardware ?? {},
        // status intentionally omitted: new rows default to 'active', while a
        // re-activation keeps the existing status — an admin-deactivated or
        // removed fingerprint stays blocked (checked below) until an admin
        // reactivates it. Including it here would let banned hardware
        // self-reactivate with any valid key.
        is_online: true,
        last_ip: ip === "unknown" ? null : ip.split(",")[0].trim(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "org_id,fingerprint_hash" },
    )
    .select("id, status")
    .single();
  if (devErr || !device) return json({ error: "device registration failed" }, 500);
  if (device.status !== "active") return json({ error: "device is deactivated by admin" }, 403);

  // 3. Enforce max_devices, then bind license <-> device
  const { count } = await db
    .from("license_activations")
    .select("id", { count: "exact", head: true })
    .eq("license_id", lic.id)
    .is("revoked_at", null)
    .neq("device_id", device.id);
  if ((count ?? 0) >= lic.max_devices) {
    return json({ error: "license already active on maximum number of devices" }, 403);
  }
  await db.from("license_activations").upsert(
    { org_id: lic.org_id, license_id: lic.id, device_id: device.id, revoked_at: null },
    { onConflict: "license_id,device_id" },
  );

  // 4. Mint a session for the license owner (magiclink -> verifyOtp, server-side only)
  const { data: prof } = await db
    .from("profiles")
    .select("email, status")
    .eq("id", lic.user_id)
    .single();
  if (!prof || prof.status !== "active") return json({ error: "user account is not active" }, 403);

  const { data: link, error: linkErr } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: prof.email,
  });
  if (linkErr || !link) return json({ error: "session mint failed" }, 500);

  const { data: session, error: otpErr } = await db.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpErr || !session.session) return json({ error: "session exchange failed" }, 500);

  // 5. Record session + audit
  await db.from("desktop_sessions").insert({
    org_id: lic.org_id,
    user_id: lic.user_id,
    device_id: device.id,
    app_version: body.app_version ?? "",
  });
  await db.from("audit_logs").insert({
    org_id: lic.org_id,
    actor_id: lic.user_id,
    actor_email: prof.email,
    action: "device.activate",
    target_type: "device",
    target_id: device.id,
    ip: ip === "unknown" ? null : ip.split(",")[0].trim(),
    device_id: device.id,
    detail: { app_version: body.app_version ?? "" },
  });

  return json({
    device_id: device.id,
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token, // desktop stores this encrypted (DPAPI/safeStorage)
    expires_at: session.session.expires_at,
  });
});
