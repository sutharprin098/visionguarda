// Unwraps supabase-js FunctionsHttpError into something a human can act on.
//
// functions.invoke() rejects every non-2xx with the *same* opaque message —
// "Edge Function returned a non-2xx status code" — and hides the actual JSON
// body (and the status code) on error.context, which is an unconsumed
// Response. Nothing was reading it, so a plain 400 "org_id required" reached
// the user as an unactionable string with no status, no reason, no clue which
// step failed. Always clone() before reading: the caller may read it too, and
// a Response body can only be consumed once.
export interface FnFailure {
  status: number | null;   // HTTP status, null if the request never got a response
  message: string;         // the server's own error text where available
  body: unknown;           // parsed body, for logging
}

export async function describeFnError(error: any): Promise<FnFailure> {
  const res: Response | undefined = error?.context instanceof Response ? error.context : undefined;

  // No Response at all => transport-level failure (DNS, offline, CORS preflight).
  if (!res) {
    return {
      status: null,
      message: error?.message
        ? `Could not reach the server: ${error.message}`
        : "Could not reach the server.",
      body: null,
    };
  }

  let body: unknown = null;
  let message = "";
  try {
    const text = await res.clone().text();
    if (text) {
      try {
        body = JSON.parse(text);
        const e = (body as any)?.error;
        message = typeof e === "string" ? e : e?.message ?? (body as any)?.message ?? text;
      } catch {
        body = text;      // non-JSON body (e.g. an HTML gateway error page)
        message = text;
      }
    }
  } catch {
    /* body already consumed or unreadable — fall through to the status-only message */
  }

  return {
    status: res.status,
    message: message.trim() || `${res.status} ${res.statusText || "request failed"}`,
    body,
  };
}

/** Human-readable one-liner: "Publish failed (403): forbidden — needs cameras.manage" */
export async function fnErrorMessage(step: string, error: any): Promise<string> {
  const f = await describeFnError(error);
  console.error(`[${step}] failed`, { status: f.status, message: f.message, body: f.body });
  return f.status === null ? `${step} failed: ${f.message}` : `${step} failed (HTTP ${f.status}): ${f.message}`;
}
