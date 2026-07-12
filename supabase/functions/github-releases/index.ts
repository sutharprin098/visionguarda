// GET /functions/v1/github-releases
// Live proxy over the GitHub Releases API — the portal never stores or
// hardcodes a download link. Configure via edge-function secrets:
//   GITHUB_RELEASES_REPO = "owner/repo"   (required)
//   GITHUB_TOKEN         = a PAT with public_repo read (optional, raises rate limit)
import { json, corsHeaders, rateLimit, adminClient } from "../_shared/util.ts";

interface GhAsset {
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}
interface GhRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
  assets: GhAsset[];
}

// Shared across warm invocations of this function instance only — a soft
// cache to stay well under GitHub's rate limit, not a source of truth.
let cache: { at: number; repo: string; data: unknown } | null = null;
const CACHE_MS = 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (!rateLimit(`gh-releases:${ip}`, 30, 60_000)) {
    return json({ error: "too many requests, retry later" }, 429);
  }

  const repo = Deno.env.get("GITHUB_RELEASES_REPO") ?? "";
  if (!repo) return json({ releases: [], error: "GITHUB_RELEASES_REPO is not configured" });

  if (cache && cache.repo === repo && Date.now() - cache.at < CACHE_MS) {
    return json(cache.data);
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "camai-portal",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = Deno.env.get("GITHUB_TOKEN");
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=10`, { headers });
  if (!res.ok) {
    return json({ releases: [], error: `github api error (${res.status})` });
  }
  const raw = (await res.json()) as GhRelease[];

  const releases = raw
    .filter((r) => !r.draft)
    .map((r) => {
      const asset =
        r.assets.find((a) => a.name.toLowerCase().endsWith(".exe")) ??
        r.assets.find((a) => a.name.toLowerCase().endsWith(".msi")) ??
        null;
      return {
        version: r.tag_name.replace(/^v/i, ""),
        tag_name: r.tag_name,
        name: r.name || r.tag_name,
        release_notes: r.body ?? "",
        published_at: r.published_at,
        prerelease: r.prerelease,
        asset_name: asset?.name ?? null,
        size_bytes: asset?.size ?? 0,
        content_type: asset?.content_type ?? "",
        download_url: asset?.browser_download_url ?? null,
      };
    })
    // only surface releases that actually shipped a Windows installer asset
    .filter((r) => r.download_url);

  // Announce a new release to every organization the first time it's seen.
  // The watermark lives in the internal `app` schema (service-role only).
  if (releases.length) {
    const latest = releases[0];
    const db = adminClient();
    const { data: mark } = await db.from("release_watermark").select("last_tag").eq("id", true).maybeSingle();
    if (mark?.last_tag !== latest.tag_name) {
      await db.from("release_watermark").upsert({ id: true, last_tag: latest.tag_name });
      await db.rpc("notify_new_release", { p_tag: latest.tag_name, p_title: latest.name });
    }
  }

  const data = { releases };
  cache = { at: Date.now(), repo, data };
  return json(data);
});
