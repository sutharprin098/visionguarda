import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { computeFingerprint } from "./fingerprint";
import { saveCredentials, loadCredentials, clearCredentials } from "./secureStore";

const SUPABASE_URL = process.env.CAMAI_SUPABASE_URL ?? "https://kuqyhceykvisqfyghiot.supabase.co";
const ANON_KEY = process.env.CAMAI_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI";

let win: BrowserWindow | null = null;

function createWindow() {
  const iconPath = join(__dirname, "../build/icon.ico");
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, "../dist/index.html"));
  }
}

// ---------- IPC: activation & session ----------

// First run: license key -> fingerprint -> activate-license edge function.
// Returns session tokens; refresh token is stored DPAPI-encrypted so the
// license key is never asked for again.
ipcMain.handle("activate", async (_evt, licenseKey: string) => {
  // Network/fingerprint failures are routine on first run (offline machine,
  // systeminformation hiccup) — catch them so the renderer always gets an
  // {ok:false, error} it can show, instead of a rejected invoke() that would
  // leave the Activation screen stuck on "Activating…" forever.
  try {
    const fp = await computeFingerprint();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/activate-license`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY },
      body: JSON.stringify({
        license_key: licenseKey.trim().toUpperCase(),
        fingerprint_hash: fp.hash,
        device_name: fp.deviceName,
        os_info: fp.osInfo,
        hardware: fp.hardware,
        app_version: app.getVersion(),
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      device_id: string;
      access_token: string;
      refresh_token: string;
    };
    if (!res.ok) return { ok: false, error: body.error ?? `activation failed (${res.status})` };

    saveCredentials({
      refresh_token: body.refresh_token,
      device_id: body.device_id,
      supabase_url: SUPABASE_URL,
      anon_key: ANON_KEY,
    });
    return { ok: true, access_token: body.access_token, refresh_token: body.refresh_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "activation failed — check your connection" };
  }
});

// Subsequent runs: auto-login from the encrypted vault. Renderer exchanges the
// refresh token for a fresh session via supabase-js setSession/refreshSession.
ipcMain.handle("get-stored-session", async () => {
  const creds = loadCredentials();
  if (!creds) return { ok: false };
  return { ok: true, refresh_token: creds.refresh_token, device_id: creds.device_id };
});

// Token rotation: renderer reports the newest refresh token after every refresh.
ipcMain.handle("update-refresh-token", async (_evt, refreshToken: string) => {
  const creds = loadCredentials();
  if (creds) saveCredentials({ ...creds, refresh_token: refreshToken });
  return { ok: true };
});

ipcMain.handle("deactivate", async () => {
  clearCredentials();
  return { ok: true };
});

import { setupDownloadHandlers } from "./downloadManager";

ipcMain.handle("get-config", () => {
  const isAdmin = app.getName().includes("Admin Studio") || process.env.CAMAI_APP_TYPE === "admin";
  return {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    appType: isAdmin ? "admin" : "desktop"
  };
});

setupDownloadHandlers(ipcMain, () => win);

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
