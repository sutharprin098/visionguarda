import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (client) return client;
  const cfg = await window.camai.getConfig();
  client = createClient(cfg.supabaseUrl, cfg.anonKey, {
    auth: { autoRefreshToken: true, persistSession: false },
  });
  // keep the DPAPI vault holding the newest refresh token (rotation-safe)
  client.auth.onAuthStateChange((_evt, session) => {
    if (session?.refresh_token) window.camai.updateRefreshToken(session.refresh_token);
  });
  return client;
}

/**
 * Outcome of a session restore attempt:
 *  - "ready"    — signed in, go straight to the workspace.
 *  - "no-creds" — nothing stored, OR the stored refresh token was DEFINITIVELY
 *                 rejected (revoked/expired). The license key is genuinely
 *                 required again.
 *  - "retry"    — we DO hold credentials but couldn't reach the auth server
 *                 (offline at launch, DNS not up yet, transient 5xx). The user
 *                 must NOT be dropped to the license prompt for this — the key
 *                 is already saved; we just retry until the network is back.
 */
export type RestoreResult = "ready" | "no-creds" | "retry";

/** Auto-login from the encrypted vault. Never demands the key on a mere network
 *  blip — only when there are no credentials or the token is truly invalid. */
export async function restoreSession(): Promise<RestoreResult> {
  const stored = await window.camai.getStoredSession();
  if (!stored.ok || !stored.refresh_token) return "no-creds";
  const sb = await getSupabase();
  try {
    const { data, error } = await sb.auth.refreshSession({ refresh_token: stored.refresh_token });
    if (!error && data.session) return "ready";
    // A 4xx from the auth server means the refresh token itself is bad
    // (invalid_grant / not found) — re-activation is warranted. Anything else
    // (no status, 5xx) is transient; keep the saved key and retry.
    const status = (error as { status?: number } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) return "no-creds";
    return "retry";
  } catch {
    // fetch threw — offline / DNS / TLS. Definitely transient.
    return "retry";
  }
}

/** First-run activation with a license key. */
export async function activateWithKey(key: string): Promise<string | null> {
  const res = await window.camai.activate(key);
  if (!res.ok) return res.error ?? "activation failed";
  const sb = await getSupabase();
  const { error } = await sb.auth.setSession({
    access_token: res.access_token!,
    refresh_token: res.refresh_token!,
  });
  return error ? error.message : null;
}
