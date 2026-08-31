// Process supervisor for the Local AI Engine (server/, a FastAPI process
// normally run by hand during dev via `python -m app.main`). In production
// the engine ships as a companion install (its own Python/venv, placed
// wherever the operator's engine installer puts it) — this module locates
// that install, launches it on app start, restarts it if it crashes, and
// exposes its logs/status to the renderer for the Engine Health panel.
import { spawn, execFile, execFileSync, ChildProcess } from "node:child_process";
import { app, BrowserWindow } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { safeSend } from "./safeSend";

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  /** Shared secret for the engine's configuration endpoints — see controlToken(). */
  apiToken?: string;
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
// Crashes that happen AFTER the engine has already reported healthy are counted
// separately, over a much longer window, because neither guard above can see
// them.
//
// Both of those guards assume a crash means "failed to start": consecutiveCrashes
// is zeroed by confirmHealthyAndReset() the moment /health answers, and
// crashTimestamps only remembers 60 seconds. A GPU-driver crash that reliably
// kills the engine a few MINUTES into every run therefore reads as a first-ever
// crash every single time — so it never reaches GPU_FALLBACK_AFTER_CRASHES, never
// reaches CRASH_LOOP_THRESHOLD, and the app silently respawns the engine forever.
// The operator sees detections appear, vanish, reappear, with the health panel
// insisting everything is fine and nothing written anywhere saying otherwise.
//
// Native GPU-plugin faults are the realistic cause on this hardware (they kill
// the process with no Python traceback, which is why the CPU escalation exists
// at all), and nothing about them guarantees they land during startup. So:
// whatever the cause, an engine that keeps dying after healthy runs gets
// escalated to CPU and then surfaced, instead of cycling invisibly.
const POST_HEALTHY_CRASH_WINDOW_MS = 15 * 60_000;
const POST_HEALTHY_CRASH_THRESHOLD = 3;
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
// Crash times over POST_HEALTHY_CRASH_WINDOW_MS, counting ONLY runs that had
// already reported healthy. Deliberately not cleared by confirmHealthyAndReset —
// becoming healthy is what makes these crashes invisible to the other counters,
// so it must not also erase the record of them.
let postHealthyCrashes: number[] = [];
// Whether the CURRENT child ever answered /health. Decides which bucket its
// eventual exit belongs in.
let currentRunWasHealthy = false;
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

// A liveness deadline for /health, NOT a latency target.
//
// This was 1000ms, which is a false-negative generator on exactly the machine
// state this check exists to survive. The engine's /health is served by the
// same event loop that serves telemetry and MJPEG, and under load it has been
// measured at 1.5s rising past 8s — while answering 200 the whole time. A
// one-second deadline therefore reports "the engine is gone" precisely when
// the engine is busiest, which is when killing it does the most damage.
//
// The renderer's own health poll already settled on this number and on
// requiring several consecutive misses (see Workspace.tsx, HEALTH_TIMEOUT_MS /
// MISSES_BEFORE_OFFLINE). This is the same judgement applied to the process
// that can actually restart the engine.
const HEALTH_TIMEOUT_MS = 12000;

// Consecutive failed probes before the adopted engine is presumed gone.
// 6 misses spread over ADOPTED_POLL_MS (30s) prevents premature kill under load.
const ADOPTED_MISSES_BEFORE_TAKEOVER = 6;
const ADOPTED_POLL_MS = 5000;

function checkEngineRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: 8000,
        path: "/health",
        method: "GET",
        timeout: HEALTH_TIMEOUT_MS,
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

/**
 * Shared secret the engine requires on its configuration endpoints — the ones
 * that set a camera's AI mode (zone_profile), model and confidence. See
 * server/app/config.py:API_TOKEN for the threat model; in short it proves the
 * caller is this app, while WHO may change a mode stays an RLS decision in the
 * cloud (cameras.manage).
 *
 * PERSISTED, not per-launch, because of adoption: startEngine() will adopt an
 * engine already listening on 8000 — typically an orphan of a previous run,
 * which was spawned with whatever token was current THEN. A fresh random token
 * each launch would therefore not match the engine we adopt, and every config
 * push (including every AI-mode change) would 403 until the orphan was killed.
 * It lives in userData alongside the rest of the engine config, so it is
 * readable only by this OS user — which is exactly the trust boundary.
 */
function controlToken(): string {
  const cfg = loadConfig();
  if (cfg.apiToken) return cfg.apiToken;
  const token = randomBytes(32).toString("hex");
  saveConfig({ ...cfg, apiToken: token });
  return token;
}

/** Renderer-side callers (lib/localEngine.ts) need this to talk to the engine. */
export function getControlToken(): string {
  return controlToken();
}

function looksLikeEngineDir(dir: string): boolean {
  return existsSync(join(dir, "app", "main.py"));
}

async function resolveEngine(): Promise<ResolvedEngine | null> {
  // 1. Highest priority: the bundled, frozen engine exe. This is the
  //    production path — the installer ships server/dist/camai-engine or
  //    camai-engine.zip as resources/engine/, so no Python is required.
  if (app.isPackaged) {
    const engineDir = join(process.resourcesPath, "engine");
    const exe = join(engineDir, "camai-engine.exe");
    const zip = join(engineDir, "camai-engine.zip");

    if (existsSync(exe)) {
      return { frozenExe: exe, engineDir };
    } else if (existsSync(zip)) {
      appendLog(`[Supervisor] Unpacking bundled AI engine archive...`);
      try {
        // .NET's ZipFile, not Expand-Archive: Expand-Archive is backed by the
        // Microsoft.PowerShell.Archive module, and on a real machine that
        // module can fail to autoload (seen here as "the module could not be
        // loaded") for reasons that have nothing to do with this app - a
        // stale module cache, low disk on the system drive PSModulePath
        // lives on, whatever. When it fails, Expand-Archive exits non-zero
        // and NOTHING is extracted, but the log line that followed
        // ("Unpacking completed but engine executable not found") read like
        // a packaging problem rather than a missing PowerShell module, and
        // the desktop has no engine at all afterward - every camera sits at
        // "not_configured" forever, which is indistinguishable from "nothing
        // detects" to whoever is looking at the app. ZipFile is a .NET
        // Framework class, not a PowerShell module; it has nothing to
        // autoload and nothing to fail to load.
        const stderrChunks: Buffer[] = [];
        const unpacked = await new Promise<boolean>((resolve) => {
          const cp = spawn("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            // Clear anything left by a prior partial/failed unpack first:
            // ExtractToDirectory has no overwrite flag on the .NET Framework
            // build Windows PowerShell 5.1 resolves (only .NET Core's does),
            // so a retry into a non-empty dir throws on the first colliding
            // file instead of just replacing it.
            `Get-ChildItem -Path ${JSON.stringify(engineDir)} -Exclude 'camai-engine.zip' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; ` +
              `Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
              `[System.IO.Compression.ZipFile]::ExtractToDirectory(${JSON.stringify(zip)}, ${JSON.stringify(engineDir)})`,
          ], { windowsHide: true });
          cp.stderr?.on("data", (d) => stderrChunks.push(d));
          cp.on("close", (code) => resolve(code === 0));
          cp.on("error", () => resolve(false));
        });
        if (unpacked && existsSync(exe)) {
          appendLog("[Supervisor] Engine archive unpacked successfully.");
          return { frozenExe: exe, engineDir };
        } else {
          const detail = Buffer.concat(stderrChunks).toString("utf8").trim();
          appendLog(`[Supervisor] Failed to unpack engine archive${detail ? `: ${detail}` : " (unpacking finished but the executable is still missing)."}`);
        }
      } catch (err: any) {
        appendLog(`[Supervisor] Failed to unpack engine archive: ${err?.message}`);
      }
    }
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
    const devExe = join(devDir, "dist", "camai-engine", "camai-engine.exe");
    if (existsSync(devExe)) {
      candidates.push({ frozenExe: devExe, engineDir: join(devDir, "dist", "camai-engine") });
    }
    candidates.push({ pythonPath: join(devDir, ".venv-build", "Scripts", "python.exe"), engineDir: devDir });
    candidates.push({ pythonPath: join(devDir, ".venv", "Scripts", "python.exe"), engineDir: devDir });
    candidates.push({ pythonPath: join(devDir, "venv", "Scripts", "python.exe"), engineDir: devDir });
    candidates.push({ pythonPath: "python", engineDir: devDir });
  }

  for (const c of candidates) {
    if (c.frozenExe && existsSync(c.frozenExe)) return c;
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
  // Taking over means starting a SECOND engine against the same database while
  // the first may still be alive and holding port 8000 — every camera thread
  // runs twice, and every virtual camera loses the frames being pushed to the
  // instance that gets displaced. Acting on a single missed probe made that a
  // routine occurrence under load rather than a genuine recovery.
  let misses = 0;
  adoptedMonitor = setInterval(async () => {
    if (child || manualStop) {
      clearAdoptedMonitor();
      return;
    }
    const stillUp = await checkEngineRunning();
    if (stillUp) {
      misses = 0;
      return;
    }
    misses++;
    appendLog(
      `[Supervisor] Adopted engine did not answer /health (${misses}/${ADOPTED_MISSES_BEFORE_TAKEOVER}).`,
    );
    if (misses < ADOPTED_MISSES_BEFORE_TAKEOVER) return;
    appendLog("[Supervisor] Adopted engine on port 8000 is no longer responding — taking over with a supervised instance.");
    clearAdoptedMonitor();
    void launch();
  }, ADOPTED_POLL_MS);
}

async function clearPort8000IfBlocked(): Promise<void> {
  if (process.platform !== "win32") return;
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$conn = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if ($conn -and $conn -gt 0) { Stop-Process -Id $conn -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 750 }`,
      ],
      { windowsHide: true },
      () => resolve()
    );
  });
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

  // Clear any stale/orphan process holding port 8000 before spawning
  await clearPort8000IfBlocked();

  const resolved = await resolveEngine();
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
      // Locks the engine's configuration endpoints (AI mode / model /
      // confidence) to this app. See controlToken().
      CAMAI_API_TOKEN: controlToken(),
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

  (proc as any).on("error", (err: Error) => {
    appendLog(`[Supervisor] Failed to spawn engine: ${err.message}`);
    child = null;
    pid = null;
    setState("not_configured", err.message);
    if (!manualStop) scheduleRestart();
  });

  (proc as any).on("exit", (code: number | null, signal: string | null) => {
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
      appendLog("[Supervisor] Port 8000 conflict detected. Auto-clearing stale process and retrying startup...");
      setState("port_conflict", "Port 8000 was in use by a stale process. Automatically clearing and restarting engine...");
      clearPort8000IfBlocked().then(() => {
        if (!manualStop) {
          if (restartTimer) clearTimeout(restartTimer);
          restartTimer = setTimeout(() => { restartTimer = null; void launch(); }, 1500);
        }
      });
      return;
    }

    // A real crash.
    consecutiveCrashes += 1;
    crashTimestamps.push(Date.now());
    crashTimestamps = crashTimestamps.filter((t) => Date.now() - t < CRASH_LOOP_WINDOW_MS);

    if (currentRunWasHealthy) {
      postHealthyCrashes.push(Date.now());
      postHealthyCrashes = postHealthyCrashes.filter(
        (t) => Date.now() - t < POST_HEALTHY_CRASH_WINDOW_MS,
      );
      appendLog(
        `[Supervisor] Engine died after running healthy (${postHealthyCrashes.length} such crash(es) in the last ` +
          `${POST_HEALTHY_CRASH_WINDOW_MS / 60_000} minutes).`,
      );
    }
    currentRunWasHealthy = false;

    // Escalate to CPU BEFORE giving up: if the engine has crashed repeatedly
    // while (implicitly) trying the GPU, force CPU on the next launch. This is
    // the only layer that can recover a *native* GPU-plugin crash.
    const repeatedPostHealthy = postHealthyCrashes.length >= POST_HEALTHY_CRASH_THRESHOLD;
    if (!forceCpu && (consecutiveCrashes >= GPU_FALLBACK_AFTER_CRASHES || repeatedPostHealthy)) {
      forceCpu = true;
      const why = repeatedPostHealthy
        ? `Engine died ${postHealthyCrashes.length}x after running healthy`
        : `Engine crashed ${consecutiveCrashes}x`;
      appendLog(`[Supervisor] ${why} — the GPU inference path may be failing. Forcing CPU inference on the next start.`);
      setState("restarting", "GPU inference may be failing on this machine — automatically retrying on CPU.");
      // Start the post-healthy count over for the CPU attempt. These crashes are
      // evidence about the GPU path, which we are now abandoning; carrying them
      // forward would let a single unlucky CPU run trip the terminal state
      // below immediately, and the whole point of escalating is to find out
      // whether CPU actually behaves differently.
      postHealthyCrashes = [];
      scheduleRestart();
      return;
    }

    // Already on CPU and STILL dying after healthy runs: restarting forever
    // teaches the operator nothing. Stop and say so, the same way a startup
    // crash loop does.
    if (forceCpu && repeatedPostHealthy) {
      setState(
        "crash_looping",
        `Engine has died ${postHealthyCrashes.length} times shortly after starting, including on CPU` +
          " — auto-restart paused. Check %APPDATA%/CamAI/engine-startup.log for the cause and restart manually.",
      );
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
      // Record that THIS run got as far as serving /health, so that if it dies
      // later we can tell a "never started" crash from a "ran, then died" one.
      // postHealthyCrashes is intentionally left alone here — see its declaration.
      currentRunWasHealthy = true;
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
    (c as any).once("exit", () => {
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
