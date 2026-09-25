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
  // Default local camera for edge/ACAP standalone mode
  cameras: [
    {
      id: "axis-local-cam",
      name: "Axis Edge Camera",
      stream_url: "/axis-cgi/media.cgi?videocodec=h264",
      status: "online",
      rtsp_url: "",
      source_type: "axis",
      type: "axis",
      zone_profile: "traffic",
    },
  ],
  settings: [
    { scope: "org", key: "ai.inference_mode", value: "cloud" },
    { scope: "org", key: "ai.cloud_endpoint_url", value: "http://13.203.71.14:8000" },
  ],
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

export class DeactivatedError extends Error {
  constructor() { super("device deactivated by admin"); }
}

export const isAcapMode = () =>
  typeof window !== "undefined" &&
  (window.location.pathname.includes("/local/camai_acap/") ||
   window.location.port === "42093" ||
   window.location.protocol === "https:" ||
   !(window as any).camai?.getStoredSession);

export async function fetchBundle(): Promise<SyncBundle> {
  if (isAcapMode()) {
    return DEFAULT_OFFLINE_BUNDLE;
  }
  try {
    const sb = await getSupabase();
    const stored = await window.camai.getStoredSession();
    const { data, error } = await sb.functions.invoke<SyncBundle>("desktop-sync", {
      headers: stored.ok && stored.device_id ? { "x-device-id": stored.device_id } : {},
    });
    if (!error && data) {
      void window.camai.bundleCache.set(data);
      return data;
    }
  } catch {
    /* edge fallback */
  }
  return DEFAULT_OFFLINE_BUNDLE;
}

/**
 * The last bundle this install successfully synced, straight off disk.
 */
export async function loadCachedBundle(): Promise<SyncBundle | null> {
  if (isAcapMode()) {
    return DEFAULT_OFFLINE_BUNDLE;
  }
  try {
    const cached = await window.camai.bundleCache.get();
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
  if (isAcapMode()) {
    onBundle(DEFAULT_OFFLINE_BUNDLE);
    return () => {};
  }
  const sb = await getSupabase();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let stopped = false;

  const initial = fetchBundle();

  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        onBundle(await fetchBundle());
      } catch (e) {
        if (e instanceof DeactivatedError) onDeactivated?.();
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

  try {
    onBundle(await initial);
    subscribe();
  } catch (e) {
    if (e instanceof DeactivatedError) {
      onDeactivated?.();
      return () => { stopped = true; };
    }
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
