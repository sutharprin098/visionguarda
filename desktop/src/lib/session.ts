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

/** Auto-login from encrypted vault. Returns false if activation is required. */
export async function restoreSession(): Promise<boolean> {
  const stored = await window.camai.getStoredSession();
  if (!stored.ok || !stored.refresh_token) return false;
  const sb = await getSupabase();
  const { data, error } = await sb.auth.refreshSession({ refresh_token: stored.refresh_token });
  return !error && !!data.session;
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
