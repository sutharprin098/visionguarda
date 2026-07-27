import { useEffect, useState, useRef, useCallback } from "react";
import { Video, Bell, Settings2, LogOut, Wifi, WifiOff, Sliders, Activity, AlertTriangle, RotateCw, Maximize2, Minimize2, Lock, Send, Check, Loader2, MessageCircle, ChevronDown, ChevronRight, Copy } from "lucide-react";
import clsx from "clsx";
import { startRealtimeSync, DeactivatedError, SyncBundle } from "../lib/sync";
import { syncAiModelToLocalEngine, syncAiConfidenceToLocalEngine, mjpegStreamUrl, resetLocalEngineState, reportCameraHealth, reportEvents } from "../lib/localEngine";
import { MediaShareSession, ShareStatus } from "../lib/mediaShare";
import { TelemetrySession, TelemetryDetection, CameraTelemetry } from "../lib/telemetry";
import type { ZoneProfileKey } from "../lib/zoneProfiles";
import DetectionOverlay from "../components/DetectionOverlay";
import FullscreenViewer from "../components/FullscreenViewer";
import ProfileDashboard from "../components/ProfileDashboard";
import SourcePicker from "../components/SourcePicker";
import { lockReason } from "../lib/rbac";
import { getSupabase } from "../lib/session";
import type { CaptureSource } from "../lib/bridge";
import {
  ModuleState, loadModules, filterDetections,
} from "../lib/aiModules";
import AlertProvider, { useAlertIngest } from "../components/alerts/AlertProvider";
import { siteLabel } from "../components/alerts/alertUtils";
import { getTelegramConfig, invalidateTelegramConfig, sendTelegramTest } from "../lib/localTelegram";

// Remembered across launches by name, not id — see startSharing().
const LAST_SOURCE_KEY = "camai.lastCaptureSource";
import type { EngineProcessState } from "../lib/bridge";
import ModelManagerUI from "../components/ModelManagerUI";
import EngineHealthPanel from "../components/EngineHealthPanel";
interface EngineHealthInfo {
  online: boolean;
  status: string;
  ready: boolean;
  engine_status: string;
  engine_error: string | null;
  model_loaded: boolean;
  active_cameras: number;
}

export default function Workspace({
  bundle,
  onDeactivated,
  onOpenAdminStudio,
}: {
  bundle: SyncBundle;
  onDeactivated: () => void;
  /** Undefined when this user lacks cameras.manage — App decides, from the
   *  user's permissions rather than from which build is running. */
  onOpenAdminStudio?: () => void;
}) {
  const [tab, setTab] = useState<"cameras" | "alerts" | "settings" | "engine">("cameras");
  // Which camera is showing full-window, or null. Lifted to Workspace (not the
  // tile) because the viewer has to cover the sidebar and the tab bar, and
  // because switching camera while fullscreen has to keep the SAME viewer
  // mounted — a per-tile fullscreen element cannot do either.
  const [fullscreenCamId, setFullscreenCamId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [syncErrorDetails, setSyncErrorDetails] = useState<string | null>(null);
  const [isPackaged, setIsPackaged] = useState(true);
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
        const res = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(3000) });
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

  // Realtime sync is now managed at the App level to persist state during screen switching.

  // NOTE: camera->local-engine sync used to live here. It now runs in App, because
  // Admin Studio needs it too and this component never mounts in the Admin build
  // — see the comment on that effect. Two copies would double the registration
  // traffic in the desktop build for no benefit.

  // push each assigned camera's live connection state (online/offline/
  // connecting/auth_failed/network_error) to Supabase so the portal's
  // Health column and status badge stay accurate without a refresh
  const cameraIds = bundle?.cameras.map((c: any) => c.id).join(",") ?? "";
  useEffect(() => {
    if (!cameraIds) return;
    const ids = cameraIds.split(",");
    void reportCameraHealth(ids);
    void reportEvents();
    const id = setInterval(() => { void reportCameraHealth(ids); void reportEvents(); }, 10_000);
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

  // Push the org's detection floor to the engine whenever it changes (and once
  // on mount, since the engine starts on its default and has no idea what the
  // org set). Retried on an interval rather than only on change: the engine is a
  // separate process that can still be booting — or can restart and come back on
  // the default — long after the bundle last changed, and a one-shot push would
  // leave it silently running a confidence nobody chose.
  const orgConfidence = bundle?.settings.find((s) => s.scope === "org" && s.key === "ai.confidence")?.value;
  useEffect(() => {
    if (orgConfidence == null) return;
    void syncAiConfidenceToLocalEngine(orgConfidence);
    const id = setInterval(() => void syncAiConfidenceToLocalEngine(orgConfidence), 8_000);
    return () => clearInterval(id);
  }, [orgConfidence]);

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
        {syncErrorDetails && (
          <p className="text-xs text-zinc-500 font-mono mt-1 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 max-w-md text-center">
            Error: {syncErrorDetails}
          </p>
        )}
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
    /* The live alert surface is mounted here, above the whole shell, so a card
       raised by a tile in the grid is still on screen after the operator
       fullscreens a camera or switches to the Alerts tab — the tiles come and
       go, the alerts do not. "Open Live Feed" on a card lands in exactly the
       same state the fullscreen button does. */
    <AlertProvider onOpenLiveFeed={setFullscreenCamId}>
    <div className="flex h-screen">
      {/* Covers the entire shell — sidebar, tabs, grid, stats, settings — with
          plain fixed positioning. The layout underneath is never torn down, so
          exiting restores it exactly, and any screen-share session in a tile
          keeps running because no tile unmounts. */}
      {fullscreenCamId && (
        <FullscreenViewer
          cameras={bundle.cameras}
          cameraId={fullscreenCamId}
          orgName={bundle.organization?.name ?? null}
          onSelectCamera={setFullscreenCamId}
          onExit={() => setFullscreenCamId(null)}
        />
      )}
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
          {hasPermission("cameras.manage") && onOpenAdminStudio ? (
            <button
              onClick={onOpenAdminStudio}
              className="mt-4 flex w-full items-center gap-2.5 rounded-md border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/10"
            >
              <Sliders size={15} /> Configure Canvas
            </button>
          ) : (
            // Shown locked rather than hidden: an operator who cannot find the
            // control assumes the app is broken and asks us; one who sees it
            // locked asks their admin, which is the correct escalation. The
            // server rejects the write either way (RLS: cameras.manage).
            <div
              title={lockReason()}
              className="mt-4 flex w-full cursor-not-allowed items-center gap-2.5 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-zinc-600"
            >
              <Lock size={15} /> Configure Canvas
            </div>
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
        <div style={{ display: tab === "cameras" ? "block" : "none" }}>
          <CamerasView
            cameras={bundle.cameras}
            orgName={bundle.organization?.name ?? null}
            isPackaged={isPackaged}
            healthInfo={healthInfo}
            procStatus={procStatus}
            logs={logs}
            onFullscreen={setFullscreenCamId}
            paused={fullscreenCamId !== null}
          />
        </div>
        <div style={{ display: tab === "alerts" ? "block" : "none" }}>
          <AlertsTab orgId={bundle.organization?.id ?? null} notifications={bundle.notifications} hasPermission={hasPermission} />
        </div>
        <div style={{ display: tab === "settings" ? "block" : "none" }} className="space-y-6">
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

                <ConfidenceControl
                  orgId={bundle.organization?.id ?? null}
                  value={typeof aiSettings["ai.confidence"] === "number" ? (aiSettings["ai.confidence"] as number) : 0.25}
                  canEdit={hasPermission("ai.configure")}
                />

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
        <div style={{ display: tab === "engine" ? "block" : "none" }}>
          <EngineHealthPanel />
        </div>
      </main>
    </div>
    </AlertProvider>
  );
}

/**
 * Detection confidence, org-wide (`settings` key `ai.confidence`).
 *
 * Writes the setting and nothing else: realtime sync brings the new row back
 * into the bundle, and Workspace's sync effect pushes it to the local engine.
 * Deliberately NOT POSTing to the engine directly from here — that would apply
 * on this one machine while the row it saved says something else on every other
 * machine in the org, which is the kind of split-brain nobody can debug from a
 * screenshot.
 *
 * The slider commits on release (onChange fires per pixel of drag; each one
 * would be a Supabase round-trip and an engine push).
 */
function ConfidenceControl({
  orgId,
  value,
  canEdit,
}: {
  orgId: string | null;
  value: number;
  canEdit: boolean;
}) {
  // Local while dragging so the handle tracks the cursor; the prop is the truth
  // once the write lands and syncs back.
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef(false);

  // Adopt the synced value unless the operator is mid-drag — otherwise a sync
  // tick landing during a drag yanks the handle out from under them.
  useEffect(() => {
    if (!dragging.current) setDraft(value);
  }, [value]);

  async function commit(next: number) {
    if (!orgId || !canEdit) return;
    // A click or a Tab through the slider fires the same handlers as a drag;
    // without this, merely focusing the control writes to the org's settings and
    // shows up in the audit trail as a change nobody made.
    if (next === value) return;
    setSaving(true);
    setError(null);
    try {
      const sb = await getSupabase();
      // Check .error, don't just await: PostgREST reports an RLS refusal as a
      // resolved promise carrying an error, so an unauthorised write here would
      // otherwise look exactly like a successful one.
      const { error: err } = await sb.from("settings").upsert(
        { org_id: orgId, scope: "org", key: "ai.confidence", value: next as any },
        { onConflict: "org_id,scope,key" },
      );
      if (err) {
        setError(err.message);
        setDraft(value); // don't leave the UI showing a value that never saved
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
      setDraft(value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          Detection Confidence
        </div>
        <div className="text-xs font-mono text-zinc-300">{Math.round(draft * 100)}%</div>
      </div>
      <input
        type="range"
        min={0.1}
        max={0.9}
        step={0.05}
        value={draft}
        disabled={!canEdit || !orgId || saving}
        onPointerDown={() => { dragging.current = true; }}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => { dragging.current = false; void commit(draft); }}
        onKeyUp={() => { void commit(draft); }}
        className="mt-2 w-full accent-accent disabled:opacity-40 disabled:cursor-not-allowed"
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
        <span>More detections (10%)</span>
        <span>Fewer, surer (90%)</span>
      </div>
      {canEdit ? (
        <div className="mt-1.5 text-[10px] text-zinc-500">
          {saving
            ? "Saving…"
            : "Applies to every camera in this org, live — no restart."}
        </div>
      ) : (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-600">
          <Lock size={9} /> {lockReason()}
        </div>
      )}
      {error && <div className="mt-1 text-[10px] text-danger">Could not save: {error}</div>}
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

function CamerasView({
  cameras,
  orgName,
  isPackaged,
  healthInfo,
  procStatus,
  logs,
  onFullscreen,
  paused,
}: {
  cameras: any[];
  /** Fallback for the alert card's site line — see siteLabel(). */
  orgName: string | null;
  isPackaged: boolean;
  healthInfo: EngineHealthInfo | null;
  procStatus: any;
  logs: string[];
  onFullscreen: (id: string) => void;
  /** The fullscreen viewer is covering the grid — see CameraTile. */
  paused: boolean;
}) {
  if (!cameras.length) {
    return <Panel title="Cameras">No cameras assigned to you. Ask your administrator.</Panel>;
  }

  const isEngineOffline = healthInfo !== null && (!healthInfo.online || !healthInfo.ready);

  return (
    <div className="space-y-4">
      {isEngineOffline && (
        <EngineDiagnosticPanel healthInfo={healthInfo} procStatus={procStatus} logs={logs} isPackaged={isPackaged} />
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {cameras.map((c) => (
          <CameraTile
            key={c.id}
            camera={c}
            site={siteLabel(c, orgName)}
            engineOnline={healthInfo ? (healthInfo.online && healthInfo.ready) : null}
            onFullscreen={() => onFullscreen(c.id)}
            paused={paused}
          />
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
  source_gone: "Source gone",
};
const SHARE_STATUS_TONES: Record<ShareStatus, string> = {
  idle: "", acquiring: "bg-warn/20 text-warn animate-pulse",
  connecting: "bg-warn/20 text-warn animate-pulse",
  live: "bg-red-500/20 text-red-400 animate-pulse",
  reconnecting: "bg-warn/20 text-warn animate-pulse",
  error: "bg-danger/20 text-danger",
  source_gone: "bg-danger/20 text-danger",
};

/**
 * `paused` = the fullscreen viewer is open, so this tile is completely covered
 * and every byte it pulls is wasted. It is not a cosmetic flag; it is the whole
 * fullscreen performance fix.
 *
 * WHY FULLSCREEN LAGGED: the viewer is an overlay, so the grid underneath never
 * unmounts — by design, to keep screen shares alive and restore the layout
 * exactly. But that also meant every tile kept its MJPEG <img> streaming and its
 * telemetry WebSocket open while invisible, and the viewer then opened ONE MORE
 * full-window MJPEG stream of its own. So the moment an operator hit fullscreen,
 * the app decoded N+1 streams to show 1, with the newly-added one the largest.
 *
 * The sharp edge is the connection cap: Chromium allows 6 concurrent
 * connections per host, and every MJPEG stream is one that never closes. With 6
 * cameras the grid alone pins all 6, so the viewer's own stream — and every
 * fetch to 127.0.0.1:8000, including /api/status and health polling — queues
 * behind connections that will not end until the tab does. That is not slowness
 * that resolves; it is a stall that lasts as long as fullscreen is open, and it
 * reads to the operator as "fullscreen lags".
 *
 * So a covered tile drops its stream and its socket, leaving the viewer alone on
 * the host. The cost is an MJPEG reconnect (a frame or two) when the viewer
 * closes, which is invisible next to the stall it removes. Detection is entirely
 * unaffected either way: the engine analyses registered cameras regardless of
 * who is watching — this only changes who is pulling pixels.
 */
function CameraTile({ camera: c, site, engineOnline, onFullscreen, paused }: { camera: any; site: string; engineOnline: boolean | null; onFullscreen: () => void; paused: boolean }) {
  const [streamFailed, setStreamFailed] = useState(false);
  const [sharingType, setSharingType] = useState<"screen" | "webcam" | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [detections, setDetections] = useState<TelemetryDetection[]>([]);
  const [telemetry, setTelemetry] = useState<CameraTelemetry | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceName, setSourceName] = useState<string | null>(null);
  // Overlay class filter, kept at its saved defaults (all on). No per-user toggle
  // UI — which classes the camera detects is an admin decision (zone profile),
  // so a normal user simply sees every detection the engine reports.
  const [modules] = useState<ModuleState>(() => loadModules(c.id));
  // Which tile a keyboard shortcut applies to when several are on screen.
  const [isHovered, setIsHovered] = useState(false);
  const tileRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<MediaShareSession | null>(null);

  const isScreenShareCam = c.source_type === "screen_share";
  // `!paused` drops the MJPEG connection while the viewer covers this tile.
  const showStream = engineOnline && !streamFailed && !isScreenShareCam && !paused;

  // The media element the overlay measures: the local <video> while sharing,
  // otherwise the MJPEG <img>. Both show the same frames the engine analysed.
  const imgRef = useRef<HTMLImageElement>(null);
  const mediaRef = (sharingType !== null ? videoRef : imgRef) as React.RefObject<HTMLVideoElement | HTMLImageElement>;
  const showingMedia = sharingType !== null || showStream;

  // ---- smart-snapshot capture source --------------------------------------
  //
  // The alert system crops its evidence out of THIS element — the frames the
  // operator is already watching. Nothing extra is fetched and no second MJPEG
  // connection is opened, which matters more than it sounds: every MJPEG <img>
  // pins one of Chromium's six per-host connections for as long as it lives, so
  // a capture that opened its own stream would stall the grid it was capturing.
  //
  // Kept in a ref rather than read from the render closure because the
  // telemetry subscription deliberately does not re-subscribe when a share
  // starts — a closed-over element would go stale exactly when the source
  // changed. `imgCors` gates the <img> case only: a stream fetched without CORS
  // taints the canvas, and handing that to the alert engine would make it
  // conclude snapshots are impossible for every camera. A screen/webcam
  // <video> is a same-origin capture stream and never taints.
  const [imgCors, setImgCors] = useState(true);
  const [streamAttempt, setStreamAttempt] = useState(0);
  const corsProvenRef = useRef(false);
  const captureRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  useEffect(() => {
    if (sharingType !== null) captureRef.current = videoRef.current;
    else captureRef.current = imgCors ? imgRef.current : null;
  });

  const ingestAlert = useAlertIngest();

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = localStream;
  }, [localStream]);

  // Detections are pushed once per AI cycle to /ws subscribers. Only subscribe
  // while something is actually on screen — the engine pushes per subscriber,
  // so a hidden tile would cost real work for boxes nobody can see.
  // `!paused` is not redundant with showingMedia: a screen-share tile keeps
  // showingMedia true while covered (its <video> is local and its share session
  // must keep pushing frames to the engine), so without this its telemetry
  // socket would stay open behind the viewer for boxes nobody can see.
  useEffect(() => {
    if (!engineOnline || !showingMedia || paused) { setDetections([]); setTelemetry(null); return; }
    const session = new TelemetrySession(c.id, (t) => {
      setDetections(t.detections ?? []);
      setTelemetry(t);
      // Same payload, second consumer. The alert engine decides on its own
      // what is an event (a track it has not seen, an analytics counter that
      // moved) and rate-limits itself; this call is a handful of map lookups
      // in the common case where nothing new happened, and never blocks —
      // snapshot encoding is queued to idle time inside the engine.
      ingestAlert({ id: c.id, name: c.name, site }, t, captureRef.current);
    });
    session.start();
    return () => session.stop();
  }, [c.id, c.name, site, engineOnline, showingMedia, paused, ingestAlert]);

  // Persistent across transient disconnects — only torn down on unmount or
  // an explicit "Stop Share" click, never on a dropped socket or a paused
  // display (see lib/mediaShare.ts for the reconnect/re-acquire logic).
  useEffect(() => () => { sessionRef.current?.stop(); sessionRef.current = null; }, []);

  // ---- Fullscreen ----
  // The tile no longer fullscreens itself. It used to call
  // tileRef.requestFullscreen().catch(() => {}) — an API that can reject for
  // reasons the page cannot inspect, with the rejection swallowed, so a refusal
  // and a success were indistinguishable and the button "did nothing" with no
  // error anywhere. It also could not satisfy "switch camera while fullscreen",
  // because the fullscreen element was one specific tile.
  //
  // Opening the viewer is now a state change in Workspace, which cannot be
  // refused. See components/FullscreenViewer.tsx.
  //
  // F11 is claimed only while this tile is hovered, so with a grid of tiles the
  // key resolves to the one under the cursor rather than firing on all of them.
  // (ESC/F11 to EXIT are owned by the viewer itself.)
  useEffect(() => {
    if (!isHovered || !showingMedia) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        onFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHovered, showingMedia, onFullscreen]);

  // Screen shares must name their surface; webcam has no picker.
  function startSharing(type: "screen" | "webcam", source?: CaptureSource) {
    // Always tear the previous session down first — two live sessions would
    // both push frames for the same camera_id, doubling engine load and making
    // the stream flicker between two surfaces.
    sessionRef.current?.stop();
    const session = new MediaShareSession(
      c.id,
      type,
      { onStatus: setShareStatus, onStream: setLocalStream },
      source?.id,
    );
    sessionRef.current = session;
    setSharingType(type);
    setSourceName(type === "webcam" ? "Webcam" : source?.name ?? null);
    if (source) {
      // Persist by NAME: desktopCapturer ids are per-session handles and never
      // match after a relaunch or after the window is reopened.
      try { localStorage.setItem(LAST_SOURCE_KEY, source.name); } catch { /* private mode */ }
    }
    void session.start();
  }

  function stopSharing() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setSharingType(null);
    setShareStatus("idle");
    setLocalStream(null);
    setSourceName(null);
  }

  // Fullscreen shows the whole frame letterboxed (contain) instead of
  // centre-cropping it (cover): a cropped fullscreen would hide detections that
  // are really there, which is worse than black bars. The overlay is told which
  // fit is in play so the boxes track the change.
  // The tile is always the grid-sized, centre-cropped view now; the letterboxed
  // full-frame view is the viewer's job.
  const fit: "cover" | "contain" = "cover";
  const mediaClass = "h-full w-full object-cover";
  const shownDetections = filterDetections(detections, modules);

  // The "Calibration Required" badge lived here. Speed is automatic now (the
  // engine scales from each object's own height), so there is no setup left to
  // prompt for — a permanent badge demanding calibration for a feature that
  // already works would just be noise. Which numbers are measured vs estimated
  // is still visible per box: the overlay marks estimates with "~".

  return (
    <div className="card overflow-hidden">
      <div
        ref={tileRef}
        onDoubleClick={showingMedia ? onFullscreen : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="relative flex aspect-video items-center justify-center bg-surface-0 text-zinc-600"
      >
        {sharingType !== null ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`${mediaClass} bg-black`}
          />
        ) : showStream ? (
          <img
            // Remounting on retry (rather than reassigning .src on the live
            // element) is what lets the crossOrigin attribute change at all —
            // it is only read when the request is made.
            key={`${c.id}:${streamAttempt}:${imgCors ? "cors" : "plain"}`}
            ref={imgRef}
            // Requesting the stream with CORS is what makes the smart snapshot
            // possible: without it the engine's frames taint the canvas and
            // toBlob() throws SecurityError. config.py already allowlists this
            // renderer's origin, so the engine answers with a matching
            // Access-Control-Allow-Origin and nothing changes for the stream
            // itself. If that ever fails, the error handler below remounts
            // without the attribute — the live view is never sacrificed for a
            // snapshot feature; the alerts simply arrive without an image.
            crossOrigin={imgCors ? "anonymous" : undefined}
            src={mjpegStreamUrl(c.id)}
            alt={c.name}
            className={mediaClass}
            onLoad={() => { corsProvenRef.current = imgCors; }}
            onError={() => {
              // An error before a single frame has ever arrived in CORS mode is
              // the one that might BE the CORS handshake: drop it and remount
              // at once. Any error after a frame has landed is an ordinary
              // stream drop (engine restart, camera reconnect) — retry as
              // before and keep CORS, or we would permanently lose snapshots
              // on this tile for an unrelated blip.
              if (imgCors && !corsProvenRef.current) {
                console.warn(`[Alerts] stream for ${c.id} refused CORS — snapshots disabled for this tile`);
                setImgCors(false);
                return;
              }
              setTimeout(() => setStreamAttempt((n) => n + 1), 1000);
            }}
          />
        ) : isScreenShareCam ? (
          <div className="flex flex-col items-center gap-3 p-4 text-center">
            <div className="text-zinc-500 text-xs">Virtual Camera (No live stream)</div>
            <div className="flex gap-2">
              <button
                className="flex items-center gap-1.5 rounded bg-accent/20 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30 transition"
                onClick={() => setPickerOpen(true)}
              >
                Choose Source…
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

        {/* Boxes sit above the media and below the status chips. object-cover
            matches the className on both the <video> and the <img> above. */}
        {showingMedia && shownDetections.length > 0 && (
          <DetectionOverlay detections={shownDetections} mediaRef={mediaRef} fit={fit} />
        )}

        {/* Stays visible in fullscreen — an operator watching a full-screen feed
            is exactly who needs to see the pipeline is still keeping up. */}
        {showingMedia && telemetry && (
          <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 shadow">
            {shownDetections.length} shown · {(telemetry.fps ?? 0).toFixed(1)} fps
            {telemetry.device ? ` · ${telemetry.device.toUpperCase()}` : ""}
          </div>
        )}

        {showingMedia && (
          <button
            onClick={onFullscreen}
            title="Full screen (F11, or double-click)"
            className="absolute bottom-2 right-2 rounded bg-black/70 p-1.5 text-zinc-300 hover:bg-black/90 hover:text-white"
          >
            <Maximize2 size={13} />
          </button>
        )}

        {/* Name the actual surface, not just the mode — "Sharing screen" gave the
            operator no way to tell which screen/window was going out. */}
        {sharingType !== null && (
          <div className="absolute top-2 right-2 max-w-[70%] truncate rounded bg-red-600/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow"
               title={sourceName ?? undefined}>
            Sharing: {sourceName ?? sharingType}
          </div>
        )}

        {/* Terminal state: the window we were capturing is gone. Offer a re-pick
            rather than retrying an id that can never resolve again. */}
        {shareStatus === "source_gone" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-0/95 p-4 text-center">
            <AlertTriangle size={22} className="text-warn" />
            <div className="text-xs text-zinc-300">Selected source is no longer available.</div>
            <div className="flex gap-2">
              <button onClick={() => setPickerOpen(true)}
                      className="rounded bg-accent/20 px-2.5 py-1.5 text-xs font-semibold text-accent hover:bg-accent/30">
                Choose another source
              </button>
              <button onClick={stopSharing}
                      className="rounded bg-surface-3 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
                Stop
              </button>
            </div>
          </div>
        )}

        {pickerOpen && (
          <SourcePicker
            lastSourceName={(() => { try { return localStorage.getItem(LAST_SOURCE_KEY); } catch { return null; } })()}
            onCancel={() => setPickerOpen(false)}
            onPick={(src) => { setPickerOpen(false); startSharing("screen", src); }}
          />
        )}
      </div>
      {/* Per-profile dashboard — detection counters / FPS the engine emits. This
          is the ONLY per-camera AI surface a normal user sees; it is read-only
          telemetry, never configuration. All AI-MODE configuration (the camera's
          zone profile) lives in Admin Studio → the camera's settings, is stored
          on cameras.zone_profile (RLS: cameras.manage), applied engine-side
          (analytics.PROFILE_CLASSES), and propagates to every client via the
          cameras realtime sync. No mode buttons are rendered below the feed. */}
      {showingMedia && telemetry && (
        <ProfileDashboard profile={(c.zone_profile as ZoneProfileKey) ?? null} t={telemetry} />
      )}
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

// ---------------------------------------------------------------------------
// AlertsTab — Telegram connect (one-time connection code) + live alert feed
// ---------------------------------------------------------------------------
const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 border-red-500/40 text-red-400",
  warning:  "bg-amber-500/15 border-amber-500/40 text-amber-400",
  info:     "bg-sky-500/15 border-sky-500/40 text-sky-400",
};
const SEVERITY_ICON: Record<string, string> = { critical: "🔴", warning: "🟠", info: "🔵" };

type TgConnState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "connected"; chatName: string; username?: string; connectedAt?: string }
  | { phase: "code"; code: string; expiresAt: string; botUsername: string; deepLink: string }
  | { phase: "error"; msg: string };

/**
 * supabase-js collapses any non-2xx edge-function response into the opaque
 * "Edge Function returned a non-2xx status code". The real, actionable reason
 * lives in the Response it stashes on error.context — read it and translate it
 * into something an operator can act on (no raw stack traces / secret names in
 * the UI). Falls back to the raw message only when nothing better is available.
 */
async function friendlyConnectError(error: any, data: any): Promise<string> {
  let status = 0;
  let bodyErr = "";
  // FunctionsHttpError carries the actual Response on .context.
  const ctx = error?.context;
  if (ctx && typeof ctx.status === "number") {
    status = ctx.status;
    try {
      const j = await ctx.clone().json();
      bodyErr = String(j?.error ?? j?.message ?? "");
    } catch { /* non-JSON body — leave blank */ }
  }
  if (!bodyErr && typeof data?.error === "string") bodyErr = data.error;
  const hay = `${bodyErr} ${error?.message ?? ""}`.toLowerCase();

  if (status === 404 || hay.includes("not_found") || hay.includes("not be found"))
    return "Telegram linking service isn't deployed yet. Deploy the 'telegram-link-code' edge function (deploy_supabase.ps1), then try again.";
  if (hay.includes("telegram_bot_username"))
    return "The Telegram bot isn't configured on the server (missing TELEGRAM_BOT_USERNAME). Ask your administrator to set it.";
  if (status === 401 || hay.includes("unauth"))
    return "Your session expired. Sign out and back in, then try again.";
  if (hay.includes("no org"))
    return "Your account isn't linked to an organization yet.";
  if (hay.includes("relation") && hay.includes("telegram_connections"))
    return "The Telegram database tables aren't set up. Apply the latest migrations (supabase db push), then try again.";
  if (status >= 500 || status === 0)
    return bodyErr
      ? `Telegram server error: ${bodyErr}`
      : "Unable to contact the Telegram server. Check your connection and try again.";
  return bodyErr || error?.message || "Could not generate a linking code. Please try again.";
}

/** Live mm:ss countdown to an ISO expiry — ticks every second, no polling. */
function LinkCodeCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (remaining <= 0) return <span className="text-danger">expired — tap Generate New Code</span>;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  return <span>{mm}:{ss}</span>;
}

function AlertsTab({ orgId, notifications, hasPermission }: { orgId: string | null; notifications: any[]; hasPermission: (perm: string) => boolean }) {
  const isAdmin = hasPermission("org.manage");
  const [connState, setConnState] = useState<TgConnState>({ phase: "loading" });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Engine alerts (local)
  const [engineAlerts, setEngineAlerts] = useState<any[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);

  // Load connection status once, then keep it live via Supabase realtime (no polling)
  useEffect(() => {
    let active = true;
    async function checkConnection() {
      try {
        const sb = await getSupabase();
        // Only safe display fields — never select chat_id / telegram_user_id.
        const { data } = await sb
          .from("telegram_connections")
          .select("connected, chat_name, tg_username, connected_at")
          .maybeSingle();
        if (!active) return;
        if (data?.connected) {
          setConnState({
            phase: "connected",
            chatName: data.chat_name ?? data.tg_username ?? "Telegram",
            username: data.tg_username ?? undefined,
            connectedAt: data.connected_at ?? undefined,
          });
        } else {
          setConnState({ phase: "idle" });
        }
      } catch {
        if (active) setConnState({ phase: "idle" });
      }
    }
    checkConnection();

    // Realtime: flip to "connected" immediately when the bot processes the /start
    let channel: any;
    (async () => {
      const sb = await getSupabase();
      channel = sb
        .channel("tg-conn-watch")
        .on(
          // INSERT *and* UPDATE: the bot upserts the connection when a code is
          // redeemed, so a first-ever link arrives as an INSERT, a re-link as
          // an UPDATE. Listening only for UPDATE would miss the first connect.
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "telegram_connections" },
          (payload: any) => {
            if (!active) return;
            const row = payload.new;
            if (row?.connected) {
              // Linked (or re-linked) — flip to Connected with no refresh.
              setConnState({
                phase: "connected",
                chatName: row.chat_name ?? row.tg_username ?? "Telegram",
                username: row.tg_username ?? undefined,
                connectedAt: row.connected_at ?? undefined,
              });
            } else if (row && !row.connected) {
              // Unlinked elsewhere (e.g. the bot's /disconnect) — reflect it live.
              setConnState((prev) => (prev.phase === "connected" ? { phase: "idle" } : prev));
            }
          }
        )
        .subscribe();
    })();

    return () => {
      active = false;
      (async () => {
        const sb = await getSupabase();
        if (channel) sb.removeChannel(channel);
      })();
    };
  }, [orgId]);

  // Load engine alerts directly from local engine (no Supabase)
  useEffect(() => {
    let active = true;
    async function fetchAlerts() {
      try {
        const res = await fetch("http://127.0.0.1:8000/api/alerts?limit=50", {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (active) setEngineAlerts(Array.isArray(data) ? data.slice(0, 50) : []);
      } catch { /* engine offline */ } finally {
        if (active) setAlertsLoading(false);
      }
    }
    fetchAlerts();
    const id = setInterval(fetchAlerts, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Mint a fresh, single-use connection code (server-side, cryptographically
  // random). "Generate New Code" invalidates the previous one automatically.
  async function getCode() {
    setGenerating(true);
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.functions.invoke<{
        ok: boolean; code: string; expires_at: string; bot_username: string; deep_link?: string;
      }>("telegram-link-code", { body: {} });
      if (error || !data?.ok) {
        setConnState({ phase: "error", msg: await friendlyConnectError(error, data) });
        return;
      }
      const botUsername = data.bot_username || "CamAiAdmin_bot";
      setConnState({
        phase: "code",
        code: data.code,
        expiresAt: data.expires_at,
        botUsername,
        // Prefer the server-built deep link; fall back to constructing it so an
        // older backend (no deep_link field) still gets one-tap connect.
        deepLink: data.deep_link || `https://t.me/${botUsername}?start=${data.code}`,
      });
    } catch (e) {
      setConnState({ phase: "error", msg: e instanceof Error ? e.message : "Unable to contact the Telegram server. Check your connection and try again." });
    } finally {
      setGenerating(false);
    }
  }

  async function disconnect() {
    const sb = await getSupabase();
    await sb.from("telegram_connections").update({
      connected: false,
      chat_id: null,
      chat_name: null,
      updated_at: new Date().toISOString(),
    });
    setConnState({ phase: "idle" });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can still read the code */ }
  }

  return (
    <div className="space-y-5">
      {/* Telegram Connect Card */}
      <div className="rounded-xl border border-line bg-surface-1 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
            <MessageCircle size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-zinc-100">Telegram Alerts</div>
            <div className="text-[10px] text-zinc-500">
              {connState.phase === "connected"
                ? `Connected · ${connState.chatName}`
                : "Send a one-time code to connect Telegram"}
            </div>
          </div>
          {connState.phase === "connected" && (
            <span className="flex items-center gap-1 rounded-full bg-ok/15 px-2 py-0.5 text-[10px] font-semibold text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok inline-block" />
              LIVE
            </span>
          )}
        </div>

        <div className="px-4 py-4">
          {connState.phase === "loading" && (
            <div className="flex items-center gap-2 py-4 text-sm text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Checking…
            </div>
          )}

          {!isAdmin && connState.phase !== "loading" && connState.phase !== "connected" && (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800/50 text-zinc-500 mb-3 border border-line">
                <Lock size={16} />
              </div>
              <div className="text-sm font-semibold text-zinc-300">Configuration Locked</div>
              <p className="text-xs text-zinc-500 max-w-sm mt-1 leading-relaxed">
                Telegram alerts are not connected. Only organization admins with <code className="bg-black/30 px-1 rounded text-accent">org.manage</code> permission can link a Telegram account.
              </p>
            </div>
          )}

          {connState.phase === "connected" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-ok/30 bg-ok/5 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-ok">
                  <Check size={16} /> Telegram Connected
                </div>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Connected Account</dt>
                    <dd className="font-medium text-zinc-200">
                      {connState.username ? `@${connState.username}` : connState.chatName}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-32 shrink-0 text-zinc-500">Connected At</dt>
                    <dd className="font-medium text-zinc-200">
                      {connState.connectedAt ? new Date(connState.connectedAt).toLocaleString() : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] text-zinc-400">
                  AI alerts are delivered to this chat automatically — no commands needed.
                </p>
              </div>
              {isAdmin ? (
                <button
                  onClick={disconnect}
                  className="text-xs text-zinc-500 hover:text-danger hover:underline"
                >
                  Disconnect this chat
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Lock size={12} />
                  <span>Only admins can disconnect this chat</span>
                </div>
              )}
            </div>
          )}

          {isAdmin && (connState.phase === "idle" || connState.phase === "error") && (
            <div className="space-y-3">
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] text-sky-300 leading-relaxed">
                <div className="font-semibold mb-1">How it works:</div>
                <ol className="list-decimal list-inside space-y-0.5 text-zinc-400">
                  <li>Click <strong className="text-zinc-200">Connect Telegram</strong> to get a one-time code.</li>
                  <li>Tap <strong className="text-zinc-200">Open in Telegram &amp; Connect</strong> — it sends the code for you (or send <code className="bg-black/30 px-1 rounded text-accent">/start YOUR_CODE</code> to <strong className="text-zinc-200">@CamAiAdmin_bot</strong> manually).</li>
                  <li>This app flips to <strong className="text-zinc-200">Connected ✅</strong> instantly — no refresh.</li>
                </ol>
              </div>
              {connState.phase === "error" && (
                <p className="text-[11px] text-danger">{connState.msg}</p>
              )}
              <button
                onClick={getCode}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/80 disabled:opacity-60"
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}
                Connect Telegram
              </button>
            </div>
          )}

          {connState.phase === "code" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface-0 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-500">Telegram Bot</span>
                  <a
                    href={`https://t.me/${connState.botUsername}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm font-medium text-sky-400 hover:underline"
                  >
                    <MessageCircle size={13} /> @{connState.botUsername}
                  </a>
                </div>

                <div>
                  <div className="text-xs text-zinc-500 mb-1">Connection Code</div>
                  <button
                    onClick={() => copyCode(connState.code)}
                    title="Click to copy"
                    className="group w-full rounded-lg border-2 border-sky-500/30 bg-sky-500/5 px-4 py-3 text-center shadow-lg transition hover:border-sky-500/60"
                  >
                    <span className="font-mono text-3xl font-bold tracking-[0.3em] text-zinc-100 pl-[0.3em]">
                      {connState.code}
                    </span>
                  </button>
                </div>

                {/* One-tap connect: opening the deep link sends "/start CODE" to
                    the bot automatically — no typing. This app flips to
                    Connected the moment the bot redeems the code. */}
                <a
                  href={connState.deepLink}
                  target="_blank" rel="noreferrer"
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-sky-400"
                >
                  <Send size={15} /> Open in Telegram &amp; Connect
                </a>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">Expires in</span>
                  <span className="font-mono font-semibold text-zinc-200">
                    <LinkCodeCountdown expiresAt={connState.expiresAt} />
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    onClick={() => copyCode(connState.code)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-zinc-300 hover:bg-surface-2"
                  >
                    {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={getCode}
                    disabled={generating}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-zinc-400 hover:bg-surface-2 disabled:opacity-50"
                  >
                    <RotateCw size={13} className={generating ? "animate-spin" : ""} /> Generate New Code
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-[11px] leading-relaxed text-zinc-400">
                Tap <strong className="text-zinc-200">Open in Telegram &amp; Connect</strong> above — it sends the code for you.
                Or open <strong className="text-zinc-200">@{connState.botUsername}</strong> manually and send{" "}
                <code className="bg-black/30 px-1 rounded text-sky-300">/start {connState.code}</code>.
                This app connects automatically.
              </div>

              <div className="text-center text-[10px] text-zinc-600">
                Waiting for you to connect… this app updates automatically
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live Alert Feed */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Recent Detections</h3>
          <span className="text-[10px] text-zinc-600">Local engine · refreshes every 5s</span>
        </div>

        {alertsLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
            <Loader2 size={14} className="animate-spin" /> Loading alerts…
          </div>
        ) : engineAlerts.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface-1 px-4 py-8 text-center">
            <Bell size={28} className="mx-auto mb-2 text-zinc-600" />
            <div className="text-sm text-zinc-500">No detections yet.</div>
            <div className="mt-1 text-xs text-zinc-600">Alerts appear here when a camera detects something in a zone.</div>
          </div>
        ) : (
          <div className="space-y-2">
            {engineAlerts.map((a) => {
              let d: Record<string, unknown> = {};
              try { d = a.detail ? JSON.parse(a.detail) : (a.detail ?? {}); } catch { /* */ }
              const severity = (d.severity as string) || "info";
              const colorClass = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
              const icon = SEVERITY_ICON[severity] ?? "🔔";
              const name = (d.detection_name as string) || a.alert_type?.replace(/_/g, " ") || "Detection";
              return (
                <div key={a.id} className={`rounded-lg border px-3 py-2.5 ${colorClass}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold capitalize">{icon} {name}</div>
                      <div className="mt-0.5 text-[10px] opacity-80 truncate">{a.message}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] opacity-70">{new Date(a.timestamp).toLocaleTimeString()}</div>
                      {typeof d.confidence === "number" && (
                        <div className="text-[10px] opacity-70">{Math.round((d.confidence as number) * 100)}%</div>
                      )}
                    </div>
                  </div>
                  {a.screenshot_path && (
                    <div className="mt-2">
                      <img
                        src={`http://127.0.0.1:8000${a.screenshot_path}`}
                        alt="Snapshot"
                        className="w-full max-h-40 object-contain rounded border border-black/30 bg-black/20"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

