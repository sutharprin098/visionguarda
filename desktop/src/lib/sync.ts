// Realtime sync: after activation the desktop downloads the full state bundle,
// then keeps it fresh by subscribing to org-scoped postgres changes.
// Admin edits (roles, cameras, licenses, AI settings) apply live — no restart.
import { getSupabase } from "./session";

export interface SyncBundle {
  synced_at: string;
  profile: any;
  organization: any;
  permissions: string[];
  cameras: any[];
  gis_layers: any[];
  polygon_roi: any[];
  line_roi: any[];
  speed_zones: any[];
  settings: { scope: string; key: string; value: any }[];
  notifications: any[];
}

export async function fetchBundle(): Promise<SyncBundle> {
  const sb = await getSupabase();
  const { data, error } = await sb.functions.invoke<SyncBundle>("desktop-sync");
  if (error || !data) throw new Error("sync failed");
  return data;
}

const WATCHED_TABLES = [
  "cameras", "camera_assignments", "gis_layers", "gis_layer_assignments",
  "polygon_roi", "line_roi", "speed_zones", "settings", "user_roles",
  "role_permissions", "licenses", "devices", "profiles", "notifications",
];

/** Re-fetches the bundle (debounced) whenever anything relevant changes. */
export async function startRealtimeSync(onBundle: (b: SyncBundle) => void): Promise<() => void> {
  const sb = await getSupabase();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        onBundle(await fetchBundle());
      } catch { /* transient — next event retries */ }
    }, 400);
  };

  let channel = sb.channel("org-sync");
  for (const table of WATCHED_TABLES) {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
  }
  channel.subscribe();

  onBundle(await fetchBundle()); // initial load

  return () => {
    sb.removeChannel(channel);
  };
}
