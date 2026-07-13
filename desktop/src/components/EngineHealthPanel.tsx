import { useEffect, useRef, useState } from "react";
import { Activity, Cpu, MemoryStick, Gauge, Play, Square, RotateCw, Terminal, AlertTriangle, FolderCog } from "lucide-react";
import clsx from "clsx";
import { getEngineAppStatus, EngineAppStatus } from "../lib/localEngine";
import type { EngineStatus } from "../lib/bridge";

const PROCESS_LABELS: Record<EngineStatus["state"], string> = {
  not_configured: "Not configured",
  starting: "Starting…",
  running: "Running",
  restarting: "Restarting…",
  crash_looping: "Crash looping",
  stopped: "Stopped",
};
const PROCESS_TONES: Record<EngineStatus["state"], string> = {
  not_configured: "bg-warn/15 text-warn",
  starting: "bg-warn/15 text-warn animate-pulse",
  running: "bg-ok/15 text-ok",
  restarting: "bg-warn/15 text-warn animate-pulse",
  crash_looping: "bg-danger/15 text-danger",
  stopped: "bg-surface-3 text-zinc-500",
};

export default function EngineHealthPanel() {
  const [proc, setProc] = useState<EngineStatus | null>(null);
  const [app, setApp] = useState<EngineAppStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pythonPath, setPythonPath] = useState("");
  const [engineDir, setEngineDir] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isPackaged, setIsPackaged] = useState(false);
  const logBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.camai.getConfig().then((cfg) => !cancelled && setIsPackaged(cfg.isPackaged));
    window.camai.engine.getStatus().then((s) => !cancelled && setProc(s));
    window.camai.engine.getLogs().then((l) => !cancelled && setLogs(l.slice(-500)));
    window.camai.engine.getPath().then((p) => {
      if (cancelled) return;
      if (p.pythonPath) setPythonPath(p.pythonPath);
      if (p.engineDir) setEngineDir(p.engineDir);
    });

    const offStatus = window.camai.engine.onStatus((s) => !cancelled && setProc(s));
    const offLog = window.camai.engine.onLog((line) =>
      !cancelled && setLogs((prev) => [...prev.slice(-499), line]));

    return () => { cancelled = true; offStatus(); offLog(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => getEngineAppStatus().then((s) => !cancelled && setApp(s));
    poll();
    const id = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (showLogs && logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs, showLogs]);

  const eng = app?.engine;
  const modelState = eng?.status;

  async function saveEnginePath() {
    setSaveError(null);
    const res = await window.camai.engine.setPath({ pythonPath, engineDir });
    if (!res.ok) setSaveError(res.error ?? "Failed to save");
    else setShowSettings(false);
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-zinc-100">Local AI Engine</h2>
            {proc && (
              <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium", PROCESS_TONES[proc.state])}>
                {PROCESS_LABELS[proc.state]}
              </span>
            )}
            {modelState && modelState !== "ready" && (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                {modelState === "loading" ? "Loading model…" : "Model load failed"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => window.camai.engine.restart()}
              className="flex items-center gap-1 rounded bg-surface-2 px-2 py-1 text-xs text-zinc-300 hover:bg-surface-3 transition"
              title="Restart engine"
            >
              <RotateCw size={12} /> Restart
            </button>
            {proc?.state === "stopped" || proc?.state === "not_configured" ? (
              <button
                onClick={() => window.camai.engine.start()}
                className="flex items-center gap-1 rounded bg-ok/15 px-2 py-1 text-xs text-ok hover:bg-ok/25 transition"
              >
                <Play size={12} /> Start
              </button>
            ) : (
              <button
                onClick={() => window.camai.engine.stop()}
                className="flex items-center gap-1 rounded bg-danger/15 px-2 py-1 text-xs text-danger hover:bg-danger/25 transition"
              >
                <Square size={12} /> Stop
              </button>
            )}
            <button
              onClick={() => setShowSettings((v) => !v)}
              className="flex items-center gap-1 rounded bg-surface-2 px-2 py-1 text-xs text-zinc-300 hover:bg-surface-3 transition"
              title="Configure engine path"
            >
              <FolderCog size={12} /> Settings
            </button>
          </div>
        </div>

        {(proc?.lastError || (modelState === "failed" && eng?.error)) && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>{proc?.lastError || eng?.error}</span>
          </div>
        )}

        {showSettings && (
          <div className="mt-4 space-y-2 rounded-md border border-line bg-surface-0 p-3">
            <div className="text-xs text-zinc-500">
              Path to the engine's Python interpreter and its install directory (containing <code>app/main.py</code>).
            </div>
            <input
              value={pythonPath}
              onChange={(e) => setPythonPath(e.target.value)}
              placeholder="C:\CamAI\Engine\venv\Scripts\python.exe"
              className="w-full rounded border border-line bg-surface-1 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent"
            />
            <input
              value={engineDir}
              onChange={(e) => setEngineDir(e.target.value)}
              placeholder="C:\CamAI\Engine"
              className="w-full rounded border border-line bg-surface-1 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-accent"
            />
            {saveError && <div className="text-xs text-danger">{saveError}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200">
                Cancel
              </button>
              <button onClick={saveEnginePath} className="rounded bg-accent/20 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/30">
                Save & Restart
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={Cpu} label="CPU" value={eng ? `${eng.cpu_percent.toFixed(0)}%` : "—"} />
          <Metric icon={Gauge} label="GPU" value={eng ? `${eng.gpu_percent.toFixed(0)}%` : "—"} />
          <Metric icon={MemoryStick} label="Memory" value={eng ? `${(eng.memory_mb / 1024).toFixed(2)} GB` : "—"} />
          <Metric icon={Activity} label="Avg FPS" value={eng ? eng.avg_fps.toFixed(1) : "—"} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs text-zinc-500">
          <div>Profile: <span className="text-zinc-300">{app?.selectedModel ? (app.selectedModel.includes("PPE") ? "Factory Safety" : "Standard Detection") : "—"}</span></div>
          <div>Processor: <span className="text-zinc-300">{eng?.device ? (eng.device.toLowerCase().includes("cpu") ? "Local CPU" : "Hardware Accelerated (GPU)") : "—"}</span></div>
          <div>Inference latency: <span className="text-zinc-300">{eng ? `${eng.avg_latency_ms.toFixed(0)} ms` : "—"}</span></div>
          <div>Active cameras: <span className="text-zinc-300">{eng?.active_cameras ?? 0}</span></div>
        </div>
      </div>

      {!isPackaged && (
        <div className="card overflow-hidden">
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-zinc-300 hover:bg-surface-2 transition"
          >
            <Terminal size={14} /> Engine Logs {showLogs ? "▾" : "▸"}
          </button>
          {showLogs && (
            <div ref={logBoxRef} className="max-h-72 overflow-y-auto border-t border-line bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
              {logs.length === 0 ? <div className="text-zinc-600">No log output yet.</div> : logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-0 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
        <Icon size={11} /> {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-zinc-100">{value}</div>
    </div>
  );
}
