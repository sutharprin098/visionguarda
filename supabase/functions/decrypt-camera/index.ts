// POST /functions/v1/decrypt-camera  { camera_id }
// Camera connection strings are stored AES-256-GCM encrypted (CAMAI_AES_KEY
// lives only in edge-function secrets, per PLATFORM.md's security model) —
// nothing outside an edge function can ever decrypt one. This is the one
// endpoint that does: the desktop app calls it for each camera assigned to
// the signed-in user so the local AI engine (server/, on localhost) can
// open the real RTSP/HTTP source and serve the MJPEG preview.
//
// Authorization is just "can this JWT read this camera row" — the query
// runs through the caller's own RLS-scoped client, so it naturally returns
// nothing for a camera the user isn't assigned to (or doesn't have
// cameras.manage for), exactly like every other read in this app.
import { userClient, json, corsHeaders, rateLimit, decryptSecret } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const db = userClient(req);
  const { data: auth } = await db.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  if (!rateLimit(`decrypt-camera:${auth.user.id}`, 60, 60_000)) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  let cameraId: string | undefined;
  try {
    ({ camera_id: cameraId } = await req.json());
  } catch { /* no body */ }
  if (!cameraId) return json({ error: "camera_id required" }, 400);

  const { data: cam } = await db
    .from("cameras")
    .select("id, name, source_type, connection_encrypted")
    .eq("id", cameraId)
    .maybeSingle();
  if (!cam) return json({ error: "camera not found or not assigned to you" }, 404);
  if (!cam.connection_encrypted) return json({ error: "camera has no connection configured" }, 422);

  try {
    const connection = await decryptSecret(cam.connection_encrypted);
    return json({ id: cam.id, name: cam.name, source_type: cam.source_type, connection });
  } catch {
    return json({ error: "failed to decrypt connection" }, 500);
  }
});
