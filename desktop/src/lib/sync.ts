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
  settings: { scope: string; key: string; value: any }[];
  notifications: any[];
}

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
  return data;
}

const WATCHED_TABLES = [
  "cameras", "camera_assignments", "settings", "user_roles",
  "role_permissions", "licenses", "license_activations", "devices",
  "profiles", "notifications",
];

/** Re-fetches the bundle (debounced) whenever anything relevant changes.
 *  Calls onDeactivated when the cloud fails this device closed. */
export async function startRealtimeSync(
  onBundle: (b: SyncBundle) => void,
  onDeactivated?: () => void,
): Promise<() => void> {
  const sb = await getSupabase();
  let timer: ReturnType<typeof setTimeout> | null = null;

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

  let channel = sb.channel("org-sync");
  for (const table of WATCHED_TABLES) {
    channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
  }
  channel.subscribe();

  onBundle(await fetchBundle()); // initial load — DeactivatedError propagates to the caller

  return () => {
    sb.removeChannel(channel);
  };
}
