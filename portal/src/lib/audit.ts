import { supabase } from "./supabase";
import { browserInfo } from "./format";

/** Fire-and-forget audit entry with module + old/new values + client context. */
export function audit(
  action: string,
  targetType: string,
  targetId: string,
  opts: { module?: string; old?: unknown; new?: unknown; detail?: Record<string, unknown> } = {},
) {
  const { browser, os } = browserInfo();
  void supabase.rpc("audit", {
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
}
