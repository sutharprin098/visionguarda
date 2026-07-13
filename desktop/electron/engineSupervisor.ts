// Process supervisor for the Local AI Engine (server/, a FastAPI process
// normally run by hand during dev via `python -m app.main`). In production
// the engine ships as a companion install (its own Python/venv, placed
// wherever the operator's engine installer puts it) — this module locates
// that install, launches it on app start, restarts it if it crashes, and
// exposes its logs/status to the renderer for the Engine Health panel.
import { spawn, execFile, ChildProcess } from "node:child_process";
import { app, BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export type EngineProcessState =
  | "not_configured"
  | "starting"
  | "running"
  | "restarting"
  | "crash_looping"
  | "stopped";

interface EngineConfig {
  pythonPath?: string;
  engineDir?: string;
}

interface ResolvedEngine {
  // Frozen production engine: a standalone camai-engine.exe (PyInstaller).
  // When present it is launched directly — no system Python / venv needed.
  frozenExe?: string;
  // Dev / companion fallback: a Python interpreter + the engine source dir.
  pythonPath?: string;
  engineDir: string;
}

const MAX_LOG_LINES = 3000;
const RESTART_BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];
const CRASH_LOOP_WINDOW_MS = 60_000;
const CRASH_LOOP_THRESHOLD = 3;

let child: ChildProcess | null = null;
let state: EngineProcessState = "not_configured";
let lastError: string | null = null;
let pid: number | null = null;
let crashTimestamps: number[] = [];
let restartTimer: NodeJS.Timeout | null = null;
let manualStop = true; // flips false the first time startEngine() is called
let logs: string[] = [];
let getWin: () => BrowserWindow | null = () => null;

function configPath(): string {
  return join(app.getPath("userData"), "engine-config.json");
}

function loadConfig(): EngineConfig {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: EngineConfig): void {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

function looksLikeEngineDir(dir: string): boolean {
  return existsSync(join(dir, "app", "main.py"));
}

function resolveEngine(): ResolvedEngine | null {
  // 1. Highest priority: the bundled, frozen engine exe. This is the
  //    production path — the installer ships server/dist/camai-engine as
  //    resources/engine/, so no Python is ever required on the user's PC.
  const frozenCandidates = app.isPackaged
    ? [join(process.resourcesPath, "engine", "camai-engine.exe")]
    : [join(__dirname, "..", "..", "server", "dist", "camai-engine", "camai-engine.exe")];
  for (const exe of frozenCandidates) {
    if (existsSync(exe)) return { frozenExe: exe, engineDir: dirname(exe) };
  }

  // 2. Explicit operator override (Engine Settings) — a Python interpreter.
  const cfg = loadConfig();
  if (cfg.pythonPath && cfg.engineDir && existsSync(cfg.pythonPath) && looksLikeEngineDir(cfg.engineDir)) {
    return { pythonPath: cfg.pythonPath, engineDir: cfg.engineDir };
  }

  // 3. Dev / companion Python fallback.
  const candidates: ResolvedEngine[] = [];
  if (app.isPackaged) {
    // Companion-install convention: engine placed next to the app's own
    // resources by its own installer/setup step.
    const base = join(process.resourcesPath, "engine");
    candidates.push({ pythonPath: join(base, "venv", "Scripts", "python.exe"), engineDir: base });
    candidates.push({ pythonPath: join(base, ".venv", "Scripts", "python.exe"), engineDir: base });
    candidates.push({ pythonPath: join(base, "python.exe"), engineDir: base });
  } else {
    // Dev mode: repo-relative ../../server from desktop/dist-electron.
    const devDir = join(__dirname, "..", "..", "server");
    candidates.push({ pythonPath: join(devDir, ".venv", "Scripts", "python.exe"), engineDir: devDir });
    candidates.push({ pythonPath: join(devDir, "venv", "Scripts", "python.exe"), engineDir: devDir });
    candidates.push({ pythonPath: "python", engineDir: devDir });
  }

  for (const c of candidates) {
    if (!looksLikeEngineDir(c.engineDir)) continue;
    if (c.pythonPath && (c.pythonPath === "python" || existsSync(c.pythonPath))) return c;
  }
  return null;
}

function appendLog(line: string): void {
  for (const l of line.split(/\r?\n/)) {
    if (!l) continue;
    logs.push(l);
  }
  if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
  getWin()?.webContents.send("engine:log", line);
}

function setState(s: EngineProcessState, err: string | null = null): void {
  state = s;
  lastError = err;
  getWin()?.webContents.send("engine:status", getStatus());
}

export function getStatus() {
  return {
    state,
    pid,
    lastError,
    crashCount: crashTimestamps.length,
    config: loadConfig(),
  };
}

export function getLogs(): string[] {
  return logs;
}

function killTree(proc: ChildProcess): void {
  if (process.platform === "win32" && proc.pid) {
    execFile("taskkill", ["/pid", String(proc.pid), "/T", "/F"], () => {
      /* best-effort — the exit event fires regardless once the OS reaps it */
    });
  } else {
    proc.kill("SIGTERM");
  }
}

function launch(): void {
  if (child) return;
  const resolved = resolveEngine();
  if (!resolved) {
    setState(
      "not_configured",
      "Local AI engine not found. Configure its Python interpreter and install directory in Engine Settings.",
    );
    return;
  }

  setState(state === "not_configured" || state === "stopped" ? "starting" : "restarting");

  // Frozen engine exe (production) is launched directly with no args; the
  // Python fallback runs the module entry. Both write logs to stdout/stderr.
  const useFrozen = !!resolved.frozenExe;
  const command = useFrozen ? resolved.frozenExe! : resolved.pythonPath!;
  const args = useFrozen ? [] : ["-m", "app.main"];
  appendLog(
    useFrozen
      ? `[Supervisor] Launching bundled engine: "${command}" (cwd=${resolved.engineDir})`
      : `[Supervisor] Launching engine: "${command}" -m app.main (cwd=${resolved.engineDir})`,
  );

  const proc = spawn(command, args, {
    cwd: resolved.engineDir,
    env: { ...process.env, PYTHONUNBUFFERED: "1", CAMAI_DEV_RELOAD: "", CAMAI_FROZEN: useFrozen ? "1" : "" },
    windowsHide: true,
  });
  child = proc;
  pid = proc.pid ?? null;
  setState("running");

  proc.stdout?.on("data", (d: Buffer) => appendLog(d.toString()));
  proc.stderr?.on("data", (d: Buffer) => appendLog(d.toString()));

  proc.on("error", (err: Error) => {
    appendLog(`[Supervisor] Failed to spawn engine: ${err.message}`);
    child = null;
    pid = null;
    setState("not_configured", err.message);
    if (!manualStop) scheduleRestart();
  });

  proc.on("exit", (code: number | null, signal: string | null) => {
    appendLog(`[Supervisor] Engine process exited (code=${code}, signal=${signal})`);
    child = null;
    pid = null;
    if (manualStop) {
      setState("stopped");
      return;
    }
    crashTimestamps.push(Date.now());
    crashTimestamps = crashTimestamps.filter((t) => Date.now() - t < CRASH_LOOP_WINDOW_MS);
    if (crashTimestamps.length >= CRASH_LOOP_THRESHOLD) {
      setState(
        "crash_looping",
        `Engine crashed ${crashTimestamps.length} times in the last minute — auto-restart paused. Check the logs and restart manually.`,
      );
      return;
    }
    scheduleRestart();
  });
}

function scheduleRestart(): void {
  if (restartTimer) return;
  const attempt = Math.min(crashTimestamps.length, RESTART_BACKOFF_MS.length - 1);
  const delay = RESTART_BACKOFF_MS[attempt];
  setState("restarting");
  appendLog(`[Supervisor] Restarting engine in ${(delay / 1000).toFixed(0)}s...`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    launch();
  }, delay);
}

export function startEngine(win: () => BrowserWindow | null): void {
  getWin = win;
  manualStop = false;
  crashTimestamps = [];
  launch();
}

export function stopEngine(): void {
  manualStop = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    killTree(child);
  } else {
    setState("stopped");
  }
}

export function restartEngine(): void {
  crashTimestamps = [];
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    const c = child;
    manualStop = true; // suppress the in-flight exit handler's own restart logic
    c.once("exit", () => {
      manualStop = false;
      launch();
    });
    killTree(c);
  } else {
    manualStop = false;
    launch();
  }
}

export function setEnginePath(pythonPath: string, engineDir: string): { ok: boolean; error?: string } {
  if (!existsSync(pythonPath)) return { ok: false, error: "Python interpreter not found at that path" };
  if (!looksLikeEngineDir(engineDir)) return { ok: false, error: "That directory doesn't look like the CamAI engine (missing app/main.py)" };
  saveConfig({ pythonPath, engineDir });
  restartEngine();
  return { ok: true };
}

export function getEnginePath(): EngineConfig {
  return loadConfig();
}

// Called from app "before-quit" — synchronous best-effort kill so the
// engine process doesn't linger after the desktop app itself has closed.
export function shutdownEngine(): void {
  manualStop = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) killTree(child);
}
