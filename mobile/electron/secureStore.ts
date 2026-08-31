// Encrypted credential store. Uses Electron safeStorage, which on Windows is
// backed by DPAPI — ciphertext is only decryptable by this user on this machine.
//
// Three separate blobs live here, deliberately in separate files:
//   credentials.bin — the long-lived refresh token + device identity.
//   session.bin     — the CACHED supabase session (access token + user). This is
//                     what makes a warm launch cost zero network: an unexpired
//                     cached session is handed to supabase-js at init and it
//                     signs in locally. Split from credentials.bin so the
//                     several-times-an-hour token rotation never rewrites the
//                     file the app's identity depends on.
//   bundle.bin      — the last successful desktop-sync bundle, so the workspace
//                     paints from disk instead of waiting on an edge function.
//                     Encrypted, not plain JSON, because the bundle carries
//                     org settings values (e.g. Telegram bot tokens).
//
// Every read is memoised in-process: startup touches these repeatedly and a
// DPAPI round trip per call is pure latency on the critical path.
import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface StoredCredentials {
  refresh_token: string;
  device_id: string;
  supabase_url: string;
  anon_key: string;
}

/** The shape supabase-js persists. Kept opaque on purpose — we store whatever
 *  the auth client hands us and give it back verbatim. */
export interface CachedSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  [k: string]: unknown;
}

function vaultDir(): string {
  const dir = join(app.getPath("userData"), "vault");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function storePath(): string {
  return join(vaultDir(), "credentials.bin");
}

function sessionPath(): string {
  return join(vaultDir(), "session.bin");
}

function bundlePath(): string {
  return join(vaultDir(), "bundle.bin");
}

// ---------------------------------------------------------------------------
// Generic encrypted-JSON helpers.
//
// `undefined` means "not loaded yet", `null` means "loaded, nothing there" —
// the distinction is what lets a miss be cached instead of re-hitting the disk
// on every call.
// ---------------------------------------------------------------------------

function readEncrypted<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(path))) as T;
  } catch {
    return null; // corrupted or copied from another machine
  }
}

function writeEncrypted(path: string, value: unknown): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption unavailable — refusing to store tokens in plaintext");
  }
  writeFileSync(path, safeStorage.encryptString(JSON.stringify(value)));
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

let credsCache: StoredCredentials | null | undefined;

export function saveCredentials(creds: StoredCredentials): void {
  writeEncrypted(storePath(), creds);
  credsCache = creds;
}

export function loadCredentials(): StoredCredentials | null {
  if (credsCache !== undefined) return credsCache;
  credsCache = readEncrypted<StoredCredentials>(storePath());
  return credsCache;
}

export function clearCredentials(): void {
  try {
    rmSync(storePath(), { force: true });
  } catch { /* ignore */ }
  credsCache = null;
  // A deactivation must not leave a usable session or a workspace snapshot
  // behind — both would let the next launch paint a signed-in UI for a device
  // the admin just revoked.
  clearSessionCache();
  clearBundleCache();
}

// ---------------------------------------------------------------------------
// Supabase session cache — the warm-start fast path.
// ---------------------------------------------------------------------------

let sessionCache: CachedSession | null | undefined;

export function loadSessionCache(): CachedSession | null {
  if (sessionCache !== undefined) return sessionCache;
  sessionCache = readEncrypted<CachedSession>(sessionPath());
  return sessionCache;
}

export function saveSessionCache(session: CachedSession | null): void {
  if (session === null) {
    clearSessionCache();
    return;
  }
  try {
    writeEncrypted(sessionPath(), session);
    sessionCache = session;
  } catch {
    // Never let a vault write failure break an otherwise working sign-in; the
    // cost is a slow next launch, not a broken one.
    sessionCache = session;
  }
}

export function clearSessionCache(): void {
  try {
    rmSync(sessionPath(), { force: true });
  } catch { /* ignore */ }
  sessionCache = null;
}

/** True when the cached access token is still good for `marginMs` — i.e. the
 *  renderer can sign in from disk with no network at all.
 *
 *  The default sits deliberately ABOVE auth-js's own EXPIRY_MARGIN_MS (90s).
 *  If we called a session fresh that the auth client considered stale, it would
 *  turn around and refresh over the network anyway, and skipping the prefetch
 *  here would have bought nothing. */
export function cachedSessionIsFresh(marginMs = 150_000): boolean {
  const s = loadSessionCache();
  if (!s?.access_token || typeof s.expires_at !== "number") return false;
  return s.expires_at * 1000 - Date.now() > marginMs;
}

// ---------------------------------------------------------------------------
// Bundle cache — last known workspace state, so the UI never waits on a cold
// edge function to render something correct.
// ---------------------------------------------------------------------------

let bundleCache: unknown | null | undefined;

export function loadBundleCache(): unknown | null {
  if (bundleCache !== undefined) return bundleCache;
  bundleCache = readEncrypted<unknown>(bundlePath());
  return bundleCache;
}

export function saveBundleCache(bundle: unknown): void {
  try {
    writeEncrypted(bundlePath(), bundle);
    bundleCache = bundle;
  } catch {
    bundleCache = bundle;
  }
}

export function clearBundleCache(): void {
  try {
    rmSync(bundlePath(), { force: true });
  } catch { /* ignore */ }
  bundleCache = null;
}
