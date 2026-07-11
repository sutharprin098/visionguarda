// GET /functions/v1/my-keys
// One-time delivery of generated credentials right after signup:
// user code, org code, license key. Row is deleted after first fetch —
// afterwards only the key hint remains visible anywhere.
import { adminClient, userClient, json, corsHeaders } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const { data: auth } = await userClient(req).auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  const db = adminClient();
  const { data: row } = await db
    .from("provision_results")
    .select("user_code, org_code, license_key")
    .eq("user_id", auth.user.id)
    .maybeSingle()
    .setHeader("Accept-Profile", "app"); // table lives in schema app

  if (!row) return json({ delivered: false }, 200);

  await db
    .from("provision_results")
    .delete()
    .eq("user_id", auth.user.id)
    .setHeader("Content-Profile", "app");

  return json({ delivered: true, ...row });
});
