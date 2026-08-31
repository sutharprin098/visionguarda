import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CachedSession } from "./bridge";

/**
 * Storage adapter that puts supabase-js's session in the DPAPI vault instead of
 * localStorage.
 *
 * Two things fall out of this, and the second is the whole point of the file:
 *
 *  - The refresh token never touches disk in plaintext. supabase-js's default
 *    storage is localStorage, which in Electron is a plain LevelDB in the user
 *    profile — persisting there would have quietly undone the reason the vault
 *    exists.
 *  - Startup stops costing a network round trip. With persistSession on, the
 *    auth client recovers the stored session during initialize() and, if the
 *    access token has real life left in it, signs in LOCALLY — no call to the
 *    auth server at all. That is the "under 100ms when cached" path: a DPAPI
 *    decrypt and a clock comparison.
 *
 * The adapter ignores the key: there is exactly one session per install, and
 * the vault is keyed by file.
 */
const vaultStorage = {
  async getItem(_key: string): Promise<string | null> {
    const session = await window.camai.sessionStore.get();
    return session ? JSON.stringify(session) : null;
  },
  async setItem(_key: string, value: string): Promise<void> {
    try {
      await window.camai.sessionStore.set(JSON.parse(value) as CachedSession);
    } catch {
      /* a failed cache write costs a slow next launch, never a broken one */
    }
  },
  async removeItem(_key: string): Promise<void> {
    await window.camai.sessionStore.remove();
  },
};

let client: SupabaseClient | null = null;

/**
 * The shared client.
 *
 * Still async so every existing `await getSupabase()` call site keeps working,
 * but it no longer awaits anything: the config now arrives synchronously from
 * preload rather than over IPC, so this resolves in the same tick.
 */
export async function getSupabase(): Promise<SupabaseClient> {
  return getSupabaseSync();
}

/** Synchronous accessor, for the startup path where an extra microtask on the
 *  critical path is worth avoiding. */
export function getSupabaseSync(): SupabaseClient {
  if (client) return client;
  const cfg = window.camai.config;
  client = createClient(cfg.supabaseUrl, cfg.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      storage: vaultStorage,
      storageKey: "camai.session",
      // Nothing here ever arrives via a URL fragment, and the check costs a
      // parse of window.location on every client construction.
      detectSessionInUrl: false,
    },
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

/**
 * Auto-login from the encrypted vault. Never demands the key on a mere network
 * blip — only when there are no credentials or the token is truly invalid.
 *
 * The ordering here is what makes startup fast, and it is not accidental:
 *
 *   1. Ask the main process for the session it prefetched at app start. It
 *      began that work while this window was still being created, so the answer
 *      is normally already sitting there — and when the vault's token was still
 *      valid, it involved no network at all.
 *   2. ONLY THEN construct the supabase client. By this point the vault is
 *      known to hold a fresh session, so the auth client's own recovery pass
 *      finds it valid and signs in locally instead of firing its own refresh.
 *
 * Building the client first would have inverted that: it would have raced the
 * prefetch and issued a second, redundant refresh of its own.
 */
export async function restoreSession(force = false): Promise<RestoreResult> {
  // `force` matters on the retry path: the prefetch is memoised in the main
  // process, so a caller backing off after a "retry" would otherwise be handed
  // the same stale failure forever instead of a fresh attempt.
  const warm = await window.camai.getWarmSession(force);
  if (!warm.ok) return warm.reason;

  const sb = getSupabaseSync();
  try {
    const { data, error } = await sb.auth.getSession();
    if (!error && data.session) return "ready";
    // The vault said we had a live session and the client disagreed — treat it
    // as transient rather than wiping a license the user would have to re-enter.
    return "retry";
  } catch {
    return "retry";
  }
}

/** First-run activation with a license key. */
export async function activateWithKey(key: string): Promise<string | null> {
  const res = await window.camai.activate(key);
  if (!res.ok) return res.error ?? "activation failed";
  const sb = getSupabaseSync();
  const { error } = await sb.auth.setSession({
    access_token: res.access_token!,
    refresh_token: res.refresh_token!,
  });
  return error ? error.message : null;
}
