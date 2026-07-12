// Shared helpers for CamAI edge functions (Deno runtime)
import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // x-device-id: desktop-sync's device-binding header (desktop/src/lib/sync.ts)
  // — the desktop app's UI runs in an Electron BrowserWindow (a real Chromium
  // renderer, not the CORS-exempt Node main process), so a custom header
  // missing from this allowlist blocks the actual browser-level request at
  // the CORS preflight, not just at the server. Verified live: desktop-sync
  // calls with this header failed with "Failed to fetch" before this fix.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Service-role client — bypasses RLS. Never expose to browsers. */
export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/** Client bound to the caller's JWT — RLS applies. */
export function userClient(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    },
  );
}

export async function sha256hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- AES-256-GCM for camera connection secrets (key: CAMAI_AES_KEY, 32-byte hex) ----
async function aesKey(): Promise<CryptoKey> {
  const hex = Deno.env.get("CAMAI_AES_KEY")!;
  const raw = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(),
    new TextEncoder().encode(plaintext),
  );
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...out));
}

export async function decryptSecret(b64: string): Promise<string> {
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf.slice(0, 12) },
    await aesKey(),
    buf.slice(12),
  );
  return new TextDecoder().decode(pt);
}

// ---- camera connection verification ----
// Cameras are typically on the customer's LAN; a cloud edge function can
// only prove a host:port is reachable (and, for RTSP, that something
// speaking RTSP answers). It cannot decode video. That reachability check
// is still the substantive part of "verify before saving" — it catches the
// overwhelming majority of setup mistakes: wrong IP, wrong port, camera
// off, firewall/port-forwarding not set up. USB sources are opened locally
// by the desktop's AI engine and can't be probed from the cloud at all.
export interface CameraFields {
  source_type: "rtsp" | "onvif" | "usb" | "ip" | "nvr" | "dvr" | "screen_share";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string; // e.g. /Streaming/Channels/101, or a USB device index
}

const DEFAULT_PORTS: Record<string, number> = { rtsp: 554, nvr: 554, dvr: 554, onvif: 80, ip: 80 };

export function buildConnectionUri(f: CameraFields): string {
  if (f.source_type === "usb") return f.path ?? "0";
  const port = f.port ?? DEFAULT_PORTS[f.source_type] ?? 554;
  const scheme = f.source_type === "onvif" || f.source_type === "ip" ? "http" : "rtsp";
  const auth = f.username ? `${encodeURIComponent(f.username)}:${encodeURIComponent(f.password ?? "")}@` : "";
  const path = f.path ? (f.path.startsWith("/") ? f.path : `/${f.path}`) : "";
  return `${scheme}://${auth}${f.host}:${port}${path}`;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface CameraChannel { path: string; ok: boolean; note: string }
export interface CameraVerifyResult {
  ok: boolean;
  message: string;
  device_info?: { manufacturer?: string; model?: string; firmware?: string };
  channels?: CameraChannel[];
}

// Sends one RTSP request and returns the raw response text (or "" on no reply).
async function rtspRoundtrip(host: string, port: number, method: string, path: string, cseq: number): Promise<string> {
  const conn = await withTimeout(Deno.connect({ hostname: host, port }), 3000);
  try {
    const req = `${method} rtsp://${host}:${port}${path} RTSP/1.0\r\nCSeq: ${cseq}\r\nAccept: application/sdp\r\n\r\n`;
    await withTimeout(conn.write(new TextEncoder().encode(req)), 2500);
    const buf = new Uint8Array(512);
    const n = await withTimeout(conn.read(buf), 2500);
    return n ? new TextDecoder().decode(buf.subarray(0, n)) : "";
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
}

// NVR/DVR "channel enumeration": a cloud function can't do local ONVIF
// WS-Discovery (that's UDP multicast on the camera's own LAN — only
// something running on that LAN, i.e. the desktop app, could ever do it).
// What it *can* do for a port-forwarded NVR is probe the handful of URL
// conventions the major vendors actually use and report which channels are
// live, via RTSP DESCRIBE (which — unlike OPTIONS — makes the server
// resolve the specific stream path, so a bad channel number reliably 404s).
const CHANNEL_TEMPLATES = [
  (n: number) => `/Streaming/Channels/${n}01`,               // Hikvision / clones
  (n: number) => `/cam/realmonitor?channel=${n}&subtype=0`,  // Dahua / clones
  (n: number) => `/ch${String(n).padStart(2, "0")}/0`,       // generic
];

async function probeNvrChannels(host: string, port: number, maxChannels = 8): Promise<CameraChannel[]> {
  const probes: Promise<CameraChannel>[] = [];
  let cseq = 1;
  for (let ch = 1; ch <= maxChannels; ch++) {
    for (const tmpl of CHANNEL_TEMPLATES) {
      const path = tmpl(ch);
      const seq = cseq++;
      probes.push(
        (async (): Promise<CameraChannel> => {
          try {
            const text = await rtspRoundtrip(host, port, "DESCRIBE", path, seq);
            const status = text.match(/^RTSP\/\d\.\d (\d{3})/)?.[1];
            if (status === "200") return { path, ok: true, note: "channel live" };
            if (status === "401") return { path, ok: true, note: "channel exists (needs credentials)" };
            return { path, ok: false, note: status ? `RTSP ${status}` : "no response" };
          } catch {
            return { path, ok: false, note: "no response" };
          }
        })(),
      );
    }
  }
  const results = await Promise.all(probes);
  return results.filter((r) => r.ok);
}

// ONVIF device probe: a real SOAP GetDeviceInformation call against the
// well-known device service path, not just "the port answered HTTP".
async function probeOnvifDevice(host: string, port: number): Promise<{ manufacturer?: string; model?: string; firmware?: string } | null> {
  const envelope =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap:Body><GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/></soap:Body></soap:Envelope>';
  try {
    const res = await withTimeout(
      fetch(`http://${host}:${port}/onvif/device_service`, {
        method: "POST",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8" },
        body: envelope,
      }),
      4000,
    );
    const text = await res.text();
    const tag = (name: string) => text.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`))?.[1];
    const manufacturer = tag("Manufacturer");
    if (!manufacturer && !tag("Model")) return null; // not actually an ONVIF device
    return { manufacturer, model: tag("Model"), firmware: tag("FirmwareVersion") };
  } catch {
    return null;
  }
}

export async function verifyCameraConnection(f: CameraFields): Promise<CameraVerifyResult> {
  if (f.source_type === "usb" || f.source_type === "screen_share") {
    return {
      ok: true,
      message: f.source_type === "usb"
        ? "USB devices are opened and verified locally by the desktop app."
        : "Screen sharing is virtual and active on the desktop client."
    };
  }
  if (!f.host) return { ok: false, message: "camera IP / host is required" };

  const isPrivateIp = (host: string): boolean => {
    const h = host.trim().toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
    const parts = h.split(".").map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 169 && b === 254) return true;
    }
    return false;
  };

  if (isPrivateIp(f.host)) {
    return { ok: true, message: `Local/private IP address (${f.host}) bypassed cloud verification. The desktop app will connect to it locally.` };
  }

  const port = f.port ?? DEFAULT_PORTS[f.source_type] ?? 554;

  let conn: Deno.TcpConn;
  try {
    conn = await withTimeout(Deno.connect({ hostname: f.host, port }), 4000);
  } catch {
    return { ok: false, message: `Could not reach ${f.host}:${port} — check the IP, port, and that it is reachable from the internet (firewall/port-forwarding).` };
  }
  try { conn.close(); } catch { /* already closed */ }

  if (f.source_type === "rtsp" || f.source_type === "nvr" || f.source_type === "dvr") {
    const path = f.path ? (f.path.startsWith("/") ? f.path : `/${f.path}`) : "/";
    let handshake = "";
    try {
      handshake = await rtspRoundtrip(f.host, port, "OPTIONS", path, 1);
    } catch { /* handled below */ }

    if (f.source_type === "nvr" || f.source_type === "dvr") {
      const channels = await probeNvrChannels(f.host, port);
      if (channels.length) {
        return {
          ok: true,
          message: `Reachable — found ${channels.length} live channel${channels.length === 1 ? "" : "s"} across the common Hikvision/Dahua/generic URL patterns.`,
          channels,
        };
      }
      return {
        ok: true,
        message: "Port is open, but no channel matched the common Hikvision/Dahua/generic URL patterns — enter the exact channel path manually.",
      };
    }
    if (/^RTSP\/\d/.test(handshake)) {
      return { ok: true, message: "RTSP endpoint responded — connection verified." };
    }
    return { ok: true, message: "Port is open and reachable; response was not a standard RTSP handshake." };
  }

  if (f.source_type === "onvif") {
    const info = await probeOnvifDevice(f.host, port);
    if (info) {
      return {
        ok: true,
        message: `ONVIF device confirmed — ${info.manufacturer ?? "unknown manufacturer"} ${info.model ?? ""}`.trim(),
        device_info: info,
      };
    }
    return {
      ok: true,
      message: `${f.host}:${port} is reachable, but did not answer ONVIF GetDeviceInformation at /onvif/device_service — full profile negotiation happens on activation.`,
    };
  }

  // ip: reachability is the check
  return { ok: true, message: `${f.host}:${port} is reachable.` };
}

// ---- Postgres-backed rate limiter ----
// Edge Function instances are stateless and horizontally scaled with no
// per-caller affinity — an in-memory counter here never reliably
// accumulates across the requests it's meant to be counting (verified
// live: 25 rapid calls against a 20/min limit, zero rejected). The
// counter has to live somewhere every instance shares, so it lives in
// Postgres (app.rate_limits, see 0024_db_backed_rate_limiter.sql),
// updated via a single atomic upsert so concurrent instances can't
// race each other into both passing.
export async function rateLimit(key: string, max = 10, windowMs = 60_000): Promise<boolean> {
  const db = adminClient();
  const { data, error } = await db.schema("app").rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: Math.round(windowMs / 1000),
  });
  // Fail open on an infra hiccup (e.g. the rate-limit table itself is
  // unreachable) — a broken limiter must not take down the endpoint it's
  // supposed to be protecting.
  if (error) {
    console.error("rateLimit check failed, failing open", error);
    return true;
  }
  return !!data;
}
