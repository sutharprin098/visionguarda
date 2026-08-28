import { useEffect, useState, lazy, Suspense } from "react";
import { canConfigure } from "./lib/rbac";
import type { SyncBundle } from "./lib/sync";
import AlertProvider from "./components/alerts/AlertProvider";

import { Loader2 } from "lucide-react";

// lib/session and lib/sync pull in supabase-js — 200KB of JavaScript that has
// to be parsed and evaluated before any module importing them can run. Nothing
// in it is needed to draw the splash, and every millisecond it spends being
// evaluated is a millisecond the window is blank, so it is imported inside the
// effects that actually use it instead of at module scope. Same reasoning for
// lib/localEngine, which drags in the zone-profile tables.
const loadSession = () => import("./lib/session");
const loadSync = () => import("./lib/sync");
const loadLocalEngine = () => import("./lib/localEngine");

// The three screens are ~140KB of source between them and NONE of them can
// render until the session and bundle have arrived — yet statically imported
// they had to be downloaded, parsed and evaluated before the splash could show
// its first frame. Split out, the initial chunk is the splash and little else,
// and the screens load over the network wait that was happening anyway.
//
// Splitting alone would just move the delay to the moment the data lands, so
// prefetch() below pulls them in immediately after mount — off the critical
// path, but well before anything needs them.
const Activation = lazy(() => import("./screens/Activation"));
const Workspace = lazy(() => import("./screens/Workspace"));
const AdminStudio = lazy(() => import("./screens/AdminStudio")); // configuration drawings & rule studio

function prefetchScreens() {
  void import("./screens/Workspace");
  void import("./screens/AdminStudio");
  void import("./screens/Activation");
}

type Phase = "booting" | "needs-activation" | "ready";

function SplashLoading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="relative flex h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 text-slate-100 selection:bg-sky-500/20">
      {/* Ambient background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(at_20%_20%,rgba(14,165,233,0.15)_0px,transparent_50%),radial-gradient(at_80%_80%,rgba(99,102,241,0.15)_0px,transparent_50%)] pointer-events-none" />
      <div className="absolute -left-20 top-12 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute -right-20 bottom-12 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center text-center">
        {/* Animated Brand Logo Container */}
        <div className="relative mb-6">
          <span className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 opacity-40 blur-lg animate-pulse" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-400/30 bg-slate-900/90 p-2.5 shadow-2xl backdrop-blur-xl">
            <img src="./favicon.svg" alt="CamAI" className="h-full w-full rounded-xl" />
          </div>
        </div>

        {/* Brand Name & Tag */}
        <span className="font-extrabold text-2xl tracking-tight text-white">CamAI Enterprise</span>
        <span className="mt-1 text-[11px] font-semibold tracking-wider text-sky-400 uppercase">Edge Vision Node</span>

        {/* Loading Card */}
        <div className="mt-8 w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            <span>{title}</span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            {subtitle}
          </p>

          {/* Animated Progress Bar */}
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-sky-400 animate-pulse" />
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-6 flex items-center gap-2 text-[11px] font-medium text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span>Local Engine & Encrypted Vault Active</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>("booting");
  // Known synchronously from preload now, so the splash never renders just to
  // wait for it (this used to be null on the first frame and gated everything).
  const [appType] = useState<"desktop" | "admin">(() => window.camai.config.appType);
  const [currentScreen, setCurrentScreen] = useState<"workspace" | "admin-studio">("workspace");
  const [bundle, setBundle] = useState<SyncBundle | null>(null);
  // "Open Live Feed" clicked on an alert row in the Alerts page — opening a
  // camera live means switching screens (if the click came from Admin
  // Studio's bell) AND telling Workspace which camera. Nonce so the same
  // camera clicked twice in a row reopens the viewer both times rather than
  // the second click being a no-op prop change.
  const [pendingLiveCam, setPendingLiveCam] = useState<{ id: string; nonce: number } | null>(null);
  // The notification bell, wherever it was clicked (Workspace's sidebar or
  // Admin Studio's header), asked to land on the Alerts tab. Same nonce
  // pattern: switching TO Workspace and bumping this in the same click has to
  // work even if Workspace was already the visible screen.
  const [openAlertsSignal, setOpenAlertsSignal] = useState<{ nonce: number } | null>(null);
  const [modeSynced, setModeSynced] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    prefetchScreens();

    const tryRestore = async () => {
      if (cancelled) return;
      try {
        const { restoreSession } = await loadSession();
        if (cancelled) return;
        const result = await restoreSession(attempt > 0);
        if (cancelled) return;
        if (result === "ready") { setPhase("ready"); return; }
        if (result === "no-creds") { setPhase("needs-activation"); return; }
      } catch {
        /* proceed to retry/fallback */
      }
      attempt += 1;
      if (attempt >= 2) {
        // Stop infinite splash loop on offline/network delays
        const stored = await window.camai.getStoredSession().catch(() => ({ ok: false }));
        if (cancelled) return;
        if (stored.ok) {
          setPhase("ready");
        } else {
          setPhase("needs-activation");
        }
        return;
      }
      const delay = Math.min(1000 * 2 ** attempt, 3000);
      setTimeout(tryRestore, delay);
    };

    void tryRestore();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    
    // Ensure bundle is NEVER null for more than 2 seconds
    const timeoutTimer = setTimeout(async () => {
      if (!cancelled) {
        const syncMod = await loadSync().catch(() => null);
        if (!cancelled && syncMod) {
          setBundle((curr) => curr ?? syncMod.DEFAULT_OFFLINE_BUNDLE);
        }
      }
    }, 2000);

    void loadSync()
      .then((m) => m.loadCachedBundle())
      .then((cached) => {
        if (!cancelled && cached) setBundle((current) => current ?? cached);
      })
      .catch(async () => {
        const syncMod = await loadSync().catch(() => null);
        if (!cancelled && syncMod) {
          setBundle((curr) => curr ?? syncMod.DEFAULT_OFFLINE_BUNDLE);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutTimer);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "ready") return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    const deactivate = async () => {
      const { resetLocalEngineState } = await loadLocalEngine();
      resetLocalEngineState();
      await window.camai.deactivate();
      setPhase("needs-activation");
    };

    void loadSync().then(({ startRealtimeSync }) =>
      startRealtimeSync((b) => setBundle(b), deactivate).then((s) => {
        // The effect can be torn down while the first sync is still in flight;
        // without this the subscription outlives the component.
        if (cancelled) s();
        else stop = s;
      }),
    );

    return () => { cancelled = true; stop?.(); };
  }, [phase]);

  // Synchronize central org ai.inference_mode (cloud vs local) from portal settings
  // BEFORE allowing local cameras to start or dismissing the loading splash.
  useEffect(() => {
    if (phase !== "ready" || !bundle) return;
    let cancelled = false;

    const orgInferenceMode =
      bundle.settings?.find((s) => s.scope === "org" && s.key === "ai.inference_mode")?.value || "local";
    const orgCloudUrl =
      bundle.settings?.find((s) => s.scope === "org" && s.key === "ai.cloud_endpoint_url")?.value || "http://13.203.71.14:8000";

    void loadLocalEngine().then(async ({ syncAiInferenceModeToLocalEngine }) => {
      if (cancelled) return;
      try {
        await syncAiInferenceModeToLocalEngine(orgInferenceMode, orgCloudUrl);
      } catch (err) {
        console.error("[App] Initial AI inference mode sync failed:", err);
      } finally {
        if (!cancelled) {
          setModeSynced(true);
        }
      }
    });

    return () => { cancelled = true; };
  }, [phase, bundle]);

  // Keep the local AI engine's running cameras in step with what's assigned.
  // Gated on modeSynced so cameras only initialize AFTER inference mode is set on engine.
  useEffect(() => {
    if (phase !== "ready" || !bundle || !modeSynced) return;
    let id: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    void loadLocalEngine().then(({ updateCameraNames, syncCamerasToLocalEngine }) => {
      if (cancelled) return;
      // Keep camera name map synced for local Telegram alerts.
      updateCameraNames(bundle.cameras);
      const sync = () => void syncCamerasToLocalEngine(
        bundle.cameras, bundle.rule_engine_rules || [], bundle.zone_profile_configs || [],
      );
      sync();
      id = setInterval(sync, 8_000);
    });

    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [phase, modeSynced, bundle?.cameras, bundle?.rule_engine_rules, bundle?.zone_profile_configs]);

  // Push each assigned camera's live connection state (online/offline/
  // connecting/auth_failed/network_error) to Supabase so the portal's Health
  // column and status badge stay accurate without a refresh. Used to live in
  // Workspace, which meant an Admin-Studio-only session (appType==="admin",
  // showWorkspace===false below) reported nothing at all for as long as it
  // was open — same reasoning as the syncCamerasToLocalEngine move above.
  // 2s, not 10s: report-camera-health now takes the whole camera list in one
  // batched call (see lib/localEngine.ts), so a faster interval no longer
  // multiplies the edge-function request count by fleet size.
  const cameraIds = bundle?.cameras.map((c: any) => c.id).join(",") ?? "";
  useEffect(() => {
    if (phase !== "ready" || !cameraIds) return;
    let cancelled = false;
    let id: ReturnType<typeof setInterval> | undefined;

    void loadLocalEngine().then(({ reportCameraHealth, reportEvents }) => {
      if (cancelled) return;
      const ids = cameraIds.split(",");
      const tick = () => { void reportCameraHealth(ids); void reportEvents(); };
      tick();
      id = setInterval(tick, 2_000);
    });

    return () => { cancelled = true; if (id) clearInterval(id); };
  }, [phase, cameraIds]);

  const bootSplash = (
    <SplashLoading
      title="Starting CamAI Enterprise Node…"
      subtitle="Verifying Windows DPAPI hardware vault & initializing local AI supervisor."
    />
  );

  if (phase === "booting") return bootSplash;

  if (phase === "needs-activation") {
    return (
      <Suspense fallback={bootSplash}>
        <Activation onActivated={() => setPhase("ready")} />
      </Suspense>
    );
  }

  if (!bundle || !modeSynced) {
    const activeMode =
      bundle?.settings?.find((s) => s.scope === "org" && s.key === "ai.inference_mode")?.value || "local";
    return (
      <SplashLoading
        title="Synchronizing Workspace & AI Mode…"
        subtitle={`Reading website configuration & setting engine to ${String(activeMode).toUpperCase()} mode before launch.`}
      />
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
      <Suspense
        fallback={
          <SplashLoading
            title="Synchronizing Workspace…"
            subtitle="Connecting to org realtime channel, loading camera rules & zone profiles."
          />
        }
      >
      {/* Mounted once, above both screens: Workspace's camera tiles are what
          actually call useAlertIngest() (that's where live telemetry is), so
          this has to wrap Workspace for alerts to be generated at all. It
          renders nothing itself — the Alerts tab inside Workspace is the only
          place any alert is ever shown — so ingestion runs identically
          whichever screen is visible. */}
      <AlertProvider
        onOpenLiveFeed={(camId) => {
          setCurrentScreen("workspace");
          setPendingLiveCam({ id: camId, nonce: Date.now() });
        }}
      >
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
            openLiveCam={pendingLiveCam}
            openAlertsSignal={openAlertsSignal}
          />
        </div>
      )}
      {showAdmin && (
        <div
          className="h-full w-full"
          style={{ display: currentScreen === "admin-studio" || appType === "admin" ? "block" : "none" }}
        >
          <AdminStudio
            orgId={bundle?.organization?.id ?? null}
            onDeactivated={() => {
              if (appType === "admin") {
                setPhase("needs-activation");
              } else {
                setCurrentScreen("workspace");
              }
            }}
            onOpenAlerts={() => {
              setCurrentScreen("workspace");
              setOpenAlertsSignal({ nonce: Date.now() });
            }}
          />
        </div>
      )}
      </AlertProvider>
      </Suspense>
    </div>
  );
}
