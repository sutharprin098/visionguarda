import { app, BrowserWindow, ipcMain, session, desktopCapturer, powerMonitor } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { computeFingerprint } from "./fingerprint";
import { saveCredentials, loadCredentials, clearCredentials } from "./secureStore";
import {
  startEngine, stopEngine, restartEngine, shutdownEngine,
  getStatus as getEngineStatus, getLogs as getEngineLogs,
  setEnginePath, getEnginePath,
} from "./engineSupervisor";
import { setupDownloadHandlers } from "./downloadManager";

const SUPABASE_URL = process.env.CAMAI_SUPABASE_URL ?? "https://kuqyhceykvisqfyghiot.supabase.co";
const ANON_KEY = process.env.CAMAI_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI";

// The source id the renderer picked, read by setDisplayMediaRequestHandler on
// the very next getDisplayMedia call. Null means "no pick" — the handler then
// refuses rather than defaulting to the entire screen.
let pendingCaptureSourceId: string | null = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  if (process.env.CAMAI_REMOTE_DEBUG) app.commandLine.appendSwitch("remote-debugging-port", process.env.CAMAI_REMOTE_DEBUG);

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
        webSecurity: false,
      },
    });
    win.webContents.on("console-message", (event, level, message, line, sourceId) => {
      console.log(`[Renderer Console] ${message}`);
    });
    if (process.env.VITE_DEV_SERVER_URL) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      win.loadFile(join(__dirname, "../dist/index.html"));
    }
    if (process.env.CAMAI_OPEN_DEVTOOLS) win.webContents.openDevTools({ mode: "bottom" });
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

  setupDownloadHandlers(ipcMain, () => win);

  // ---------- IPC: selective screen capture ----------
  //
  // Only 'screen' and 'window' exist — Electron 31's own typings say
  // "available types can be `screen` and `window`". Browser tabs are NOT
  // enumerable: a Chrome tab is not an OS window (Chrome renders every tab into
  // one window), and only Chrome itself can isolate a tab, for a page running
  // inside Chrome that calls getDisplayMedia. Sharing "Chrome — WhatsApp Web"
  // therefore shares the Chrome *window*, and follows whatever tab is active.
  ipcMain.handle("get-capture-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources
      // Electron's own window is in the list; sharing the app into itself is a
      // hall-of-mirrors and never what anyone means.
      .filter((s) => !s.name.includes("CamAI Desktop"))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: s.thumbnail?.isEmpty() ? null : s.thumbnail.toDataURL(),
        appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      }));
  });

  // Set immediately before the renderer calls getDisplayMedia; consumed by the
  // display-media handler above.
  ipcMain.handle("set-capture-source", (_evt, sourceId: string | null) => {
    pendingCaptureSourceId = sourceId;
    return { ok: true };
  });

  // "Is the thing we're sharing still on screen?" — the renderer polls this so
  // a closed window surfaces as a message rather than a frozen last frame.
  ipcMain.handle("capture-source-exists", async (_evt, sourceId: string) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
      return { exists: sources.some((s) => s.id === sourceId) };
    } catch {
      // Don't report a transient enumeration failure as "source gone" — that
      // would tear down a perfectly good share.
      return { exists: true };
    }
  });

  ipcMain.handle("get-config", () => {
    const isAdmin = app.getName().includes("Admin Studio") || process.env.CAMAI_APP_TYPE === "admin";
    return {
      supabaseUrl: SUPABASE_URL,
      anonKey: ANON_KEY,
      appType: isAdmin ? "admin" : "desktop",
      isPackaged: app.isPackaged
    };
  });

  // ---------- IPC: Local AI Engine supervisor ----------

  ipcMain.handle("engine-start", () => { startEngine(() => win); return { ok: true }; });
  ipcMain.handle("engine-stop", () => { stopEngine(); return { ok: true }; });
  ipcMain.handle("engine-restart", () => { restartEngine(); return { ok: true }; });
  ipcMain.handle("engine-get-status", () => getEngineStatus());
  ipcMain.handle("engine-get-logs", () => getEngineLogs());
  ipcMain.handle("engine-get-path", () => getEnginePath());
  ipcMain.handle("engine-set-path", (_evt, { pythonPath, engineDir }: { pythonPath: string; engineDir: string }) =>
    setEnginePath(pythonPath, engineDir));

  app.whenReady().then(() => {
    createWindow();

    // Hands getDisplayMedia the source the operator actually picked.
    //
    // This used to be `callback({ video: sources[0] })` — getSources() returns
    // screens first, so every share was silently "Entire Screen" no matter what
    // the operator wanted, and there was no way to share a single window.
    //
    // pendingCaptureSourceId is set over IPC immediately before the renderer
    // calls getDisplayMedia (see "set-capture-source"). The id is re-resolved
    // against a fresh getSources() here rather than trusted: window ids are
    // ephemeral and the window may have closed between the picker and the
    // request, in which case callback({video: undefined}) rejects the promise
    // and the renderer reports it as "no longer available" instead of silently
    // grabbing the wrong surface.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const wanted = pendingCaptureSourceId;
        if (!wanted) {
          // No explicit pick — refuse rather than fall back to the whole screen.
          callback({ video: undefined });
          return;
        }
        const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
        const match = sources.find((s) => s.id === wanted);
        callback(match ? { video: match } : { video: undefined });
      } catch (err) {
        console.error("[capture] getSources failed:", err);
        callback({ video: undefined });
      }
    });

    // Webcam sharing (getUserMedia) would otherwise sit on Chromium's default
    // permission prompt, which this frameless kiosk-style window never shows —
    // silently denying the request instead. Screen capture already bypasses
    // the picker above; auto-granting camera/mic here keeps behavior
    // consistent and lets the auto-reconnect logic in mediaShare.ts silently
    // re-acquire a webcam stream after e.g. a sleep/resume cycle without
    // getting stuck on a permission dialog nobody can see.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media" || (permission as string) === "display-capture");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      permission === "media" || (permission as string) === "display-capture");

    // Forward OS power-state transitions to the renderer so its stream
    // managers know to actively re-check/re-acquire media on resume rather
    // than waiting for the next heartbeat timeout to notice.
    powerMonitor.on("suspend", () => win?.webContents.send("power-event", "suspend"));
    powerMonitor.on("resume", () => win?.webContents.send("power-event", "resume"));
    powerMonitor.on("lock-screen", () => win?.webContents.send("power-event", "lock-screen"));
    powerMonitor.on("unlock-screen", () => win?.webContents.send("power-event", "unlock-screen"));

    // Local AI engine: launch on app start, keep it alive for the life of
    // the app (see engineSupervisor.ts for restart/crash-loop handling).
    startEngine(() => win);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => shutdownEngine());
}
