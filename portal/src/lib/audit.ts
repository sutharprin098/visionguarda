import { supabase } from "./supabase";
import { browserInfo } from "./format";

/**
 * Fire-and-forget audit entry with module + old/new values + client context.
 * Doesn't block the caller's primary action on logging latency, but the
 * failure is never silently swallowed — a failed audit write is logged to
 * the console (and, if window.__camaiAuditFailed is set by the host app,
 * reported there) so a broken audit trail is visible instead of invisible.
 */
export async function audit(
  action: string,
  targetType: string,
  targetId: string,
  opts: { module?: string; old?: unknown; new?: unknown; detail?: Record<string, unknown> } = {},
): Promise<void> {
  const { browser, os } = browserInfo();
  const { error } = await supabase.rpc("audit", {
    p_action: action,
    p_target_type: targetType,
    p_target_id: targetId,
    p_detail: opts.detail ?? {},
    p_module: opts.module ?? "",
    p_old: opts.old ?? null,
    p_new: opts.new ?? null,
    p_browser: browser,
    p_os: os,
  });
  if (!error) return;
  console.error(`[audit] failed to record "${action}" on ${targetType}:${targetId}`, error.message);
  (window as any).__camaiAuditFailed?.({ action, targetType, targetId, message: error.message });
}
