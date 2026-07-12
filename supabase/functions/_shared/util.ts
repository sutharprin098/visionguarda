// Shared helpers for CamAI edge functions (Deno runtime)
import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  source_type: "rtsp" | "onvif" | "usb" | "ip" | "nvr" | "dvr";
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
  let timer: number;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function verifyCameraConnection(
  f: CameraFields,
): Promise<{ ok: boolean; message: string }> {
  if (f.source_type === "usb") {
    return { ok: true, message: "USB devices are opened and verified locally by the desktop app." };
  }
  if (!f.host) return { ok: false, message: "camera IP / host is required" };
  const port = f.port ?? DEFAULT_PORTS[f.source_type] ?? 554;

  let conn: Deno.TcpConn;
  try {
    conn = await withTimeout(Deno.connect({ hostname: f.host, port }), 4000);
  } catch {
    return { ok: false, message: `Could not reach ${f.host}:${port} — check the IP, port, and that it is reachable from the internet (firewall/port-forwarding).` };
  }

  try {
    if (f.source_type === "rtsp" || f.source_type === "nvr" || f.source_type === "dvr") {
      const path = f.path ? (f.path.startsWith("/") ? f.path : `/${f.path}`) : "/";
      const req = `OPTIONS rtsp://${f.host}:${port}${path} RTSP/1.0\r\nCSeq: 1\r\n\r\n`;
      await withTimeout(conn.write(new TextEncoder().encode(req)), 3000);
      const buf = new Uint8Array(256);
      const n = await withTimeout(conn.read(buf), 3000);
      const text = n ? new TextDecoder().decode(buf.subarray(0, n)) : "";
      if (/^RTSP\/\d/.test(text)) {
        return { ok: true, message: "RTSP endpoint responded — connection verified." };
      }
      return { ok: true, message: "Port is open and reachable; response was not a standard RTSP handshake." };
    }
    // onvif / ip: reachability is the check — full ONVIF profile negotiation happens on activation
    return { ok: true, message: `${f.host}:${port} is reachable.` };
  } catch {
    return { ok: true, message: "Port is open, but the device did not respond before the timeout." };
  } finally {
    try { conn.close(); } catch { /* already closed */ }
  }
}

// ---- naive in-memory rate limiter (per edge instance) ----
const hits = new Map<string, { n: number; t: number }>();
export function rateLimit(key: string, max = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > windowMs) {
    hits.set(key, { n: 1, t: now });
    return true;
  }
  h.n++;
  return h.n <= max;
}
