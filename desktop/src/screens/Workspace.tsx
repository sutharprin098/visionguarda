import { useEffect, useState } from "react";
import { Cctv, Video, Bell, Settings2, LogOut, Wifi, WifiOff } from "lucide-react";
import clsx from "clsx";
import { startRealtimeSync, DeactivatedError, SyncBundle } from "../lib/sync";
import { syncCamerasToLocalEngine, isEngineOnline, mjpegStreamUrl, resetLocalEngineState } from "../lib/localEngine";

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
    if (bundle) void syncCamerasToLocalEngine(bundle.cameras);
  }, [bundle?.cameras]);

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

  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/20 text-accent">
            <Cctv size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">CamAI Desktop</div>
            <div className="truncate text-xs text-zinc-500">{bundle.organization?.name}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-2">
          {(
            [
              { id: "cameras", label: `Cameras (${bundle.cameras.length})`, icon: Video },
              { id: "alerts", label: `Alerts (${bundle.notifications.length})`, icon: Bell },
              { id: "settings", label: "AI Settings", icon: Settings2 },
            ] as const
          ).map((n) => (
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
          <Panel title="AI Settings (managed by your organization)">
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-zinc-400">
              {JSON.stringify(aiSettings, null, 2)}
            </pre>
            <p className="mt-2 text-xs text-zinc-500">
              These values feed the local AI pipeline (server/app/ai). Changes made by your admin apply live.
            </p>
          </Panel>
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

function CameraTile({ camera: c, engineOnline }: { camera: any; engineOnline: boolean | null }) {
  const [streamFailed, setStreamFailed] = useState(false);
  const showStream = engineOnline && !streamFailed;
  return (
    <div className="card overflow-hidden">
      <div className="flex aspect-video items-center justify-center bg-surface-0 text-zinc-600">
        {showStream ? (
          <img
            src={mjpegStreamUrl(c.id)}
            alt={c.name}
            className="h-full w-full object-cover"
            onError={() => setStreamFailed(true)}
          />
        ) : (
          <Video size={28} />
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm text-zinc-200">{c.name}</span>
        <span
          className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            c.status === "online" ? "bg-ok/15 text-ok" : "bg-surface-3 text-zinc-500",
          )}
        >
          {c.status}
        </span>
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
