// GET /functions/v1/my-keys
// One-time delivery of generated credentials right after signup:
// user code, org code, license key. Row is deleted after first fetch —
// afterwards only the key hint remains visible anywhere.
import { userClient, json, corsHeaders } from "../_shared/util.ts";
import postgres from "npm:postgres@3";

// Initialize Postgres connection
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { data: auth } = await userClient(req).auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized" }, 401);

    // Fetch the provision_results row using direct SQL (bypassing PostgREST and RLS)
    const rows = await sql`
      SELECT user_code, org_code, license_key 
      FROM app.provision_results 
      WHERE user_id = ${auth.user.id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return json({ delivered: false }, 200);
    }

    const row = rows[0];

    // Delete the row since it is a one-time fetch
    await sql`
      DELETE FROM app.provision_results 
      WHERE user_id = ${auth.user.id}
    `;

    return json({
      delivered: true,
      user_code: row.user_code,
      org_code: row.org_code,
      license_key: row.license_key
    });
  } catch (e) {
    console.error("my-keys failed", e);
    return json({ error: "unexpected error" }, 500);  // details stay in the function log, not the response
  }
});
