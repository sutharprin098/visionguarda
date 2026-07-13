import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: { autoRefreshToken: true, persistSession: true },
    realtime: { params: { eventsPerSecond: 10 } },
  },
);

export async function invokeFn<T = any>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data as T;
}

export async function getErrorMessage(error: any): Promise<string> {
  if (!error) return "";
  let msg = error.message || "An unexpected error occurred.";
  if (error.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.clone().json();
      if (body) {
        if (typeof body.error === "string") {
          msg = body.error;
        } else if (body.error && typeof body.error === "object") {
          msg = body.error.message || JSON.stringify(body.error);
        } else if (body.message) {
          msg = body.message;
        }
      }
    } catch (_) {
      try {
        const text = await error.context.clone().text();
        if (text) msg = text;
      } catch (__) {}
    }
  }
  if (msg === "{}" || !msg.trim() || msg === "Edge Function returned a non-2xx status code") {
    msg = "Operation failed. If you are adding a Screen Share camera or deleting your account, please copy and run the SQL migration (0028_fix_constraints_and_foreign_keys.sql) inside the SQL Editor of your Supabase Dashboard first.";
  }
  return msg;
}
