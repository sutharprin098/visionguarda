// Encrypted credential store. Uses Electron safeStorage, which on Windows is
// backed by DPAPI — ciphertext is only decryptable by this user on this machine.
import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface StoredCredentials {
  refresh_token: string;
  device_id: string;
  supabase_url: string;
  anon_key: string;
}

function storePath(): string {
  const dir = join(app.getPath("userData"), "vault");
  mkdirSync(dir, { recursive: true });
  return join(dir, "credentials.bin");
}

export function saveCredentials(creds: StoredCredentials): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption unavailable — refusing to store tokens in plaintext");
  }
  writeFileSync(storePath(), safeStorage.encryptString(JSON.stringify(creds)));
}

export function loadCredentials(): StoredCredentials | null {
  const p = storePath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(p)));
  } catch {
    return null; // corrupted or copied from another machine — force re-activation
  }
}

export function clearCredentials(): void {
  try {
    rmSync(storePath(), { force: true });
  } catch { /* ignore */ }
}
