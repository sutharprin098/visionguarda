import { useEffect, useState } from "react";
import Activation from "./screens/Activation";
import Workspace from "./screens/Workspace";
import AdminStudio from "./screens/AdminStudio"; // configuration drawings & rule studio
import { restoreSession } from "./lib/session";
import { startRealtimeSync, SyncBundle } from "./lib/sync";
import { resetLocalEngineState, syncCamerasToLocalEngine, updateCameraNames } from "./lib/localEngine";
import { canConfigure } from "./lib/rbac";

type Phase = "booting" | "needs-activation" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [appType, setAppType] = useState<"desktop" | "admin" | null>(null);
  const [currentScreen, setCurrentScreen] = useState<"workspace" | "admin-studio">("workspace");
  const [bundle, setBundle] = useState<SyncBundle | null>(null);

  useEffect(() => {
    // No login screen, ever: try encrypted-vault auto-login; only fall back to
    // the license prompt on first run or after a DEFINITIVE token rejection.
    // A transient failure (offline at launch, DNS not up) must never demand the
    // license key again — the key is already saved; we retry with backoff until
    // the network is back, holding on the "Starting…" splash meanwhile.
    let cancelled = false;
    let attempt = 0;

    async function boot() {
      const cfg = await window.camai.getConfig();
      if (cancelled) return;
      setAppType(cfg.appType);

      const tryRestore = async () => {
        if (cancelled) return;
        const result = await restoreSession();
        if (cancelled) return;
        if (result === "ready") { setPhase("ready"); return; }
        if (result === "no-creds") { setPhase("needs-activation"); return; }
        // "retry": keep the saved key, back off (max 15s) and try again.
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 15_000);
        setTimeout(tryRestore, delay);
      };
      void tryRestore();
    }

    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    let stop: (() => void) | undefined;

    const deactivate = async () => {
      resetLocalEngineState();
      await window.camai.deactivate();
      setPhase("needs-activation");
    };

    startRealtimeSync(
      (b) => setBundle(b),
      deactivate
    ).then((s) => (stop = s));

    return () => stop?.();
  }, [phase]);

  // Keep the local AI engine's running cameras in step with what's assigned.
  //
  // This lived inside Workspace, which is why Admin Studio showed no video. In
  // the Admin build `showWorkspace` is false (see below), so Workspace never
  // mounts, so this effect never ran, so the engine was never told a single
  // camera existed. Admin Studio then pointed an <img> at
  // /api/cameras/<id>/stream for a camera the engine had never heard of; the
  // request failed and the browser rendered the tag's alt text — the "small
  // Live placeholder". The engine itself was online and healthy the whole time,
  // which is exactly why it read as "the studio is unfinished" rather than as a
  // broken image.
  //
  // Registering cameras with the local engine is an application-level concern,
  // not a Workspace one: every screen that shows a stream depends on it. Hoisted
  // here so it runs for whichever screen is up, in either build.
  //
  // Interval, not just on bundle change: the engine can still be loading its
  // model (tens of seconds) when this first fires, and a sync that no-ops
  // because the engine wasn't reachable yet would otherwise never be retried
  // until something unrelated refetched the bundle.
  useEffect(() => {
    if (phase !== "ready" || !bundle) return;
    // Keep camera name map synced for local Telegram alerts.
    updateCameraNames(bundle.cameras);
    const sync = () => void syncCamerasToLocalEngine(
      bundle.cameras, bundle.rule_engine_rules || [], bundle.zone_profile_configs || [],
    );
    sync();
    const id = setInterval(sync, 8_000);
    return () => clearInterval(id);
  }, [phase, bundle?.cameras, bundle?.rule_engine_rules, bundle?.zone_profile_configs]);

  if (phase === "booting" || appType === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-zinc-500">
        Starting CamAI…
      </div>
    );
  }
  if (phase === "needs-activation") {
    return <Activation onActivated={() => setPhase("ready")} />;
  }

  if (!bundle) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-zinc-500">
        Syncing your workspace…
      </div>
    );
  }

  // Admin access is the USER's permission, not the build's identity.
  // It used to be `appType === "admin"`, which came from
  // app.getName().includes("Admin Studio") — a build flag. Anyone running the
  // Admin build got the whole configuration UI whatever their role, and their
  // writes then failed silently against RLS. The server has always enforced
  // cameras.manage (see lib/rbac.ts); this stops the UI disagreeing with it.
  const mayConfigure = canConfigure(bundle);
  const showWorkspace = appType !== "admin" || !mayConfigure;
  const showAdmin = mayConfigure && (appType === "admin" || currentScreen === "admin-studio");

  // An Admin-build user without the permission has nowhere to go: send them to
  // the workspace rather than a blank screen.
  if (appType === "admin" && !mayConfigure && currentScreen === "admin-studio") {
    setCurrentScreen("workspace");
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-[#0b0d10]">
      {showWorkspace && (
        <div
          className="h-full w-full"
          style={{ display: currentScreen === "workspace" ? "block" : "none" }}
        >
          <Workspace
            bundle={bundle}
            onDeactivated={() => setPhase("needs-activation")}
            // undefined tells Workspace to render the entry point locked rather
            // than offering a door that RLS will slam.
            onOpenAdminStudio={mayConfigure ? () => setCurrentScreen("admin-studio") : undefined}
          />
        </div>
      )}
      {showAdmin && (
        <div
          className="h-full w-full"
          style={{ display: currentScreen === "admin-studio" || appType === "admin" ? "block" : "none" }}
        >
          <AdminStudio
            onDeactivated={() => {
              if (appType === "admin") {
                setPhase("needs-activation");
              } else {
                setCurrentScreen("workspace");
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
