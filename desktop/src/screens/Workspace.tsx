import { useEffect, useState, useRef } from "react";
import { Video, Bell, Settings2, LogOut, Wifi, WifiOff, Sliders, Activity, AlertTriangle, RotateCw } from "lucide-react";
import clsx from "clsx";
import { startRealtimeSync, DeactivatedError, SyncBundle } from "../lib/sync";
import { syncCamerasToLocalEngine, syncAiModelToLocalEngine, isEngineOnline, mjpegStreamUrl, resetLocalEngineState, reportCameraHealth } from "../lib/localEngine";
import { MediaShareSession, ShareStatus } from "../lib/mediaShare";
import type { EngineProcessState } from "../lib/bridge";
import ModelManagerUI from "../components/ModelManagerUI";
import EngineHealthPanel from "../components/EngineHealthPanel";

export default function Workspace({
  onDeactivated,
  onOpenAdminStudio,
}: {
  onDeactivated: () => void;
  onOpenAdminStudio: () => void;
}) {
  const [bundle, setBundle] = useState<SyncBundle | null>(null);
  const [tab, setTab] = useState<"cameras" | "alerts" | "settings" | "engine">("cameras");
  const [syncError, setSyncError] = useState(false);
  const [isPackaged, setIsPackaged] = useState(true);

  useEffect(() => {
    window.camai.getConfig().then((cfg) => setIsPackaged(cfg.isPackaged));
  }, []);

  async function deactivate() {
    // Otherwise a different user activating on this same machine afterward
    // (without an app restart) would inherit this session's "already
    // registered" camera-id set and the local engine could go stale/wrong.
    resetLocalEngineState();
    await window.camai.deactivate();
    onDeactivated();
  }

  useEffect(() => {
    let stop: (() => void) | undefined;
    // admin revocation fails closed: wipe the vault, back to activation
    startRealtimeSync(setBundle, deactivate)
      .then((s) => (stop = s))
      .catch((e) => (e instanceof DeactivatedError ? deactivate() : setSyncError(true)));
    return () => stop?.();
  }, []);

  // Keep the local AI engine's running cameras in step with what's assigned.
  // Runs on an interval, not just on bundle change — the engine can still be
  // starting up (model load can take tens of seconds to minutes) when this
  // first fires, and a sync attempt that no-ops because the engine wasn't
  // reachable yet would otherwise never be retried until something
  // unrelated happened to refetch the bundle. This is what caused a
  // registered cloud camera to never actually reach the local engine,
  // showing "Cameras (1)" in the sidebar while Engine Health stayed at 0.
  useEffect(() => {
    if (!bundle) return;
    const sync = () => void syncCamerasToLocalEngine(bundle.cameras, bundle.rule_engine_rules || [], bundle.zone_profile_configs || []);
    sync();
    const id = setInterval(sync, 8_000);
    return () => clearInterval(id);
  }, [bundle?.cameras, bundle?.rule_engine_rules, bundle?.zone_profile_configs]);

  // push each assigned camera's live connection state (online/offline/
  // connecting/auth_failed/network_error) to Supabase so the portal's
  // Health column and status badge stay accurate without a refresh
  const cameraIds = bundle?.cameras.map((c: any) => c.id).join(",") ?? "";
  useEffect(() => {
    if (!cameraIds) return;
    const ids = cameraIds.split(",");
    void reportCameraHealth(ids);
    const id = setInterval(() => void reportCameraHealth(ids), 10_000);
    return () => clearInterval(id);
  }, [cameraIds]);

  // hot-swap the engine's active model when the org's ai.model setting changes
  const orgModel = bundle?.settings.find((s) => s.scope === "org" && s.key === "ai.model")?.value;
  // Automatically sync/download the selected orgModel in the background:
  useEffect(() => {
    if (!bundle || !orgModel || typeof orgModel !== "string") return;

    let active = true;
    const pkg = bundle.ai_model_packages?.find((p: any) => p.name === orgModel);
    
    async function checkAndDownload() {
      if (!pkg) {
        // If not a dynamic package, sync directly
        void syncAiModelToLocalEngine(orgModel);
        return;
      }

      try {
        const statusRes = await (window as any).camai.getDownloadStatus({ modelName: pkg.name });
        if (statusRes.ok) {
          if (statusRes.status === "complete") {
            // Already downloaded, trigger select
            void syncAiModelToLocalEngine(orgModel);
          } else if (statusRes.status !== "downloading") {
            // Not downloading, trigger download in the background
            console.log(`[Background Sync] Starting auto-download for model: ${pkg.name}`);
            await (window as any).camai.downloadModel({
              url: pkg.download_url,
              modelName: pkg.name,
              expectedChecksum: pkg.checksum,
              signature: pkg.signature,
            });
          }
        }
      } catch (err) {
        console.error("[Background Sync] Failed to sync model:", err);
      }
    }

    void checkAndDownload();

    // Listen to download progress to swap when complete
    const unsub = (window as any).camai.onDownloadProgress(orgModel, (progress: any) => {
      if (active && progress.status === "complete") {
        console.log(`[Background Sync] Download complete for ${orgModel}, hot-swapping...`);
        void syncAiModelToLocalEngine(orgModel);
      }
    });

    return () => {
      active = false;
      unsub();
    };
  }, [orgModel, bundle?.ai_model_packages]);

  // Check if user has permission or is super admin
  const hasPermission = (perm: string): boolean => {
    if (!bundle) return false;
    if (bundle.profile?.is_super_admin) return true;
    return Array.isArray(bundle.permissions) && bundle.permissions.includes(perm);
  };

  // Dynamically select allowed tabs. "engine" (local AI engine health) is
  // diagnostic info about this machine only — never org/camera data — so
  // it's shown to every signed-in desktop user regardless of permissions.
  const allowedTabs = bundle
    ? ([
        (hasPermission("cameras.manage") || hasPermission("cameras.assign")) && "cameras",
        hasPermission("alerts.view") && "alerts",
        hasPermission("ai.configure") && "settings",
        "engine",
      ].filter(Boolean) as ("cameras" | "alerts" | "settings" | "engine")[])
    : [];

  // Auto-switch to first available authorized tab if active tab is unauthorized
  useEffect(() => {
    if (bundle && allowedTabs.length > 0 && !allowedTabs.includes(tab)) {
      setTab(allowedTabs[0]);
    }
  }, [bundle, allowedTabs, tab]);

  if (syncError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-zinc-400">
        <WifiOff size={24} />
        <p className="text-sm">Could not reach CamAI cloud. Check your connection.</p>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-zinc-500">
        Syncing your workspace…
      </div>
    );
  }

  const aiSettings = Object.fromEntries(
    bundle.settings.filter((s) => s.scope === "org").map((s) => [s.key, s.value]),
  );

  // Filter navigation items based on active permissions
  const navItems = ([
    { id: "cameras", label: `Cameras (${bundle.cameras.length})`, icon: Video },
    { id: "alerts", label: `Alerts (${bundle.notifications.length})`, icon: Bell },
    { id: "settings", label: "AI Settings", icon: Settings2 },
    { id: "engine", label: "Engine Health", icon: Activity },
  ] as const).filter((item) => allowedTabs.includes(item.id));

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src="./favicon.svg" alt="CamAI" className="h-8 w-8 rounded-md" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">CamAI Desktop</div>
            <div className="truncate text-xs text-zinc-500">{bundle.organization?.name}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {navItems.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={clsx(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition",
                tab === n.id
                  ? "bg-accent/15 font-medium text-accent"
                  : "text-zinc-400 hover:bg-surface-2 hover:text-zinc-200",
              )}
            >
              <n.icon size={15} /> {n.label}
            </button>
          ))}
          {hasPermission("cameras.manage") && (
            <button
              onClick={onOpenAdminStudio}
              className="mt-4 flex w-full items-center gap-2.5 rounded-md border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/10"
            >
              <Sliders size={15} /> Configure Canvas
            </button>
          )}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm text-zinc-200">{bundle.profile?.full_name}</div>
              <div className="flex items-center gap-1 text-[10px] text-ok">
                <Wifi size={10} /> synced live
              </div>
            </div>
            <button className="text-zinc-500 hover:text-danger" title="Deactivate this device" onClick={deactivate}>
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {tab === "cameras" && <CamerasView cameras={bundle.cameras} isPackaged={isPackaged} />}
        {tab === "alerts" && (
          <div className="space-y-2">
            {!bundle.notifications.length && <Panel title="Alerts">No unread alerts.</Panel>}
            {bundle.notifications.map((n: any) => (
              <div key={n.id} className="card p-3">
                <div className="text-sm font-medium text-zinc-100">{n.title}</div>
                {n.body && <div className="mt-0.5 text-sm text-zinc-500">{n.body}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === "settings" && (
          <div className="space-y-6">
            <Panel title="AI Profile & Rules">
              <div className="rounded-lg bg-surface-1 border border-line p-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded bg-accent/15 flex items-center justify-center text-accent text-lg font-semibold uppercase">
                    {String(aiSettings["ai.profile"] || "Traffic").charAt(0)}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200 capitalize">
                      Active Profile: {aiSettings["ai.profile"] || "Traffic"}
                    </h3>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      Configured via CamAI cloud and synchronized to this client.
                    </div>
                  </div>
                </div>

                <div className="mt-6 space-y-4 border-t border-line/60 pt-4">
                  <div>
                    <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Detection Classes</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {Array.isArray(aiSettings["ai.classes"]) ? (
                        (aiSettings["ai.classes"] as string[]).map((c) => (
                          <span key={c} className="text-xs bg-surface-2 px-2.5 py-1 rounded text-zinc-400 capitalize">
                            {c}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-zinc-500">No classes active.</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                      <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Engine Synchronization</div>
                      <div className="mt-1 text-xs text-ok flex items-center gap-1.5 font-medium">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-ok"></span>
                        </span>
                        Active & Running
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Active Configuration Rules</div>
                      <div className="mt-1 text-xs text-zinc-400 font-mono">
                        {Array.isArray(aiSettings["ai.classes"]) ? `${(aiSettings["ai.classes"] as string[]).length} rules loaded` : "Default rules"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        )}
        {tab === "engine" && <EngineHealthPanel />}
      </main>
    </div>
  );
}

interface EngineHealthInfo {
  online: boolean;
  status: string;
  ready: boolean;
  engine_status: string;
  engine_error: string | null;
  model_loaded: boolean;
  active_cameras: number;
}

function EngineDiagnosticPanel({
  healthInfo,
  procStatus,
  logs,
  isPackaged,
}: {
  healthInfo: EngineHealthInfo | null;
  procStatus: any;
  logs: string[];
  isPackaged: boolean;
}) {
  const [recovering, setRecovering] = useState(false);

  const handleRestart = async () => {
    setRecovering(true);
    await window.camai.engine.restart();
    setTimeout(() => setRecovering(false), 2000);
  };

  const isProcessRunning = procStatus && (procStatus.state === "running" || procStatus.state === "starting" || procStatus.state === "restarting");
  const pid = procStatus?.pid;

  // Try to find exact reason or exception in the last 15 logs if not returned in health/proc status
  let errorReason = "";
  if (!isPackaged) {
    errorReason = procStatus?.lastError || healthInfo?.engine_error || "";
    if (!errorReason && logs.length > 0) {
      const errorLogs = logs.filter(l => l.includes("ERROR") || l.includes("Error") || l.includes("Traceback") || l.includes("Exception") || l.includes("failed"));
      if (errorLogs.length > 0) {
        errorReason = errorLogs.slice(-3).join("\n");
      } else {
        errorReason = logs.slice(-3).join("\n");
      }
    }
  } else {
    // Packaged production app: show clean business diagnostics only
    if (procStatus?.state === "starting") {
      errorReason = "Local AI engine is starting up. Preparing environment...";
    } else if (healthInfo && !healthInfo.ready && healthInfo.engine_status === "loading") {
      errorReason = "Local AI Engine is loading model package. This may take a moment...";
    } else if (procStatus?.state === "crash_looping") {
      errorReason = "Local AI Engine failed to initialize. Please contact support.";
    } else if (!healthInfo?.online) {
      errorReason = "Waiting for local engine service to respond...";
    }
  }

  return (
    <div className="rounded-lg border border-danger/35 bg-surface-1 p-5 shadow-lg space-y-4">
      <div className="flex items-center justify-between border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-danger/10 text-danger animate-pulse">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Local AI Engine Status</h3>
            <p className="text-xs text-zinc-500">
              {!healthInfo?.online
                ? "The engine service is currently offline or unreachable."
                : !healthInfo.ready
                ? "The engine has started but the AI model is still loading or compiling."
                : "Engine is starting up."}
            </p>
          </div>
        </div>
        <button
          onClick={handleRestart}
          disabled={recovering}
          className="flex items-center gap-1.5 rounded bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30 transition disabled:opacity-50"
        >
          <RotateCw size={12} className={clsx(recovering && "animate-spin")} />
          {recovering ? "Recovering…" : "Recovery Button"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded bg-surface-0 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Engine Status</div>
          <div className="mt-0.5 text-xs font-semibold text-zinc-200 capitalize">
            {procStatus?.state || "Unknown"}
          </div>
        </div>
        <div className="rounded bg-surface-0 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Process Running</div>
          <div className="mt-0.5 text-xs font-semibold text-zinc-200">
            {isProcessRunning ? `Yes (PID: ${pid || "Active"})` : "No"}
          </div>
        </div>
        <div className="rounded bg-surface-0 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Health Status</div>
          <div className="mt-0.5 text-xs font-semibold text-zinc-200">
            {healthInfo?.online ? (healthInfo.ready ? "Ready" : "Loading Model") : "Unreachable"}
          </div>
        </div>
        <div className="rounded bg-surface-0 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Port</div>
          <div className="mt-0.5 text-xs font-semibold text-zinc-200">8000</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded bg-surface-0 px-3 py-2 col-span-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Active AI Processor</div>
          <div className="mt-0.5 text-xs font-semibold text-zinc-200">Advanced Detection Processor</div>
        </div>
        <div className="rounded bg-surface-0 px-3 py-2 col-span-2">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Camera Status</div>
          <div className="mt-0.5 text-xs font-semibold text-zinc-200">
            {healthInfo?.active_cameras ?? 0} active cameras
          </div>
        </div>
      </div>

      {errorReason && (
        <div className="rounded border border-line bg-black/55 p-3">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Error Details</div>
          <pre className="whitespace-pre-wrap font-mono text-[10px] text-danger/90 leading-relaxed max-h-36 overflow-y-auto">
            {errorReason}
          </pre>
        </div>
      )}
    </div>
  );
}

function CamerasView({ cameras, isPackaged }: { cameras: any[]; isPackaged: boolean }) {
  const [healthInfo, setHealthInfo] = useState<EngineHealthInfo | null>(null);
  const [procStatus, setProcStatus] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [consecutiveMisses, setConsecutiveMisses] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Fetch supervisor logs in real-time
    window.camai.engine.getLogs().then((l) => !cancelled && setLogs(l.slice(-100)));
    const offLog = window.camai.engine.onLog((line) => {
      if (!cancelled) setLogs((prev) => [...prev.slice(-99), line]);
    });

    const checkHealth = async () => {
      try {
        const res = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(800) });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setHealthInfo({
              online: true,
              status: data.status || "ok",
              ready: data.ready ?? false,
              engine_status: data.engine_status || "unknown",
              engine_error: data.engine_error || null,
              model_loaded: data.model_loaded ?? false,
              active_cameras: data.active_cameras ?? 0,
            });
            setConsecutiveMisses(0);
          }
        } else {
          throw new Error("unhealthy");
        }
      } catch (err) {
        if (!cancelled) {
          setConsecutiveMisses((m) => {
            const next = m + 1;
            if (next >= 2) {
              setHealthInfo((h) => ({
                online: false,
                status: "unreachable",
                ready: false,
                engine_status: "failed",
                engine_error: "Connection to port 8000 refused",
                model_loaded: false,
                active_cameras: 0,
              }));
            }
            return next;
          });
        }
      }

      // Update supervisor status
      const s = await window.camai.engine.getStatus();
      if (!cancelled) setProcStatus(s);
    };

    checkHealth();
    const id = setInterval(checkHealth, 1000); // Poll /health every second

    return () => {
      cancelled = true;
      clearInterval(id);
      offLog();
    };
  }, []);

  if (!cameras.length) {
    return <Panel title="Cameras">No cameras assigned to you. Ask your administrator.</Panel>;
  }

  const isEngineOffline = !healthInfo || !healthInfo.online || !healthInfo.ready;

  return (
    <div className="space-y-4">
      {isEngineOffline && (
        <EngineDiagnosticPanel healthInfo={healthInfo} procStatus={procStatus} logs={logs} isPackaged={isPackaged} />
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {cameras.map((c) => (
          <CameraTile key={c.id} camera={c} engineOnline={healthInfo?.online && healthInfo?.ready} />
        ))}
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  online: "Online", offline: "Offline", connecting: "Connecting",
  auth_failed: "Authentication Failed", network_error: "Network Error", error: "Error",
};
const STATUS_TONES: Record<string, string> = {
  online: "bg-ok/15 text-ok",
  connecting: "bg-warn/15 text-warn",
  auth_failed: "bg-danger/15 text-danger",
  network_error: "bg-danger/15 text-danger",
  offline: "bg-surface-3 text-zinc-500",
  error: "bg-danger/15 text-danger",
};

const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  idle: "", acquiring: "Starting…", connecting: "Connecting…",
  live: "Live", reconnecting: "Reconnecting…", error: "Error",
};
const SHARE_STATUS_TONES: Record<ShareStatus, string> = {
  idle: "", acquiring: "bg-warn/20 text-warn animate-pulse",
  connecting: "bg-warn/20 text-warn animate-pulse",
  live: "bg-red-500/20 text-red-400 animate-pulse",
  reconnecting: "bg-warn/20 text-warn animate-pulse",
  error: "bg-danger/20 text-danger",
};

function CameraTile({ camera: c, engineOnline }: { camera: any; engineOnline: boolean | null }) {
  const [streamFailed, setStreamFailed] = useState(false);
  const [sharingType, setSharingType] = useState<"screen" | "webcam" | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<MediaShareSession | null>(null);

  const isScreenShareCam = c.source_type === "screen_share";
  const showStream = engineOnline && !streamFailed && (!isScreenShareCam || sharingType === null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = localStream;
  }, [localStream]);

  // Persistent across transient disconnects — only torn down on unmount or
  // an explicit "Stop Share" click, never on a dropped socket or a paused
  // display (see lib/mediaShare.ts for the reconnect/re-acquire logic).
  useEffect(() => () => { sessionRef.current?.stop(); sessionRef.current = null; }, []);

  function startSharing(type: "screen" | "webcam") {
    sessionRef.current?.stop();
    const session = new MediaShareSession(c.id, type, {
      onStatus: setShareStatus,
      onStream: setLocalStream,
    });
    sessionRef.current = session;
    setSharingType(type);
    void session.start();
  }

  function stopSharing() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setSharingType(null);
    setShareStatus("idle");
    setLocalStream(null);
  }

  return (
    <div className="card overflow-hidden">
      <div className="relative flex aspect-video items-center justify-center bg-surface-0 text-zinc-600">
        {sharingType !== null ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover bg-black"
          />
        ) : showStream ? (
          <img
            src={mjpegStreamUrl(c.id)}
            alt={c.name}
            className="h-full w-full object-cover"
            onError={() => setStreamFailed(true)}
          />
        ) : isScreenShareCam ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <div className="text-zinc-500 text-xs">Virtual Camera (No live stream)</div>
            <div className="flex gap-2">
              <button
                className="flex items-center gap-1.5 rounded bg-accent/20 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30 transition"
                onClick={() => startSharing("screen")}
              >
                Share Screen
              </button>
              <button
                className="flex items-center gap-1.5 rounded bg-zinc-800 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 transition"
                onClick={() => startSharing("webcam")}
              >
                Share Webcam
              </button>
            </div>
          </div>
        ) : (
          <Video size={28} />
        )}

        {sharingType !== null && (
          <div className="absolute top-2 right-2 bg-red-600/90 text-white text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shadow">
            Sharing {sharingType}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2 bg-surface-1">
        <span className="text-sm text-zinc-200">{c.name}</span>
        <div className="flex items-center gap-2">
          {sharingType !== null && (
            <button
              onClick={stopSharing}
              className="text-[10px] text-red-400 hover:text-red-300 hover:underline mr-1"
            >
              Stop Share
            </button>
          )}
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              sharingType !== null
                ? SHARE_STATUS_TONES[shareStatus]
                : STATUS_TONES[c.status] ?? "bg-surface-3 text-zinc-500",
            )}
          >
            {sharingType !== null ? SHARE_STATUS_LABELS[shareStatus] : STATUS_LABELS[c.status] ?? c.status}
          </span>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <div className="mt-2 text-sm text-zinc-400">{children}</div>
    </div>
  );
}
