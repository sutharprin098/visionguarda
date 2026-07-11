import { useEffect, useState } from "react";
import Activation from "./screens/Activation";
import Workspace from "./screens/Workspace";
import { restoreSession } from "./lib/session";

type Phase = "booting" | "needs-activation" | "ready";

export default function App() {
  const [phase, setPhase] = useState<Phase>("booting");

  useEffect(() => {
    // No login screen, ever: try encrypted-vault auto-login; only fall back
    // to the license prompt on first run (or after admin deactivation).
    restoreSession().then((ok) => setPhase(ok ? "ready" : "needs-activation"));
  }, []);

  if (phase === "booting") {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-zinc-500">
        Starting CamAI…
      </div>
    );
  }
  if (phase === "needs-activation") {
    return <Activation onActivated={() => setPhase("ready")} />;
  }
  return <Workspace onDeactivated={() => setPhase("needs-activation")} />;
}
