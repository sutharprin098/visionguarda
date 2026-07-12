// POST /functions/v1/download-release  { asset_id: number }
// Resolves a GitHub release asset to a short-lived, presigned download URL.
// Needed because GITHUB_RELEASES_REPO is typically private — GitHub's plain
// browser_download_url only works unauthenticated for public repos. Here we
// hit the asset API with Accept: application/octet-stream and our own
// GITHUB_TOKEN, and hand the caller the presigned redirect location GitHub
// returns — the actual multi-hundred-MB file bytes never pass through this
// function, only a short JSON response.
import { userClient, json, corsHeaders, rateLimit } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { data: auth } = await userClient(req).auth.getUser();
    if (!auth?.user) return json({ error: "unauthorized" }, 401);

    if (!rateLimit(`download-release:${auth.user.id}`, 20, 60_000)) {
      return json({ error: "too many requests, retry later" }, 429);
    }

    let assetId: number | undefined;
    try {
      ({ asset_id: assetId } = await req.json());
    } catch { /* no body */ }
    if (!assetId || !Number.isInteger(assetId)) return json({ error: "asset_id required" }, 400);

    const repo = Deno.env.get("GITHUB_RELEASES_REPO") ?? "";
    const token = Deno.env.get("GITHUB_TOKEN") ?? "";
    if (!repo) return json({ error: "GITHUB_RELEASES_REPO is not configured" }, 500);
    if (!token) return json({ error: "GITHUB_TOKEN is not configured — required to download from a private repo" }, 500);

    const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${assetId}`, {
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${token}`,
        "User-Agent": "camai-portal",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
    });

    // GitHub responds with a 302 to a presigned, time-limited asset URL.
    const location = res.headers.get("location");
    if (res.status !== 302 || !location) {
      return json({ error: `could not resolve download (github status ${res.status})` }, 502);
    }

    await userClient(req).rpc("audit", {
      p_action: "app.download", p_target_type: "release", p_target_id: String(assetId), p_module: "downloads",
    });

    return json({ url: location });
  } catch (e) {
    console.error("download-release failed", e);
    return json({ error: e instanceof Error ? e.message : "unexpected error" }, 500);
  }
});
