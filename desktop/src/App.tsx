import { useEffect, useState } from "react";
import Activation from "./screens/Activation";
import Workspace from "./screens/Workspace";
import AdminStudio from "./screens/AdminStudio"; // configuration drawings & rule studio
import { restoreSession } from "./lib/session";

type Phase = "booting" | "needs-activation" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("booting");
  const [appType, setAppType] = useState<"desktop" | "admin" | null>(null);
  const [currentScreen, setCurrentScreen] = useState<"workspace" | "admin-studio">("workspace");

  useEffect(() => {
    // No login screen, ever: try encrypted-vault auto-login; only fall back
    // to the license prompt on first run (or after admin deactivation).
    window.camai.getConfig().then((cfg) => {
      setAppType(cfg.appType);
      restoreSession().then((ok) => setPhase(ok ? "ready" : "needs-activation"));
    });
  }, []);

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
  
  if (appType === "admin" || currentScreen === "admin-studio") {
    return (
      <AdminStudio
        onDeactivated={() => {
          if (appType === "admin") {
            setPhase("needs-activation");
          } else {
            setCurrentScreen("workspace");
          }
        }}
      />
    );
  }
  
  return (
    <Workspace
      onDeactivated={() => setPhase("needs-activation")}
      onOpenAdminStudio={() => setCurrentScreen("admin-studio")}
    />
  );
}
