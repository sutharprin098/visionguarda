import { useEffect, useState, useRef } from "react";
import { Video, Bell, Settings2, LogOut, Wifi, WifiOff } from "lucide-react";
import clsx from "clsx";
import { startRealtimeSync, DeactivatedError, SyncBundle } from "../lib/sync";
import { syncCamerasToLocalEngine, syncAiModelToLocalEngine, isEngineOnline, mjpegStreamUrl, resetLocalEngineState, reportCameraHealth } from "../lib/localEngine";
import ModelManagerUI from "../components/ModelManagerUI";

export default function Workspace({ onDeactivated }: { onDeactivated: () => void }) {
  const [bundle, setBundle] = useState<SyncBundle | null>(null);
  const [tab, setTab] = useState<"cameras" | "alerts" | "settings">("cameras");
  const [syncError, setSyncError] = useState(false);

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

  // keep the local AI engine's running cameras in step with what's assigned
  useEffect(() => {
    if (bundle) void syncCamerasToLocalEngine(bundle.cameras, bundle.rule_engine_rules || []);
  }, [bundle?.cameras, bundle?.rule_engine_rules]);

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
  useEffect(() => {
    if (typeof orgModel === "string") void syncAiModelToLocalEngine(orgModel);
  }, [orgModel]);

  // Check if user has permission or is super admin
  const hasPermission = (perm: string): boolean => {
    if (!bundle) return false;
    if (bundle.profile?.is_super_admin) return true;
    return Array.isArray(bundle.permissions) && bundle.permissions.includes(perm);
  };

  // Dynamically select allowed tabs
  const allowedTabs = bundle
    ? ([
        (hasPermission("cameras.manage") || hasPermission("cameras.assign")) && "cameras",
        hasPermission("alerts.view") && "alerts",
        hasPermission("ai.configure") && "settings",
      ].filter(Boolean) as ("cameras" | "alerts" | "settings")[])
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
        {tab === "cameras" && <CamerasView cameras={bundle.cameras} />}
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
            <Panel title="AI Settings (managed by your organization)">
              <pre className="mt-2 overflow-x-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-zinc-400">
                {JSON.stringify(aiSettings, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-zinc-500">
                Confidence threshold and class filters are shown for reference. Model selection applies live to the local AI engine when downloaded and deployed.
              </p>
            </Panel>

            <ModelManagerUI
              modelPackages={bundle.ai_model_packages || []}
              activeModelName={aiSettings["ai.model"]}
              orgId={bundle.organization?.id}
              canConfigure={hasPermission("ai.configure")}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function CamerasView({ cameras }: { cameras: any[] }) {
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => isEngineOnline().then((ok) => !cancelled && setEngineOnline(ok));
    check();
    const id = setInterval(check, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!cameras.length) {
    return <Panel title="Cameras">No cameras assigned to you. Ask your administrator.</Panel>;
  }
  return (
    <div className="space-y-3">
      {engineOnline === false && (
        <div className="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <WifiOff size={13} /> Local AI engine isn't running on this machine — start it to see live previews.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {cameras.map((c) => (
          <CameraTile key={c.id} camera={c} engineOnline={engineOnline} />
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

function CameraTile({ camera: c, engineOnline }: { camera: any; engineOnline: boolean | null }) {
  const [streamFailed, setStreamFailed] = useState(false);
  const [sharingType, setSharingType] = useState<"screen" | "webcam" | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<any>(null);

  const isScreenShareCam = c.source_type === "screen_share";
  const showStream = engineOnline && !streamFailed && (!isScreenShareCam || sharingType === null);

  useEffect(() => {
    if (localStream && videoRef.current) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    return () => {
      stopSharing();
    };
  }, []);

  async function startSharing(type: "screen" | "webcam") {
    try {
      let stream: MediaStream;
      if (type === "screen") {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 960, height: 540, frameRate: 10 },
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 960, height: 540, frameRate: 10 },
        });
      }

      setSharingType(type);
      setLocalStream(stream);

      const ws = new WebSocket("ws://localhost:8000/ws");
      wsRef.current = ws;

      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext("2d");

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.play().catch(() => {});

      ws.onopen = () => {
        timerRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (video.readyState >= video.HAVE_CURRENT_DATA && ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = canvas.toDataURL("image/jpeg", 0.6);
            ws.send(JSON.stringify({
              type: "screen_frame",
              camera_id: c.id,
              frame: frame,
            }));
          }
        }, 100);
      };

      ws.onerror = (err) => {
        console.error("WebSocket error", err);
      };

      ws.onclose = () => {
        stopSharing();
      };

      stream.getVideoTracks()[0].onended = () => {
        stopSharing();
      };

    } catch (err) {
      console.error("Failed to start media share:", err);
      stopSharing();
    }
  }

  function stopSharing() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    setSharingType(null);
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
                ? "bg-red-500/20 text-red-400 animate-pulse"
                : STATUS_TONES[c.status] ?? "bg-surface-3 text-zinc-500",
            )}
          >
            {sharingType !== null ? "Streaming" : STATUS_LABELS[c.status] ?? c.status}
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
