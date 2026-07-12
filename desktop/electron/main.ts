import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { computeFingerprint } from "./fingerprint";
import { saveCredentials, loadCredentials, clearCredentials } from "./secureStore";

const SUPABASE_URL = process.env.CAMAI_SUPABASE_URL ?? "https://mxymrxzhsogfkvkhtwjl.supabase.co";
const ANON_KEY = process.env.CAMAI_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eW1yeHpoc29nZmt2a2h0d2psIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNDYyMDMsImV4cCI6MjA4NjgyMjIwM30.jKzz84M7YI67J_Vxunw3et2usNmXF9SBx7Rb6DyeQrY";

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0b0d10",
    autoHideMenuBar: true,
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

ipcMain.handle("get-config", () => ({ supabaseUrl: SUPABASE_URL, anonKey: ANON_KEY }));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
