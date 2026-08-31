import type { BrowserWindow } from "electron";

/**
 * The only safe way to push to the renderer from the main process.
 *
 * Why this exists: `win?.webContents.send(...)` looks defensive and is not.
 * Optional chaining only guards against `win` being null/undefined — but a
 * closed BrowserWindow is still a live JS object, so `?.` sails straight past
 * and `.send()` throws "TypeError: Object has been destroyed". That was the
 * packaged-EXE crash: every one of these fires from something that outlives the
 * window —
 *
 *   engineSupervisor.appendLog()  — once per engine stdout line
 *   engineSupervisor.setState()   — on every state change, incl. shutdown
 *   powerMonitor suspend/resume   — fires whenever Windows says so
 *   downloadManager progress      — a download in flight when the user quits
 *
 * so the race is not exotic: quit the app while the engine is logging, or let
 * the machine sleep after the window is gone, and it throws.
 *
 * Both objects must be checked. A window can be alive while its webContents is
 * already gone (renderer crash, `render-process-gone`), which is exactly when
 * something is most likely to still be trying to report status.
 *
 * Returns whether the message went out, so callers that care (e.g. a
 * progress reporter deciding to stop) can tell without another check.
 */
export function safeSend(win: BrowserWindow | null | undefined, channel: string, ...args: unknown[]): boolean {
  try {
    if (!win || win.isDestroyed()) return false;
    const wc = win.webContents;
    if (!wc || wc.isDestroyed()) return false;
    // A renderer that is mid-navigation or crashed can still fail here; the
    // point of this helper is that a dead renderer never takes the main
    // process down with it.
    wc.send(channel, ...args);
    return true;
  } catch (err) {
    // Deliberately swallowed and logged rather than rethrown: this is a
    // best-effort notification path. Nothing the main process does depends on
    // the renderer having heard, and an exception here kills the app.
    console.error(`[safeSend] ${channel} failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}
