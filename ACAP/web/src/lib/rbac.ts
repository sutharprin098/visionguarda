import type { SyncBundle } from "./sync";

/**
 * Who is allowed to change configuration, decided from the signed-in user's
 * actual permissions rather than from which build they happen to be running.
 *
 * The gap this closes: admin access was `app.getName().includes("Admin Studio")`
 * (electron/main.ts getConfig). That is a BUILD flag — anyone launching the
 * Admin build got the full configuration UI regardless of their role, and a
 * normal user's clicks then failed silently against RLS.
 *
 * This is a UI gate only, and deliberately so. The server already enforces the
 * same rule and is the thing that actually protects the data — every config
 * table's RLS write policy is
 *
 *     app.is_super_admin() OR (org_id = app.current_org_id() AND app.has_perm('cameras.manage'))
 *
 * (cameras, analytics_drawings, rule_engine_rules, zone_profile_configs,
 * custom_ai_modes; settings uses 'ai.configure'), and publish-config /
 * rollback-config re-check cameras.manage in the edge function before touching
 * the security-definer RPC. So a user who bypasses this file — patches the
 * renderer, calls the IPC directly, hits PostgREST by hand — still gets
 * rejected by Postgres. What this fixes is the UI lying about what the user can
 * do, and the silent write failures that follow.
 */

/** Permission that gates camera/zone/rule/profile configuration. Matches the
 *  string the RLS policies and edge functions check. */
export const PERM_CONFIGURE = "cameras.manage";
/** Permission that gates AI/engine settings (settings table RLS). */
export const PERM_AI_SETTINGS = "ai.configure";

export function isSuperAdmin(bundle: SyncBundle | null): boolean {
  return !!(bundle?.profile as { is_super_admin?: boolean } | undefined)?.is_super_admin;
}

export function can(bundle: SyncBundle | null, permission: string): boolean {
  if (!bundle) return false;
  // Mirrors app.has_perm(): super admin bypasses the org-scoped role check,
  // because platform staff hold no role row in any customer org.
  if (isSuperAdmin(bundle)) return true;
  return (bundle.permissions ?? []).includes(permission);
}

/** True when this user may open Admin Studio and change configuration. */
export function canConfigure(bundle: SyncBundle | null): boolean {
  return can(bundle, PERM_CONFIGURE);
}

/** Human-readable reason for the lock, shown rather than a bare disabled control
 *  so an operator knows to ask an admin instead of assuming the app is broken. */
export function lockReason(): string {
  return "Only an administrator can change configuration. Ask your admin for the cameras.manage permission.";
}
