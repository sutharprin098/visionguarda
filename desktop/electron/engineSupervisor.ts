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
import { request } from "node:http";
import { safeSend } from "./safeSend";

export type EngineProcessState =
  | "not_configured"
  | "starting"
  | "running"
  | "restarting"
  | "crash_looping"
  | "port_conflict"
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
// After this many consecutive crashes we relaunch with GPU inference disabled.
// A broken/incompatible GPU driver can make OpenVINO's GPU plugin crash the
// engine *natively* during model compile — Python try/except can't catch a
// segfault, so the only place left to recover "if GPU fails, switch to CPU" is
// here: force CPU and try again before giving up. Set below the crash-loop
// pause threshold so the CPU attempt always happens first.
const GPU_FALLBACK_AFTER_CRASHES = 2;
// Engine exit codes from run_engine.py (kept in sync with EXIT_* there).
const ENGINE_EXIT_ANOTHER_ENGINE = 0; // healthy engine already owns the port
const ENGINE_EXIT_PORT_CONFLICT = 3;  // port held by a foreign process

let child: ChildProcess | null = null;
let state: EngineProcessState = "not_configured";
let lastError: string | null = null;
let pid: number | null = null;
let crashTimestamps: number[] = [];
// Consecutive crashes since the last clean run — drives the GPU->CPU fallback
// escalation (reset to 0 once the engine reports healthy).
let consecutiveCrashes = 0;
// Set true after repeated crashes so the next launch forces CPU inference.
let forceCpu = false;
let restartTimer: NodeJS.Timeout | null = null;
// When we adopt an engine we didn't spawn (already listening on 8000 — an
// orphan from a prior unclean exit), we hold no child handle to watch its
// exit. This timer polls its health instead so the recovery guarantee still
// holds: if the adopted engine disappears, we fall back to launching our own
// supervised instance rather than sitting forever on a stale "running".
let adoptedMonitor: NodeJS.Timeout | null = null;
let manualStop = true; // flips false the first time startEngine() is called
let logs: string[] = [];
let getWin: () => BrowserWindow | null = () => null;

function checkEngineRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: 8000,
        path: "/health",
        method: "GET",
        timeout: 1000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

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
    : [];
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
  console.log(`[Engine Supervisor] ${line.trim()}`);
  for (const l of line.split(/\r?\n/)) {
    if (!l) continue;
    logs.push(l);
  }
  if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
  // `getWin()?.` guarded only against a null window — a CLOSED window is still
  // a live object, so this threw "Object has been destroyed" whenever the engine
  // logged a line after the window went away (i.e. on almost every quit, since
  // shutdownEngine kills the child and the child logs on its way out).
  safeSend(getWin(), "engine:log", line);
}

function setState(s: EngineProcessState, err: string | null = null): void {
  state = s;
  lastError = err;
  safeSend(getWin(), "engine:status", getStatus());
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

function clearAdoptedMonitor(): void {
  if (adoptedMonitor) {
    clearInterval(adoptedMonitor);
    adoptedMonitor = null;
  }
}

// Poll an adopted (externally-spawned) engine's health. If it goes away and
// the user hasn't asked us to stop, take over: launch a real, supervised
// child so crash-recovery resumes. No-op once we own a child of our own.
function startAdoptedMonitor(): void {
  clearAdoptedMonitor();
  adoptedMonitor = setInterval(async () => {
    if (child || manualStop) {
      clearAdoptedMonitor();
      return;
    }
    const stillUp = await checkEngineRunning();
    if (!stillUp) {
      appendLog("[Supervisor] Adopted engine on port 8000 is no longer responding — taking over with a supervised instance.");
      clearAdoptedMonitor();
      void launch();
    }
  }, 5000);
}

async function launch(): Promise<void> {
  if (child) return;

  const alreadyRunning = await checkEngineRunning();
  if (alreadyRunning) {
    appendLog("[Supervisor] An active engine instance is already running on port 8000. Adopting it (health-monitored).");
    setState("running");
    startAdoptedMonitor();
    return;
  }

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
      ? `[Supervisor] Launching bundled engine: "${command}" (cwd=${resolved.engineDir})${forceCpu ? " [CPU-forced]" : ""}`
      : `[Supervisor] Launching engine: "${command}" -m app.main (cwd=${resolved.engineDir})${forceCpu ? " [CPU-forced]" : ""}`,
  );

  const proc = spawn(command, args, {
    cwd: resolved.engineDir,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      CAMAI_DEV_RELOAD: "",
      CAMAI_FROZEN: useFrozen ? "1" : "",
      // Escalated recovery: once repeated crashes suggest the GPU path is at
      // fault, force CPU inference so the engine comes up instead of looping.
      CAMAI_FORCE_CPU: forceCpu ? "1" : "",
    },
    windowsHide: true,
  });
  child = proc;
  pid = proc.pid ?? null;
  clearAdoptedMonitor(); // we now own a real child to watch; drop the poll
  setState("running");
  confirmHealthyAndReset(); // clear crash counters once it actually serves

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

    // Clean, documented exits from run_engine.py's preflight are NOT crashes —
    // never count them toward the crash-loop pause.
    if (code === ENGINE_EXIT_ANOTHER_ENGINE) {
      appendLog("[Supervisor] Engine exited cleanly (another healthy engine owns the port). Adopting it.");
      setState("running");
      startAdoptedMonitor();
      return;
    }
    if (code === ENGINE_EXIT_PORT_CONFLICT) {
      // A foreign process holds the port. Relaunching just fails to bind again,
      // so DON'T crash-loop — surface it and retry slowly (it may free up).
      setState("port_conflict",
        "Port 8000 is in use by another application. The AI engine can't start until it's freed. Retrying periodically.");
      if (restartTimer) return;
      restartTimer = setTimeout(() => { restartTimer = null; launch(); }, 15000);
      return;
    }

    // A real crash.
    consecutiveCrashes += 1;
    crashTimestamps.push(Date.now());
    crashTimestamps = crashTimestamps.filter((t) => Date.now() - t < CRASH_LOOP_WINDOW_MS);

    // Escalate to CPU BEFORE giving up: if the engine has crashed repeatedly
    // while (implicitly) trying the GPU, force CPU on the next launch. This is
    // the only layer that can recover a *native* GPU-plugin crash.
    if (!forceCpu && consecutiveCrashes >= GPU_FALLBACK_AFTER_CRASHES) {
      forceCpu = true;
      appendLog(`[Supervisor] Engine crashed ${consecutiveCrashes}x — the GPU inference path may be failing. Forcing CPU inference on the next start.`);
      setState("restarting", "GPU inference may be failing on this machine — automatically retrying on CPU.");
      scheduleRestart();
      return;
    }

    if (crashTimestamps.length >= CRASH_LOOP_THRESHOLD) {
      setState(
        "crash_looping",
        `Engine crashed ${crashTimestamps.length} times in the last minute` +
          (forceCpu ? " (including on CPU)" : "") +
          " — auto-restart paused. Check %APPDATA%/CamAI/engine-startup.log for the cause and restart manually.",
      );
      return;
    }
    scheduleRestart();
  });
}

// Poll /health briefly after a launch; once the engine reports up, clear the
// crash counters so an earlier transient crash doesn't permanently keep the
// engine pinned to CPU or count toward a future crash-loop pause. Does NOT
// clear forceCpu if it was set — a machine that only works on CPU should stay
// on CPU for the session rather than flip-flopping.
function confirmHealthyAndReset(): void {
  let tries = 0;
  const iv = setInterval(async () => {
    tries += 1;
    if (child === null || manualStop || tries > 40) { // ~2 min max
      clearInterval(iv);
      return;
    }
    if (await checkEngineRunning()) {
      clearInterval(iv);
      if (consecutiveCrashes > 0 || crashTimestamps.length > 0) {
        appendLog("[Supervisor] Engine is healthy — clearing crash counters.");
      }
      consecutiveCrashes = 0;
      crashTimestamps = [];
    }
  }, 3000);
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
  consecutiveCrashes = 0;
  launch();
}

export function stopEngine(): void {
  manualStop = true;
  clearAdoptedMonitor();
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
  consecutiveCrashes = 0;
  forceCpu = false; // a manual restart gives the GPU path a fresh chance
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
  clearAdoptedMonitor();
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) killTree(child);
}
