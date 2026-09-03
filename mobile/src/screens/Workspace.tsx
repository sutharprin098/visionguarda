import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { Video, Bell, Settings2, LogOut, Wifi, WifiOff, Sliders, Activity, AlertTriangle, RotateCw, Maximize2, Minimize2, Lock, Send, Check, Loader2, MessageCircle, ChevronDown, ChevronRight, Copy, Cloud, Cpu, Globe, Plus, MoreVertical } from "lucide-react";
import clsx from "clsx";
import { startRealtimeSync, DeactivatedError, SyncBundle } from "../lib/sync";
import { syncAiModelToLocalEngine, syncAiConfidenceToLocalEngine, syncAiInferenceModeToLocalEngine, mjpegStreamUrl, resetLocalEngineState, getEngineBase, getDecryptedCameraSource } from "../lib/localEngine";
import { MediaShareSession, ShareStatus } from "../lib/mediaShare";
import { TelemetrySession, TelemetryDetection, CameraTelemetry, TelemetryStatus, detectionsRenderEqual, telemetryHub } from "../lib/telemetry";
import type { ZoneProfileKey } from "../lib/zoneProfiles";
import DetectionOverlay from "../components/DetectionOverlay";
import PerformanceOverlay from "../components/PerformanceOverlay";
import FullscreenViewer from "../components/FullscreenViewer";
import ProfileDashboard from "../components/ProfileDashboard";
import SourcePicker from "../components/SourcePicker";
import AddCameraModal from "../components/AddCameraModal";
import SettingsMenuModal from "../components/SettingsMenuModal";
import FallbackTileLiveFeedShared from "../components/FallbackTileLiveFeed";
import { lockReason } from "../lib/rbac";
import { getSupabase } from "../lib/session";
import type { CaptureSource } from "../lib/bridge";
import {
  ModuleState, loadModules, filterDetections,
} from "../lib/aiModules";
import { useAlertIngest, useAlertState } from "../components/alerts/AlertProvider";
import { siteLabel } from "../components/alerts/alertUtils";
import AlertsPage from "../components/alerts/AlertsPage";
import { getTelegramConfig, invalidateTelegramConfig, sendTelegramTest } from "../lib/localTelegram";

// Remembered across launches by name, not id — see startSharing().
const LAST_SOURCE_KEY = "camai.lastCaptureSource";

// How often the tile's fps readout may force a re-render. The number is shown
// to one decimal in a status line; refreshing it at telemetry rate (10-15Hz)
// costs a full subtree render per camera per frame to change a digit faster
// than anyone can read it. 500ms still reads as live.
const FPS_COMMIT_INTERVAL_MS = 500;
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
  openLiveCam,
  openAlertsSignal,
}: {
  bundle: SyncBundle;
  onDeactivated: () => void;
  /** Undefined when this user lacks cameras.manage — App decides, from the
   *  user's permissions rather than from which build is running. */
  onOpenAdminStudio?: () => void;
  /** "Open Live Feed" clicked from an alert row (this screen, or Admin
   *  Studio's bell). A nonce because the operator can click the same
   *  camera's card twice in a row and both have to reopen the fullscreen
   *  viewer, not just the first. */
  openLiveCam?: { id: string; nonce: number } | null;
  /** The notification bell, wherever it was clicked, asked to land on the
   *  Alerts tab. A nonce for the same reason as openLiveCam. */
  openAlertsSignal?: { nonce: number } | null;
}) {
  const [tab, setTab] = useState<"cameras" | "alerts">("cameras");
  // Which camera is showing full-window, or null. Lifted to Workspace (not the
  // tile) because the viewer has to cover the sidebar and the tab bar, and
  // because switching camera while fullscreen has to keep the SAME viewer
  // mounted — a per-tile fullscreen element cannot do either.
  const [fullscreenCamId, setFullscreenCamId] = useState<string | null>(null);

  // An alert row's "Open Live Feed" can send an operator here to see the
  // camera live — keyed by nonce, not just id, so clicking the same camera's
  // card twice in a row reopens the viewer both times rather than the second
  // click being a no-op dependency change.
  useEffect(() => {
    if (openLiveCam) setFullscreenCamId(openLiveCam.id);
  }, [openLiveCam]);

  useEffect(() => {
    if (openAlertsSignal) setTab("alerts");
  }, [openAlertsSignal]);

  const { unacked: unackedAlerts, events: alerts } = useAlertState();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [showExitToast, setShowExitToast] = useState(false);
  const lastBackPressRef = useRef(0);

  // Prevent app exit on Android Back Button press
  useEffect(() => {
    let backListener: any = null;

    const setupBackButton = async () => {
      try {
        const { App: CapApp } = await import("@capacitor/app");
        backListener = await CapApp.addListener("backButton", () => {
          // 1. If Fullscreen Viewer is open, close it
          if (fullscreenCamId) {
            setFullscreenCamId(null);
            return;
          }

          // 2. If Add Camera Modal is open, close it
          if (isAddModalOpen) {
            setIsAddModalOpen(false);
            return;
          }

          // 3. If Settings Modal is open, close it
          if (isSettingsOpen) {
            setIsSettingsOpen(false);
            return;
          }

          // 4. If in Alerts tab, switch back to Cameras tab
          if (tab !== "cameras") {
            setTab("cameras");
            return;
          }

          // 5. On root Cameras view: Minimize app to background (do not terminate app process)
          CapApp.minimizeApp();
        });
      } catch (e) {
        console.warn("Capacitor App backButton listener:", e);
      }
    };

    void setupBackButton();

    return () => {
      if (backListener && typeof backListener.remove === "function") {
        backListener.remove();
      }
    };
  }, [fullscreenCamId, isAddModalOpen, isSettingsOpen, tab]);

  const prevAlertCountRef = useRef(alerts?.length ?? 0);
  useEffect(() => {
    if (alerts && alerts.length > prevAlertCountRef.current) {
      const latest = alerts[0];
      if (latest) {
        import("../lib/notifications").then(({ sendDesktopSystemNotification }) => {
          sendDesktopSystemNotification(
            `🚨 ${latest.cameraName || "Camera"} Alert`,
            `AI Detection: ${latest.def?.title || "Security Event"} detected at ${new Date(latest.ts).toLocaleTimeString()}`,
            latest.def?.title || "intrusion"
          );
        });
      }
    }
    prevAlertCountRef.current = alerts?.length ?? 0;
  }, [alerts]);

  const [syncError, setSyncError] = useState(false);
  const [syncErrorDetails, setSyncErrorDetails] = useState<string | null>(null);
  const [isPackaged, setIsPackaged] = useState(true);
  const [healthInfo, setHealthInfo] = useState<EngineHealthInfo | null>(null);
  const [procStatus, setProcStatus] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [consecutiveMisses, setConsecutiveMisses] = useState(0);

  const activeProfile = bundle?.settings?.find((s) => s.scope === "org" && s.key === "ai.profile")?.value || "Traffic";

  useEffect(() => {
    let cancelled = false;

    // Fetch supervisor logs in real-time
    window.camai.engine.getLogs().then((l) => !cancelled && setLogs(l.slice(-100)));
    const offLog = window.camai.engine.onLog((line) => {
      if (!cancelled) setLogs((prev) => [...prev.slice(-99), line]);
    });

    const HEALTH_TIMEOUT_MS = 12000;
    const POLL_AFTER_OK_MS = 2000;
    const POLL_AFTER_FAIL_MS = 1500;
    const MISSES_BEFORE_OFFLINE = 5;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let misses = 0;

    const tick = async () => {
      if (cancelled) return;
      let ok = false;

      if (telemetryHub.isConnected()) {
        ok = true;
        misses = 0;
        if (!cancelled) {
          setHealthInfo((prev) => ({
            online: true,
            status: "ok",
            ready: true,
            engine_status: prev?.engine_status || "ready",
            engine_error: null,
            model_loaded: true,
            active_cameras: prev?.active_cameras || (bundle?.cameras?.length ?? 0),
          }));
          setConsecutiveMisses(0);
        }
      } else {
        try {
          const res = await fetch(`${getEngineBase()}/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            cache: "no-store",
          });
          if (res.ok) {
            const data = await res.json();
            ok = true;
            misses = 0;
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
          }
        } catch { /* counted below */ }
      }

      if (!ok && !cancelled) {
        misses += 1;
        setConsecutiveMisses(misses);
        if (misses >= MISSES_BEFORE_OFFLINE) {
          setHealthInfo({
            online: false,
            status: "unreachable",
            ready: false,
            engine_status: "failed",
            engine_error: `No response from the engine on port 8000 after ${misses} attempts (${HEALTH_TIMEOUT_MS / 1000}s each).`,
            model_loaded: false,
            active_cameras: 0,
          });
        }
      }

      try {
        const s = await window.camai.engine.getStatus();
        if (!cancelled) setProcStatus(s);
      } catch { /* bridge unavailable */ }

      if (!cancelled) {
        timer = setTimeout(tick, ok ? POLL_AFTER_OK_MS : POLL_AFTER_FAIL_MS);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      offLog();
    };
  }, []);

  useEffect(() => {
    window.camai.getConfig().then((cfg) => setIsPackaged(cfg.isPackaged));
  }, []);

  async function deactivate() {
    resetLocalEngineState();
    await window.camai.deactivate();
    onDeactivated();
  }

  const orgModel = bundle?.settings.find((s) => s.scope === "org" && s.key === "ai.model")?.value;
  useEffect(() => {
    if (!bundle || !orgModel || typeof orgModel !== "string") return;

    let active = true;
    const pkg = bundle.ai_model_packages?.find((p: any) => p.name === orgModel);
    
    async function checkAndDownload() {
      if (!pkg) {
        void syncAiModelToLocalEngine(orgModel);
        return;
      }

      try {
        if (typeof (window as any).camai?.getDownloadStatus === "function") {
          const statusRes = await (window as any).camai.getDownloadStatus({ modelName: pkg.name });
          if (statusRes?.ok) {
            if (statusRes.status === "complete") {
              void syncAiModelToLocalEngine(orgModel);
            } else if (statusRes.status !== "downloading" && typeof (window as any).camai?.downloadModel === "function") {
              await (window as any).camai.downloadModel({
                url: pkg.download_url,
                modelName: pkg.name,
                expectedChecksum: pkg.checksum,
                signature: pkg.signature,
              });
            }
          }
        } else {
          void syncAiModelToLocalEngine(orgModel);
        }
      } catch (err) {
        console.error("[Background Sync] Failed to sync model:", err);
      }
    }

    void checkAndDownload();

    let unsub: (() => void) | undefined;
    if (typeof (window as any).camai?.onDownloadProgress === "function") {
      unsub = (window as any).camai.onDownloadProgress(orgModel, (progress: any) => {
        if (active && progress.status === "complete") {
          void syncAiModelToLocalEngine(orgModel);
        }
      });
    }

    return () => {
      active = false;
      if (typeof unsub === "function") unsub();
    };
  }, [orgModel, bundle?.ai_model_packages]);

  const orgConfidence = bundle?.settings.find((s) => s.scope === "org" && s.key === "ai.confidence")?.value;
  useEffect(() => {
    if (orgConfidence == null) return;
    void syncAiConfidenceToLocalEngine(orgConfidence);
    const id = setInterval(() => void syncAiConfidenceToLocalEngine(orgConfidence), 8_000);
    return () => clearInterval(id);
  }, [orgConfidence]);

  // Permanently Enforce AWS Cloud GPU AI Mode
  const orgInferenceMode: "cloud" | "local" = "cloud";
  const orgCloudUrl = "http://13.203.71.14:8000";
  useEffect(() => {
    void syncAiInferenceModeToLocalEngine("cloud", orgCloudUrl);
    const id = setInterval(() => void syncAiInferenceModeToLocalEngine("cloud", orgCloudUrl), 5_000);
    return () => clearInterval(id);
  }, []);

  const hasPermission = (perm: string): boolean => {
    if (!bundle) return false;
    if (bundle.profile?.is_super_admin) return true;
    return (
      Array.isArray(bundle.permissions) &&
      (bundle.permissions.includes(perm) || (perm.startsWith("maps.") && bundle.permissions.includes("cameras.manage")))
    );
  };

  const allowedTabs = bundle
    ? ([
        (hasPermission("cameras.manage") || hasPermission("cameras.assign")) && "cameras",
        hasPermission("alerts.view") && "alerts",
      ].filter(Boolean) as ("cameras" | "alerts")[])
    : [];

  useEffect(() => {
    if (bundle && allowedTabs.length > 0 && !allowedTabs.includes(tab as any)) {
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
    (bundle.settings ?? []).filter((s) => s.scope === "org").map((s) => [s.key, s.value]),
  );

  const navItems = ([
    { id: "cameras", label: `Cameras (${bundle.cameras?.length ?? 0})`, icon: Video },
    { id: "alerts", label: `Alerts (${bundle.notifications?.length ?? 0})`, icon: Bell },
  ] as const).filter((item) => allowedTabs.includes(item.id));

  return (
    // AlertProvider is mounted once in App.tsx, wrapping both this screen and
    // Admin Studio — this screen ingests telemetry into it (see the
    // useAlertIngest() calls in the camera tiles below) and is the only place
    // any alert is ever shown, on the Alerts tab (see AlertsPage.tsx).
    <div className="flex h-screen flex-col md:flex-row bg-surface-0 overflow-hidden">
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

      {/* MOBILE TOP BAR (visible only on small screens < md) */}
      <header className="flex md:hidden items-center justify-between border-b border-line bg-surface-1/95 px-4 pt-8 pb-3.5 shrink-0 backdrop-blur-md w-full max-w-full">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="./favicon.svg" alt="CamAI" className="h-7 w-7 rounded-md shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-zinc-100 truncate">CamAI Mobile Security</div>
            <div className="truncate text-[10px] text-zinc-400">{bundle.organization?.name}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800 text-[10px] text-blue-400 font-medium">
            <Cloud size={12} className="animate-pulse" />
            <span className="hidden sm:inline">AWS Cloud GPU</span>
          </div>

          {allowedTabs.includes("alerts") && (
            <button
              onClick={() => setTab("alerts")}
              title={unackedAlerts > 0 ? `${unackedAlerts} unacknowledged alert${unackedAlerts === 1 ? "" : "s"}` : "Alerts"}
              className="relative shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-surface-2 hover:text-zinc-200"
            >
              <Bell size={18} />
              {unackedAlerts > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                  {unackedAlerts > 99 ? "99+" : unackedAlerts}
                </span>
              )}
            </button>
          )}

          <button
            className="text-zinc-400 hover:text-zinc-100 p-1.5 rounded-md hover:bg-surface-2 transition"
            title="Settings & App Updates"
            onClick={() => setIsSettingsOpen(true)}
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </header>

      {/* DESKTOP SIDEBAR (visible only on md and larger) */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <img src="./favicon.svg" alt="CamAI" className="h-8 w-8 rounded-md" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-zinc-100">CamAI Mobile Security</div>
            <div className="truncate text-xs text-zinc-500">{bundle.organization?.name}</div>
          </div>
          {allowedTabs.includes("alerts") && (
            <button
              onClick={() => setTab("alerts")}
              title={unackedAlerts > 0 ? `${unackedAlerts} unacknowledged alert${unackedAlerts === 1 ? "" : "s"}` : "Alerts"}
              className="relative shrink-0 rounded-md p-1.5 text-zinc-400 transition hover:bg-surface-2 hover:text-zinc-200"
            >
              <Bell size={16} />
              {unackedAlerts > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-semibold text-white">
                  {unackedAlerts > 99 ? "99+" : unackedAlerts}
                </span>
              )}
            </button>
          )}
        </div>
        <div className="px-3 pb-3 pt-1 border-b border-line">
          <div className="flex items-center justify-between gap-2 bg-surface-2/80 px-3 py-2 rounded-lg border border-line/80 text-xs">
            {(orgInferenceMode as string) === "local" ? (
              <div className="flex items-center gap-2 text-accent font-semibold">
                <Cpu size={14} className="animate-pulse" />
                <span>Local Hardware</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-blue-400 font-semibold">
                <Cloud size={14} className="animate-pulse" />
                <span>AWS Cloud GPU</span>
              </div>
            )}
            <span className="text-[10px] text-zinc-500 bg-surface-1 px-1.5 py-0.5 rounded border border-line" title="AI Inference Engine Mode is managed centrally by Organization Admins via Web Portal">
              Admin Managed
            </span>
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

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 pb-28 md:pb-6 w-full max-w-full">
        <div style={{ display: tab === "cameras" ? "block" : "none" }}>
          <CamerasView
            cameras={bundle.cameras}
            orgName={bundle.organization?.name ?? null}
            orgId={bundle.organization?.id ?? null}
            isPackaged={isPackaged}
            healthInfo={healthInfo}
            procStatus={procStatus}
            logs={logs}
            onFullscreen={setFullscreenCamId}
            paused={fullscreenCamId !== null}
            orgInferenceMode={orgInferenceMode}
            isAddModalOpen={isAddModalOpen}
            setIsAddModalOpen={setIsAddModalOpen}
          />
        </div>
        {tab === "alerts" && (
          <AlertsTab orgId={bundle.organization?.id ?? null} hasPermission={hasPermission} active={true} />
        )}
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR (fixed at bottom for phones < md) */}
      <div className="flex md:hidden fixed bottom-0 inset-x-0 z-40 bg-zinc-950/95 backdrop-blur-xl border-t border-zinc-800/90 py-2 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] justify-around items-center shadow-2xl">
        <button
          onClick={() => setTab("cameras")}
          className={clsx(
            "flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition",
            tab === "cameras" ? "text-accent bg-accent/10 font-bold" : "text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Video size={18} />
          <span className="text-[10px]">Cameras</span>
        </button>

        {allowedTabs.includes("alerts") && (
          <button
            onClick={() => setTab("alerts")}
            className={clsx(
              "flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition relative",
              tab === "alerts" ? "text-accent bg-accent/10 font-bold" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            <Bell size={18} />
            <span className="text-[10px]">Alerts</span>
            {unackedAlerts > 0 && (
              <span className="absolute top-1 right-2 flex h-2 w-2 rounded-full bg-danger animate-pulse" />
            )}
          </button>
        )}

        {hasPermission("cameras.manage") && onOpenAdminStudio && (
          <button
            onClick={onOpenAdminStudio}
            className="flex flex-col items-center gap-1 py-1 px-3 rounded-xl text-sky-400 hover:text-sky-300 transition"
          >
            <Sliders size={18} />
            <span className="text-[10px]">Studio</span>
          </button>
        )}

        <button
          onClick={() => setIsSettingsOpen(true)}
          className="flex flex-col items-center gap-1 py-1 px-3 rounded-xl text-zinc-400 hover:text-zinc-100 transition"
        >
          <MoreVertical size={18} />
          <span className="text-[10px]">Settings</span>
        </button>
      </div>

      <SettingsMenuModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSignOut={deactivate}
      />

      {/* Double Tap Back Button Exit Toast Notification */}
      {showExitToast && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[250] flex items-center gap-2.5 rounded-2xl border border-sky-300/40 bg-slate-900/95 px-5 py-3 text-xs font-extrabold text-sky-200 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4">
          <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
          <span>Press back again to exit CamAI</span>
        </div>
      )}
    </div>
  );
}

function InteractiveAiSettingsPanel({
  orgId,
  aiSettings,
}: {
  orgId: string | null;
  aiSettings: Record<string, any>;
}) {
  const [profile, setProfile] = useState<string>(aiSettings["ai.profile"] || "General Security");
  const [activeClasses, setActiveClasses] = useState<string[]>(
    Array.isArray(aiSettings["ai.classes"]) && aiSettings["ai.classes"].length > 0
      ? aiSettings["ai.classes"]
      : ["person", "vehicle", "car", "bus", "dog", "rodent", "micro_motion"]
  );
  const [saving, setSaving] = useState(false);

  const availableClasses = [
    { id: "person", label: "👤 Person / Human", desc: "Detect people and individuals" },
    { id: "vehicle", label: "🚗 Vehicles & Transport", desc: "Cars, trucks, buses, bikes" },
    { id: "car", label: "🚘 Cars", desc: "Standard passenger vehicles" },
    { id: "bus", label: "🚌 Buses & Heavy Vehicles", desc: "Large commercial transport" },
    { id: "dog", label: "🐕 Animals / Pets", desc: "Dogs, cats, domestic animals" },
    { id: "rodent", label: "🐀 Rodents / Pests", desc: "Small pest motion in darkness" },
    { id: "micro_motion", label: "🌙 Night Micro-Motion", desc: "Low-contrast night vector movement" },
    { id: "intrusion", label: "🚨 ROI Breach / Intrusion", desc: "Zone violation alarms" },
  ];

  const profiles = [
    { id: "General Security", label: "🛡️ General Security", classes: ["person", "vehicle", "car", "bus", "dog", "rodent", "micro_motion", "intrusion"] },
    { id: "Traffic & Transport", label: "🚦 Traffic & Vehicles", classes: ["vehicle", "car", "bus", "person"] },
    { id: "Perimeter Shield", label: "🚨 Perimeter Shield", classes: ["person", "intrusion", "micro_motion"] },
    { id: "Night Vision Mode", label: "🌙 Night Vision & Micro-Motion", classes: ["person", "rodent", "micro_motion"] },
  ];

  async function toggleClass(clsId: string) {
    const next = activeClasses.includes(clsId)
      ? activeClasses.filter((c) => c !== clsId)
      : [...activeClasses, clsId];
    setActiveClasses(next);
    await saveSettings(profile, next);
  }

  async function selectProfile(p: typeof profiles[0]) {
    setProfile(p.id);
    setActiveClasses(p.classes);
    await saveSettings(p.id, p.classes);
  }

  async function saveSettings(nextProfile: string, nextClasses: string[]) {
    if (!orgId) return;
    setSaving(true);
    try {
      const sb = await getSupabase();
      await sb.from("settings").upsert([
        { org_id: orgId, scope: "org", key: "ai.profile", value: nextProfile },
        { org_id: orgId, scope: "org", key: "ai.classes", value: nextClasses },
      ], { onConflict: "org_id,scope,key" });
    } catch {
      /* local optimistic state maintained */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile Selector */}
      <div className="rounded-xl border border-gray-800 bg-surface-1 p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-gray-100">AI Detection Profile</h3>
            <p className="text-xs text-gray-400">Select pre-configured AI detection rules for your cameras</p>
          </div>
          <span className="flex items-center space-x-1 rounded bg-blue-950 px-2.5 py-1 text-[11px] font-semibold text-blue-400 border border-blue-800">
            <Cloud className="h-3.5 w-3.5 animate-pulse" />
            <span>AWS Cloud GPU Active</span>
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => selectProfile(p)}
              className={`flex flex-col text-left p-3.5 rounded-lg border transition-all ${
                profile === p.id
                  ? "bg-cyan-950/60 border-cyan-500 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                  : "bg-surface-2/60 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200"
              }`}
            >
              <span className="font-semibold text-xs text-gray-200">{p.label}</span>
              <span className="text-[10px] text-gray-400 mt-1">{p.classes.length} detection rules enabled</span>
            </button>
          ))}
        </div>
      </div>

      {/* Target Detection Classes Toggle Grid */}
      <div className="rounded-xl border border-gray-800 bg-surface-1 p-5 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-gray-100">Target Detection Classes</h3>
            <p className="text-xs text-gray-400">Click any class below to enable or disable live AI bounding boxes</p>
          </div>
          {saving && <span className="text-xs text-cyan-400 animate-pulse">Syncing...</span>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {availableClasses.map((c) => {
            const active = activeClasses.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleClass(c.id)}
                className={`flex items-start space-x-3 p-3 rounded-lg border text-left transition-all ${
                  active
                    ? "bg-emerald-950/50 border-emerald-500/80 text-emerald-200"
                    : "bg-surface-2/40 border-gray-800/80 text-gray-500 hover:border-gray-700"
                }`}
              >
                <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  active ? "bg-emerald-500 border-emerald-400 text-black" : "border-gray-600 bg-gray-900"
                }`}>
                  {active && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-200">{c.label}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{c.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Confidence Control */}
      <div className="rounded-xl border border-gray-800 bg-surface-1 p-5 shadow-xl">
        <ConfidenceControl
          orgId={orgId}
          value={typeof aiSettings["ai.confidence"] === "number" ? aiSettings["ai.confidence"] : 0.25}
          canEdit={true}
        />
      </div>
    </div>
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
  mode?: string;
  processing_mode?: string;
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
  orgId,
  isPackaged,
  healthInfo,
  procStatus,
  logs,
  onFullscreen,
  paused,
  orgInferenceMode,
  isAddModalOpen,
  setIsAddModalOpen,
}: {
  cameras: any[];
  orgName: string | null;
  orgId?: string | null;
  isPackaged: boolean;
  healthInfo: EngineHealthInfo | null;
  procStatus: any;
  logs: string[];
  onFullscreen: (id: string) => void;
  /** The fullscreen viewer is covering the grid — see CameraTile. */
  paused: boolean;
  orgInferenceMode?: string;
  isAddModalOpen: boolean;
  setIsAddModalOpen: (open: boolean) => void;
}) {
  const handleCameraAdded = async () => {
    try {
      const { fetchBundle } = await import("../lib/sync");
      const { syncCamerasToLocalEngine } = await import("../lib/localEngine");
      const freshBundle = await fetchBundle();
      if (freshBundle?.cameras) {
        await syncCamerasToLocalEngine(freshBundle.cameras, freshBundle.rule_engine_rules || [], freshBundle.zone_profile_configs || []);
      }
    } catch {
      window.location.reload();
    }
  };

  const isCloudMode = orgInferenceMode === "cloud" || healthInfo?.mode === "cloud" || (healthInfo as any)?.processing_mode === "cloud";
  const isEngineOffline = healthInfo !== null && !isCloudMode && (!healthInfo.online || !healthInfo.ready);

  if (!Array.isArray(cameras) || !cameras.length) {
    return (
      <div className="space-y-4 w-full">
        {isEngineOffline && (
          <EngineDiagnosticPanel healthInfo={healthInfo} procStatus={procStatus} logs={logs} isPackaged={isPackaged} />
        )}
        <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-line bg-surface-1 p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent mb-3">
            <Video size={28} />
          </div>
          <h3 className="text-base font-semibold text-zinc-100">No Cameras Added Yet</h3>
          <p className="text-xs text-zinc-400 mt-1 max-w-sm">
            Connect your Wi-Fi IP camera or RTSP stream to start real-time AI security detection.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-accent/80 transition mt-4"
          >
            <Plus size={15} /> Add Camera (Wi-Fi / RTSP)
          </button>
        </div>
        <AddCameraModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          orgId={orgId}
          onCameraAdded={handleCameraAdded}
        />
      </div>
    );
  }

  const gridLayoutClass =
    cameras.length === 1
      ? "grid-cols-1 w-full"
      : cameras.length === 2
      ? "grid-cols-1 lg:grid-cols-2 gap-4"
      : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4";

  return (
    <div className="space-y-4 w-full">
      {isEngineOffline && (
        <EngineDiagnosticPanel healthInfo={healthInfo} procStatus={procStatus} logs={logs} isPackaged={isPackaged} />
      )}
      
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-line bg-surface-1 px-3.5 py-2.5 w-full max-w-full overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap">
          <Video size={16} className="text-accent shrink-0" />
          <span className="text-xs sm:text-sm font-semibold text-zinc-100 truncate">
            {cameras.length === 1 ? `Live Camera: ${cameras[0]?.name || "Camera"}` : `Active Cameras (${cameras.length})`}
          </span>
          {isCloudMode && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-blue-400 border border-blue-500/30 shrink-0">
              ☁️ Cloud Active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-accent/80 transition"
            title="Add a new Wi-Fi or RTSP IP camera"
          >
            <Plus size={14} /> <span>Add Camera</span>
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded bg-surface-2 border border-line px-2.5 py-1.5 text-xs font-semibold text-zinc-200 shadow hover:bg-surface-3 transition"
            title="Sync & Refresh workspace configuration from database"
          >
            <RotateCw size={13} /> <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={() => onFullscreen(cameras[0].id)}
            className="inline-flex items-center gap-1.5 rounded bg-surface-2 border border-line px-2.5 py-1.5 text-xs font-semibold text-zinc-200 shadow hover:bg-surface-3 transition"
            title="Open Full Screen Monitor View (F11 / Double-Click)"
          >
            <Maximize2 size={14} /> <span className="hidden sm:inline">Full Screen</span>
          </button>
        </div>
      </div>

      <div className={`grid ${gridLayoutClass}`}>
        {cameras.map((c) => (
          <CameraTile
            key={c.id}
            camera={c}
            site={siteLabel(c, orgName)}
            engineOnline={healthInfo ? (healthInfo.online !== false && ((healthInfo as any).ready !== false || isCloudMode)) : true}
            onFullscreen={onFullscreen}
            paused={paused}
          />
        ))}
      </div>

      <AddCameraModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        orgId={orgId}
        onCameraAdded={handleCameraAdded}
      />
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
function FallbackTileLiveFeed({ cameraName, detections }: { cameraName: string; detections: any[] }) {
  return <FallbackTileLiveFeedShared cameraName={cameraName} detections={detections} />;
}

const CameraTile = memo(function CameraTile({ camera: c, site, engineOnline, onFullscreen, paused }: { camera: any; site: string; engineOnline: boolean | null; onFullscreen: (id: string) => void; paused: boolean }) {
  // Bound once per tile. The parent now passes its own stable setter straight
  // through (it used to wrap it in a fresh arrow per render, which would have
  // made the memo() above a no-op by handing every tile a new prop identity on
  // every parent poll tick).
  const goFullscreen = useCallback(() => onFullscreen(c.id), [onFullscreen, c.id]);

  const [streamFailed, setStreamFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [sharingType, setSharingType] = useState<"screen" | "webcam" | null>(null);
  const [shareStatus, setShareStatus] = useState<ShareStatus>("idle");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [detections, setDetections] = useState<TelemetryDetection[]>([]);
  const [telemetry, setTelemetry] = useState<CameraTelemetry | null>(null);
  // Newest payload, always current, never triggers a render. The gate in the
  // telemetry callback below decides which of these are worth committing to
  // state; this ref is what makes discarding the rest safe.
  const telemetryRef = useRef<CameraTelemetry | null>(null);
  // Last detection set actually committed to state. Kept in a ref because the
  // comparison runs inside the socket callback, which closes over the state
  // value from the render it was created in.
  const detectionsRef = useRef<TelemetryDetection[]>([]);
  const lastFpsCommitRef = useRef(0);
  const telemetrySessionRef = useRef<TelemetrySession | null>(null);
  // Stable getters: the HUD polls these on its own tick, so they must not
  // change identity per render or they would restart its sampling effect.
  const getWsStats = useCallback(
    () => telemetrySessionRef.current?.getStats() ?? { rttMs: 0, gapMs: 0, parseMs: 0, received: 0 },
    [],
  );
  const getPushStats = useCallback(
    () => sessionRef.current?.getPushStats() ?? { sent: 0, dropped: 0, buffered: 0, stalledMs: 0 },
    [],
  );
  // Telemetry socket state, distinct from the camera's own health_status: the
  // socket can be live while the camera has no video, and vice versa. The HUD
  // shows both because conflating them is what made "disconnected" ambiguous.
  const [telemetryConn, setTelemetryConn] = useState<TelemetryStatus>("idle");
  // Opt-in per session (Ctrl+P). Off by default so the HUD never covers the
  // picture for an operator who did not ask for it.
  const [showPerf, setShowPerf] = useState(false);
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

  const isScreenShareCam =
    c.source_type === "screen_share" ||
    c.source_type === "screenshare" ||
    c.source_type === "virtual";

  // The engine reached the camera's source but got no usable video. Explicitly
  // NOT "telemetry is null": that just means we haven't heard anything yet
  // (still connecting, tile just mounted), which must not flash a fault banner.
  // Only a payload that positively reports a hard offline/error state counts.
  const sourceFault =
    telemetry?.health_status === "auth_failed" ||
    telemetry?.health_status === "network_error" ||
    telemetry?.health_status === "error" ||
    telemetry?.health_status === "source_gone";

  // `!paused` drops the MJPEG connection while the viewer covers this tile.
  // `engineOnline !== false` ensures stream renders even if health status fetch is pending.
  // Keep stream element active during source fault so synthetic standby/recovery stream renders with live telemetry overlays.
  const showStream =
    engineOnline !== false && !streamFailed && !isScreenShareCam && !paused;

  // Show the reason banner for a real camera whose source is faulted, and for a
  // screen share that WAS running and has stopped being pushed. Not for an
  // idle virtual camera: that tile already offers "Choose Source…", which is
  // the same information plus the button that fixes it.
  const showSourceFault = sourceFault && !paused && (!isScreenShareCam || sharingType !== null);

  // The media element the overlay measures: the local <video> while sharing,
  // otherwise the MJPEG <img>. Both show the same frames the engine analysed.
  const [realSource, setRealSource] = useState<string>(c.source || "");

  useEffect(() => {
    let active = true;
    getDecryptedCameraSource(c.id, c.source).then((dec) => {
      if (active && dec) setRealSource(dec);
    });
    return () => { active = false; };
  }, [c.id, c.source]);

  const ytEmbedUrl = useMemo(() => {
    const src = realSource || c.source || "";
    const match = src.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
    if (match && match[1]) {
      return `https://www.youtube.com/embed/${match[1]}?autoplay=1&mute=1&playsinline=1&controls=0&modestbranding=1&enablejsapi=1`;
    }
    return null;
  }, [realSource, c.source]);

  const isDirectVideo = useMemo(() => {
    const src = (realSource || c.source || "").toLowerCase();
    return src.endsWith(".m3u8") || src.endsWith(".mp4") || src.endsWith(".webm") || c.source_type === "hls";
  }, [realSource, c.source, c.source_type]);

  const imgRef = useRef<HTMLImageElement>(null);
  const mediaRef = (sharingType !== null ? videoRef : imgRef) as React.RefObject<HTMLVideoElement | HTMLImageElement>;
  const showingMedia = sharingType !== null || ytEmbedUrl !== null || isDirectVideo || showStream;

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
  // while the tile is actually on screen — the engine pushes per subscriber, so
  // a covered tile would cost real work for boxes nobody can see. `paused` is
  // what the fullscreen viewer sets on the tiles it covers.
  //
  // Gated on `paused`, NOT on `showingMedia`. showingMedia now depends on
  // sourceFault, which is derived FROM this subscription's telemetry — feeding
  // it back in here would oscillate: fault arrives -> media hides -> socket
  // closes -> telemetry cleared -> fault clears -> media shows -> resubscribe ->
  // fault arrives again, forever. The telemetry socket is also the only way a
  // faulted camera can ever tell us it recovered, so it is precisely the thing
  // that must stay open while the picture is hidden.
  useEffect(() => {
    if (engineOnline === false || paused) {
      setDetections([]); setTelemetry(null); setTelemetryConn("idle");
      telemetryRef.current = null;
      // Must track the cleared state, or the first payload after resuming
      // would compare against a stale set and could be skipped.
      detectionsRef.current = [];
      return;
    }
    const session = new TelemetrySession(c.id, (t) => {
      // Commit only when the boxes would actually look different. Every
      // payload carries a fresh array, so an unconditional commit re-rendered
      // this tile and repainted the canvas at telemetry rate even for a camera
      // sending nothing but empty arrays — see detectionsRenderEqual.
      const nextDets = t.detections ?? [];
      if (!detectionsRenderEqual(detectionsRef.current, nextDets)) {
        detectionsRef.current = nextDets;
        setDetections(nextDets);
      }

      // Telemetry arrives at AI FPS (~10-15Hz per camera). Committing every
      // payload to state re-rendered this whole tile that often — times every
      // tile on the grid, so a 6-camera workspace was doing ~90 subtree
      // re-renders a second to update text nobody can read at that rate. That
      // is the "dashboard becomes sluggish" symptom, and it gets worse with
      // each camera added.
      //
      // Only four fields of this payload are ever rendered (health_status,
      // source_error, device, fps). Three of them change rarely; fps changes
      // constantly but is displayed to one decimal, where 15Hz and 2Hz are
      // indistinguishable to a human. So commit only when something visible
      // actually changed, and rate-limit the one field that always "changes".
      //
      // The full payload is still stored — the perf HUD reads every field of
      // it — but it rides along with a commit that was going to happen anyway
      // instead of forcing one of its own.
      const prev = telemetryRef.current;
      telemetryRef.current = t;
      const now = Date.now();
      const fpsDue = now - lastFpsCommitRef.current >= FPS_COMMIT_INTERVAL_MS;
      const changed =
        prev == null ||
        prev.health_status !== t.health_status ||
        prev.source_error !== t.source_error ||
        prev.device !== t.device ||
        (fpsDue && (prev.fps ?? 0).toFixed(1) !== (t.fps ?? 0).toFixed(1));
      if (changed) {
        if (fpsDue) lastFpsCommitRef.current = now;
        setTelemetry(t);
      }

      // Same payload, second consumer. The alert engine decides on its own
      // what is an event (a track it has not seen, an analytics counter that
      // moved) and rate-limits itself; this call is a handful of map lookups
      // in the common case where nothing new happened, and never blocks —
      // snapshot encoding is queued to idle time inside the engine.
      ingestAlert({ id: c.id, name: c.name, site }, t, captureRef.current);
    }, setTelemetryConn);
    telemetrySessionRef.current = session;
    session.start();
    return () => { session.stop(); telemetrySessionRef.current = null; };
  }, [c.id, c.name, site, engineOnline, paused, ingestAlert]);

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
        goFullscreen();
      }
      // Ctrl+P toggles the performance HUD for the hovered tile. Per-tile
      // rather than global: on a multi-camera grid the useful question is
      // almost always "why is THIS one slow", and showing every HUD at once
      // costs render budget on tiles nobody is investigating.
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setShowPerf((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isHovered, showingMedia, goFullscreen]);

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
        onDoubleClick={showingMedia ? goFullscreen : undefined}
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
        ) : ytEmbedUrl ? (
          <iframe
            src={ytEmbedUrl}
            title={c.name}
            className="w-full h-full border-0 pointer-events-none object-cover bg-black"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : isDirectVideo ? (
          <video
            src={realSource || c.source}
            autoPlay
            playsInline
            muted
            loop
            controls={false}
            className={`${mediaClass} bg-black`}
          />
        ) : showStream && !streamFailed ? (
          <img
            key={`${c.id}-${retryCount}`}
            ref={imgRef}
            crossOrigin={imgCors ? "anonymous" : undefined}
            src={`${mjpegStreamUrl(c.id)}?t=${retryCount}`}
            alt={c.name}
            className={mediaClass}
            onLoad={() => {
              corsProvenRef.current = imgCors;
              setStreamFailed(false);
            }}
            onError={() => {
              if (imgCors && !corsProvenRef.current) {
                setImgCors(false);
              }
              setStreamFailed(true);
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
          <FallbackTileLiveFeed cameraName={c.name} detections={shownDetections} />
        )}

        {/* Boxes sit above the media and below the status chips. object-cover
            matches the className on both the <video> and the <img> above.

            Mounted for the whole life of the media element, NOT only while
            detections exist. Gating on `shownDetections.length > 0` tore the
            canvas down on every frame that happened to detect nothing and built
            a fresh one on the next — so the overlay spent its life remounting,
            and each new canvas had to wait for a ResizeObserver/`load` tick
            before it knew its own size. An empty detection list now simply
            draws an empty (cleared) canvas, which is both cheaper and stable. */}
        {showingMedia && (
          <DetectionOverlay detections={shownDetections} mediaRef={mediaRef} fit={fit} />
        )}

        {/* Performance HUD. Rendered only on request (Ctrl+P while hovering the
            tile) and self-throttled to 4Hz internally, so it cannot become a
            source of the frame drops it is there to diagnose. */}
        <PerformanceOverlay
          telemetry={telemetry}
          connection={telemetryConn}
          visible={showPerf}
          getWsStats={getWsStats}
          getPushStats={sharingType !== null ? getPushStats : undefined}
        />

        {/* "No video" is not the same as "nothing detected", and until now the
            tile rendered both identically: an empty picture with no boxes. An
            operator looking at a camera whose RTSP address is wrong, whose
            YouTube link has died, or whose virtual source nobody picked, saw
            exactly what a working camera watching an empty room looks like —
            and reasonably concluded the detection had stopped working.

            The engine knows the difference and now says so on every telemetry
            payload (pipeline.source_error_text). Show it. */}
        {showSourceFault && (
          // pr-12 keeps the text clear of the fullscreen button in the corner.
          <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 bg-black/85 py-2 pl-2.5 pr-12 text-left">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle size={14} className="mt-px shrink-0 text-warn" />
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-zinc-100">
                  No video from this source — AI is not running on it
                </div>
                {telemetry?.source_error && (
                  <div className="mt-0.5 text-[10px] leading-snug text-zinc-400 truncate max-w-[240px]" title={telemetry.source_error}>
                    {telemetry.source_error}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={async () => {
                try {
                  const sb = await getSupabase();
                  await sb.from("cameras").update({ source_type: "virtual", type: "virtual" }).eq("id", c.id);
                  try {
                    await fetch(`${getEngineBase()}/api/cameras`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        id: c.id,
                        name: c.name,
                        type: "virtual",
                        source: "virtual",
                        is_active: true,
                        zones: c.zones || "[]",
                        lines: c.lines || "[]",
                        rules: c.rules || "[]"
                      })
                    });
                  } catch (e) {
                    console.log("[VirtualStream] Local engine camera switch notice:", e);
                  }
                } catch (err) {
                  console.error("Failed to switch camera to virtual source", err);
                }
              }}
              className="shrink-0 rounded bg-indigo-600/80 px-2 py-1 text-[10px] font-semibold text-white hover:bg-indigo-500 transition-colors shadow"
              title="Switch camera to built-in virtual demo stream"
            >
              Virtual Stream
            </button>
          </div>
        )}

        {/* Stays visible in fullscreen — an operator watching a full-screen feed
            is exactly who needs to see the pipeline is still keeping up.
            Hidden while the source is faulted: "0 shown · 0.0 fps" is not a
            performance reading there, it is the absence of one, and it would sit
            on top of the banner that explains why. */}
        {showingMedia && telemetry && !showSourceFault && (
          <div className="absolute bottom-2 left-2 z-20 rounded bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-200 shadow">
            {shownDetections.length} shown · {(telemetry.fps ?? 0).toFixed(1)} fps
            {telemetry.device ? ` · ${telemetry.device.toUpperCase()}` : ""}
          </div>
        )}

        {showingMedia && (
          <button
            onClick={goFullscreen}
            title="Full screen (F11, or double-click)"
            // z-30 keeps it clickable above the source-fault banner, which
            // spans the full width of the tile's bottom edge.
            className="absolute bottom-2 right-2 z-30 rounded bg-black/70 p-1.5 text-zinc-300 transition-colors hover:bg-black/90 hover:text-white"
          >
            <Maximize2 size={13} />
          </button>
        )}

        {/* Name the actual surface, not just the mode — "Sharing screen" gave the
            operator no way to tell which screen/window was going out. */}
        {sharingType !== null && (
          <div className="absolute top-2 right-2 z-20 max-w-[70%] truncate rounded bg-red-600/90 px-2 py-0.5 text-[10px] font-semibold text-white shadow"
               title={sourceName ?? undefined}>
            Sharing: {sourceName ?? sharingType}
          </div>
        )}

        {/* Terminal state: the window we were capturing is gone. Offer a re-pick
            rather than retrying an id that can never resolve again. */}
        {shareStatus === "source_gone" && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface-0/95 p-4 text-center">
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
              className="text-[10px] text-red-400 hover:text-red-300 hover:underline mr-1 font-bold"
            >
              Stop Share
            </button>
          )}
          {(() => {
            const rawStatus = telemetry?.health_status ?? c.status;
            const effectiveStatus = (rawStatus && rawStatus !== "offline" && rawStatus !== "connecting")
              ? rawStatus
              : "online";
            return (
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  sharingType !== null
                    ? SHARE_STATUS_TONES[shareStatus]
                    : STATUS_TONES[effectiveStatus] ?? "bg-surface-3 text-zinc-500",
                )}
              >
                {sharingType !== null ? SHARE_STATUS_LABELS[shareStatus] : STATUS_LABELS[effectiveStatus] ?? effectiveStatus}
              </span>
            );
          })()}
        </div>
      </div>
    </div>
  );
});

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
      <div className="mt-2 text-sm text-zinc-400">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertsTab — Telegram connect (one-time connection code) + the Alerts page
// ---------------------------------------------------------------------------

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

function AlertsTab({ orgId, hasPermission, active }: { orgId: string | null; hasPermission: (perm: string) => boolean; active: boolean }) {
  const isAdmin = hasPermission("org.manage");
  const [connState, setConnState] = useState<TgConnState>({ phase: "loading" });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load connection status once, then keep it live via Supabase realtime (no polling)
  useEffect(() => {
    let alive = true;
    async function checkConnection() {
      try {
        const sb = await getSupabase();
        // Only safe display fields — never select chat_id / telegram_user_id.
        const { data } = await sb
          .from("telegram_connections")
          .select("connected, chat_name, tg_username, connected_at")
          .maybeSingle();
        if (!alive) return;
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
        if (alive) setConnState({ phase: "idle" });
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
            if (!alive) return;
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
      alive = false;
      (async () => {
        const sb = await getSupabase();
        if (channel) sb.removeChannel(channel);
      })();
    };
  }, [orgId]);

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

      {/* The Alerts page. This is the only place an alert is ever rendered —
          realtime, filterable, exportable — see AlertsPage.tsx. */}
      <AlertsPage active={active} />
    </div>
  );
}

function CloudModeSwitcher({
  orgId,
  canEdit,
  currentMode = "cloud",
}: {
  orgId: string | null;
  canEdit: boolean;
  currentMode?: string;
}) {
  const [mode, setMode] = useState<"local" | "cloud">(
    currentMode === "local" ? "local" : "cloud"
  );
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (currentMode) {
      setMode(currentMode === "local" ? "local" : "cloud");
    }
  }, [currentMode]);

  async function handleModeChange(newMode: "local" | "cloud") {
    setMode(newMode);
    setUpdating(true);
    try {
      // 1. Sync to local FastAPI engine
      await fetch(`${getEngineBase()}/api/cloud-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });

      // 2. Sync to Supabase org settings
      if (orgId && canEdit) {
        const sb = await getSupabase();
        await sb.from("settings").upsert(
          { org_id: orgId, scope: "org", key: "ai.inference_mode", value: newMode },
          { onConflict: "org_id,scope,key" }
        );
      }
    } catch (e) {
      console.error("[CloudModeSwitcher] Sync error:", e);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-1 bg-surface-2/80 p-1 rounded-lg border border-line/80 text-xs">
      <button
        onClick={() => void handleModeChange("local")}
        disabled={updating}
        title="Local Mode: Process 100% locally on Local Hardware (Cloud Off)"
        className={clsx(
          "flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition",
          mode === "local"
            ? "bg-accent/20 text-accent border border-accent/40 shadow-sm"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-1"
        )}
      >
        <Cpu size={12} /> Local (Hardware)
      </button>

      <button
        onClick={() => void handleModeChange("cloud")}
        disabled={updating}
        title="Cloud Mode: Process 100% on AWS EC2 Cloud GPU (Local GPU 0% Paused)"
        className={clsx(
          "flex flex-1 items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition",
          mode === "cloud"
            ? "bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-sm"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-surface-1"
        )}
      >
        <Cloud size={12} /> Cloud (AWS GPU)
      </button>
    </div>
  );
}

