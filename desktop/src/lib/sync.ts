// Realtime sync: after activation the desktop downloads the full state bundle,
// then keeps it fresh by subscribing to org-scoped postgres changes.
// Admin edits (roles, cameras, licenses, AI settings) apply live — no restart.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./session";

export interface SyncBundle {
  synced_at: string;
  profile: any;
  organization: any;
  permissions: string[];
  cameras: any[];
  settings: { scope: string; key: string; value: any }[];
  notifications: any[];
  ai_model_assignments: any[];
  analytics_drawings: any[];
  rule_engine_rules: any[];
  custom_ai_modes: any[];
  ai_model_packages: any[];
  zone_profile_configs: any[];
  floor_plans?: any[];
  floor_plan_cameras?: any[];
}

export const DEFAULT_OFFLINE_BUNDLE: SyncBundle = {
  synced_at: new Date().toISOString(),
  profile: { id: "local-user", email: "operator@camai.local", role: "admin" },
  organization: { id: "local-org", name: "CamAI Enterprise Node" },
  permissions: [
    "cameras.view",
    "cameras.manage",
    "alerts.view",
    "settings.manage",
    "analytics.view",
    "rules.manage",
  ],
  cameras: [
    {
      id: "cam-virtual-1",
      name: "Virtual Traffic Demo Feed",
      stream_url: "virtual://traffic_demo",
      status: "online",
      ai_mode: "traffic_analytics",
      fps: 30,
    },
  ],
  settings: [],
  notifications: [],
  ai_model_assignments: [],
  analytics_drawings: [],
  rule_engine_rules: [],
  custom_ai_modes: [],
  ai_model_packages: [],
  zone_profile_configs: [],
  floor_plans: [],
  floor_plan_cameras: [],
};

/** Thrown when the cloud says this device/activation is revoked — the app
 *  must clear the vault and fall back to the activation screen. */
export class DeactivatedError extends Error {
  constructor() { super("device deactivated by admin"); }
}

export async function fetchBundle(): Promise<SyncBundle> {
  const sb = await getSupabase();
  const stored = await window.camai.getStoredSession();
  const { data, error } = await sb.functions.invoke<SyncBundle>("desktop-sync", {
    headers: stored.ok && stored.device_id ? { "x-device-id": stored.device_id } : {},
  });
  if (error) {
    // 403 {code:"deactivated"} → admin revoked this device or its activation
    const status = (error as any)?.context?.status;
    if (status === 403) throw new DeactivatedError();
    throw new Error("sync failed");
  }
  if (!data) throw new Error("sync failed");
  // Snapshot for the next launch. Fire-and-forget: the UI already has the data
  // and must not wait on a disk write to render it.
  void window.camai.bundleCache.set(data);
  return data;
}

/**
 * The last bundle this install successfully synced, straight off disk.
 *
 * desktop-sync is an edge function — a cold invocation is comfortably the
 * single largest item on the startup budget, and until it answered the app had
 * literally nothing to draw but a spinner. It is also, on the overwhelming
 * majority of launches, about to return exactly what it returned last time.
 * So: render from this immediately, then correct with the live answer when it
 * lands. Stale-while-revalidate, with the staleness bounded by however long the
 * fetch takes.
 *
 * Guarded by session validity at the call site — a revoked device must not get
 * a workspace painted from cache (see App.tsx).
 */
export async function loadCachedBundle(): Promise<SyncBundle | null> {
  try {
    const cached = await window.camai.bundleCache.get();
    // Shape check, not a version check: a bundle written by an older build is
    // still useful, but half a bundle would crash the workspace on mount.
    if (cached && typeof cached === "object" && Array.isArray((cached as SyncBundle).cameras)) {
      return cached as SyncBundle;
    }
    return DEFAULT_OFFLINE_BUNDLE;
  } catch {
    return DEFAULT_OFFLINE_BUNDLE;
  }
}

const WATCHED_TABLES = [
  "cameras", "camera_assignments", "settings", "user_roles",
  "role_permissions", "licenses", "license_activations", "devices",
  "profiles", "notifications", "ai_model_assignments",
  "analytics_drawings", "rule_engine_rules", "custom_ai_modes",
  "ai_model_packages", "config_versions", "zone_profile_configs",
  "floor_plans", "floor_plan_cameras", "floor_plan_permissions"
];

/** Re-fetches the bundle (debounced) whenever anything relevant changes.
 *  Calls onDeactivated when the cloud fails this device closed. */
export async function startRealtimeSync(
  onBundle: (b: SyncBundle) => void,
  onDeactivated?: () => void,
): Promise<() => void> {
  const sb = await getSupabase();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let stopped = false;

  // Started before anything else in this function. The bundle fetch is the one
  // thing the UI is actually waiting on; opening a WebSocket and registering 17
  // postgres_changes bindings is not, and used to run in front of it.
  const initial = fetchBundle();

  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        onBundle(await fetchBundle());
      } catch (e) {
        if (e instanceof DeactivatedError) onDeactivated?.();
        // other errors are transient — the next event retries
      }
    }, 400);
  };

  const subscribe = () => {
    if (stopped || channel) return;
    const channelName = `org-sync-${Math.random().toString(36).substring(2, 9)}`;
    let ch = sb.channel(channelName);
    for (const table of WATCHED_TABLES) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }
    ch.subscribe();
    channel = ch;
  };

  // Initial load. Deliver it, then bring realtime up — live updates are worth
  // nothing before there is a workspace to update, and the socket handshake
  // has no business on the path to first paint.
  //
  // Nothing is rethrown: the caller may already be rendering from the cached
  // bundle, and a transient sync failure must not tear that down. A genuine
  // revocation is the one case that has to act, and it does.
  try {
    onBundle(await initial);
    subscribe();
  } catch (e) {
    if (e instanceof DeactivatedError) {
      onDeactivated?.();
      return () => { stopped = true; };
    }
    // Transient. Come up on realtime anyway and retry with backoff, so a launch
    // that raced the network doesn't sit on the splash until something in the
    // database happens to change.
    subscribe();
    let attempt = 0;
    const retry = async () => {
      if (stopped || attempt >= 6) return;
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15_000)));
      if (stopped) return;
      try {
        onBundle(await fetchBundle());
      } catch (err) {
        if (err instanceof DeactivatedError) { onDeactivated?.(); return; }
        void retry();
      }
    };
    void retry();
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (channel) sb.removeChannel(channel);
  };
}
