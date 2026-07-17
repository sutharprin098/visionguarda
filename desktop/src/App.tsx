import { useEffect, useState } from "react";
import Activation from "./screens/Activation";
import Workspace from "./screens/Workspace";
import AdminStudio from "./screens/AdminStudio"; // configuration drawings & rule studio
import { restoreSession } from "./lib/session";
import { startRealtimeSync, SyncBundle } from "./lib/sync";
import { resetLocalEngineState } from "./lib/localEngine";

type Phase = "booting" | "needs-activation" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [appType, setAppType] = useState<"desktop" | "admin" | null>(null);
  const [currentScreen, setCurrentScreen] = useState<"workspace" | "admin-studio">("workspace");
  const [bundle, setBundle] = useState<SyncBundle | null>(null);

  useEffect(() => {
    // No login screen, ever: try encrypted-vault auto-login; only fall back
    // to the license prompt on first run (or after admin deactivation).
    window.camai.getConfig().then((cfg) => {
      setAppType(cfg.appType);
      restoreSession().then((ok) => setPhase(ok ? "ready" : "needs-activation"));
    });
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

  const showWorkspace = appType !== "admin";
  const showAdmin = appType === "admin" || currentScreen === "admin-studio";

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
            onOpenAdminStudio={() => setCurrentScreen("admin-studio")}
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
