import { app, BrowserWindow, ipcMain, session, desktopCapturer, powerMonitor, Menu } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { computeFingerprint } from "./fingerprint";
import { saveCredentials, loadCredentials, clearCredentials } from "./secureStore";
import {
  startEngine, stopEngine, restartEngine, shutdownEngine,
  getStatus as getEngineStatus, getLogs as getEngineLogs,
  setEnginePath, getEnginePath, getControlToken,
} from "./engineSupervisor";
import { setupDownloadHandlers } from "./downloadManager";
import { safeSend } from "./safeSend";

// ---------------------------------------------------------------------------
// Last-resort handlers.
//
// Electron's default for an uncaught exception in the main process is to show a
// crash dialog and die. For an unattended CCTV client that is the worst possible
// answer: the operator sees a modal, the engine is orphaned, and the cameras
// stop. Everything reaching here is by definition a bug we did not anticipate,
// so log it loudly and keep running — a degraded client still recording beats a
// dead one.
//
// Registered before app.whenReady() on purpose: a throw during startup is
// exactly when there is no window to report it with.
process.on("uncaughtException", (err) => {
  console.error("[main] UNCAUGHT EXCEPTION:", err?.stack || err);
  safeSend(winRef(), "main-error", { kind: "uncaughtException", message: String(err?.message ?? err) });
});
process.on("unhandledRejection", (reason) => {
  console.error("[main] UNHANDLED REJECTION:", reason);
  safeSend(winRef(), "main-error", { kind: "unhandledRejection", message: String(reason) });
});

const SUPABASE_URL = process.env.CAMAI_SUPABASE_URL ?? "https://kuqyhceykvisqfyghiot.supabase.co";
const ANON_KEY = process.env.CAMAI_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1cXloY2V5a3Zpc3FmeWdoaW90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mzc1MjksImV4cCI6MjA5OTQxMzUyOX0.EvmBR-6sjtUO8UWBm9A0Sv9Ms5GMSs7BDsvw8fVZ8LI";

// The source id the renderer picked, read by setDisplayMediaRequestHandler on
// the very next getDisplayMedia call. Null means "no pick" — the handler then
// refuses rather than defaulting to the entire screen.
let pendingCaptureSourceId: string | null = null;

// `win` lives inside the else-branch below, but the process-level handlers above
// are registered outside it and still need to reach the window. Resolved lazily
// through this rather than hoisting `win`, so there is exactly one place that
// knows how to find it.
let winRef: () => BrowserWindow | null = () => null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // isDestroyed(), not just a null check: after the window closes, `win` is
    // still a live object and isMinimized() throws "Object has been destroyed".
    // This fires when the user relaunches the app while it is quitting —
    // precisely when the window is half-gone.
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  if (process.env.CAMAI_REMOTE_DEBUG) app.commandLine.appendSwitch("remote-debugging-port", process.env.CAMAI_REMOTE_DEBUG);

  let win: BrowserWindow | null = null;
  winRef = () => win;

  // ---- Window fullscreen -------------------------------------------------
  // The renderer's viewer overlay does NOT depend on these: it fills the app
  // window with plain layout, so the camera goes fullscreen-in-app even if the
  // OS-level call is refused. This is the enhancement on top — it takes the
  // window itself fullscreen (hiding the title bar / taskbar) on the display the
  // window currently occupies, which is what makes multi-monitor work: Windows
  // fullscreens onto the monitor the window is on, so dragging to the second
  // screen and going fullscreen fills that one.
  //
  // Deliberately NOT document.requestFullscreen(): that returns a promise that
  // can reject for reasons the page cannot inspect, and the previous
  // implementation swallowed the rejection (.catch(() => {})) — which is exactly
  // why clicking the button looked like it did nothing at all.
  ipcMain.handle("window-set-fullscreen", (_e, value: boolean) => {
    const w = winRef();
    if (!w || w.isDestroyed()) return { ok: false, fullscreen: false };
    w.setFullScreen(!!value);
    console.log(`[main] window fullscreen -> ${w.isFullScreen()}`);
    return { ok: true, fullscreen: w.isFullScreen() };
  });

  ipcMain.handle("window-is-fullscreen", () => {
    const w = winRef();
    return { ok: true, fullscreen: !!w && !w.isDestroyed() && w.isFullScreen() };
  });

  function createWindow() {
    // Drop Electron's stock application menu.
    //
    // It is already invisible (autoHideMenuBar), but its ACCELERATORS stayed
    // live — and its View menu binds F11 to role "togglefullscreen". That
    // swallowed F11 before the renderer's keydown handler ever saw it, and
    // fullscreened the whole BrowserWindow (sidebar, tabs and all) instead of
    // the camera tile the operator was pointing at. Nothing else in the stock
    // menu is reachable in a kiosk-style CCTV client, so the whole thing goes;
    // Chromium still handles clipboard/undo natively without a menu.
    //
    // With this gone, F11 is delivered to the page as an ordinary key event and
    // Workspace's per-tile handler owns it.
    Menu.setApplicationMenu(null);

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

    // The OS can change fullscreen without the renderer asking (the user hits the
    // title-bar control, or Windows exits fullscreen on a display change). Push
    // the truth down so React never renders an exit button for a state the window
    // is no longer in.
    win.on("enter-full-screen", () => {
      console.log("[main] enter-full-screen");
      safeSend(winRef(), "window:fullscreen", true);
    });
    win.on("leave-full-screen", () => {
      console.log("[main] leave-full-screen");
      safeSend(winRef(), "window:fullscreen", false);
    });
    win.on("resize", () => {
      const w = winRef();
      if (!w || w.isDestroyed()) return;
      const [width, height] = w.getSize();
      safeSend(w, "window:resized", { width, height, fullscreen: w.isFullScreen() });
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
  // The engine's configuration endpoints (AI mode above all) require this. Safe
  // to hand the renderer: it is a local capability, and every renderer here is
  // our own page — the check that decides who may CHANGE a mode is RLS in the
  // cloud, which the renderer cannot influence by holding this.
  ipcMain.handle("engine-get-token", () => getControlToken());
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
    //
    // These fire on the OS's schedule, not ours — a laptop lid closing after
    // the window is gone still emits "suspend". `win?.` did not protect against
    // that: a closed BrowserWindow is a live object, so the optional chain
    // passed and .send() threw "Object has been destroyed".
    powerMonitor.on("suspend", () => safeSend(win, "power-event", "suspend"));
    powerMonitor.on("resume", () => safeSend(win, "power-event", "resume"));
    powerMonitor.on("lock-screen", () => safeSend(win, "power-event", "lock-screen"));
    powerMonitor.on("unlock-screen", () => safeSend(win, "power-event", "unlock-screen"));

    // A renderer crash leaves `win` alive but its webContents destroyed — the
    // exact state that makes every unguarded win.webContents.send() throw. Log
    // it so a silent white window is diagnosable instead of a mystery; safeSend
    // already handles the send side.
    app.on("render-process-gone", (_evt, contents, details) => {
      console.error(`[main] render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    });
    app.on("child-process-gone", (_evt, details) => {
      console.error(`[main] child-process-gone: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`);
    });

    // Local AI engine: launch on app start, keep it alive for the life of
    // the app (see engineSupervisor.ts for restart/crash-loop handling).
    startEngine(() => win);
  });

  // Drop the reference the moment the window goes, so anything that fires
  // between "closed" and process exit resolves null rather than a destroyed
  // object. safeSend would catch it anyway; this stops it being reached.
  app.on("browser-window-created", (_e, w) => {
    w.on("closed", () => { if (win === w) win = null; });
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => shutdownEngine());
}
