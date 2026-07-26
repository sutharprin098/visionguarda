// GET /functions/v1/github-releases
// Live proxy over the GitHub Releases API — the portal never stores or
// hardcodes a download link. Configure via edge-function secrets:
//   GITHUB_RELEASES_REPO = "owner/repo"   (required)
//   GITHUB_TOKEN         = a PAT with (at least) read access to Releases.
//                          Required if the repo is private — GitHub's plain
//                          browser_download_url only works unauthenticated
//                          for public repos. See download-release for the
//                          authenticated resolver the portal actually uses.
import { json, corsHeaders, rateLimit, adminClient } from "../_shared/util.ts";

interface GhAsset {
  id: number;
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

// Fetches a tiny <installer>.sha256 companion asset's text content via the
// authenticated asset API (same pattern as download-release), never the
// multi-hundred-MB installer itself.
async function fetchChecksum(repo: string, asset: GhAsset, apiHeaders: Record<string, string>): Promise<string | null> {
  if (asset.size > 4096) return null; // sanity guard — a real .sha256 is a one-liner
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/assets/${asset.id}`, {
      headers: { ...apiHeaders, Accept: "application/octet-stream" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const hex = text.trim().split(/\s+/)[0];
    return /^[0-9a-f]{64}$/i.test(hex) ? hex.toLowerCase() : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Every path below must return through json() (which always carries
  // corsHeaders) — an uncaught throw would fall through to Deno's default
  // error response, which has no CORS headers at all. The browser then
  // reports a misleading "CORS error" instead of the real failure.
  try {
    // Last X-Forwarded-For hop, not the first: the first is whatever the caller
    // typed, so a per-IP limit keyed on it is bypassed by varying the header.
    const _xff = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const ip = _xff.length ? _xff[_xff.length - 1] : "unknown";
    if (!(await rateLimit(`gh-releases:${ip}`, 30, 60_000))) {
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

    const releases = await Promise.all(
      raw
        .filter((r) => !r.draft)
        .map(async (r) => {
          const asset =
            r.assets.find((a) => a.name.toLowerCase().endsWith(".exe")) ??
            r.assets.find((a) => a.name.toLowerCase().endsWith(".msi")) ??
            r.assets.find((a) => a.name.toLowerCase().endsWith(".zip")) ??
            null;
          // The desktop build emits a tiny <installer>.sha256 text file
          // alongside the installer (see desktop/scripts/checksum.js) —
          // fetch that (a few dozen bytes) rather than ever hashing the
          // multi-hundred-MB installer inside this function.
          const checksumAsset = asset
            ? r.assets.find((a) => a.name.toLowerCase() === `${asset.name.toLowerCase()}.sha256`)
            : null;
          const checksum_sha256 = checksumAsset ? await fetchChecksum(repo, checksumAsset, headers) : null;
          return {
            version: r.tag_name.replace(/^v/i, ""),
            tag_name: r.tag_name,
            name: r.name || r.tag_name,
            release_notes: r.body ?? "",
            published_at: r.published_at,
            prerelease: r.prerelease,
            asset_id: asset?.id ?? null,
            asset_name: asset?.name ?? null,
            size_bytes: asset?.size ?? 0,
            content_type: asset?.content_type ?? "",
            checksum_sha256,
            // Only actually usable unauthenticated for a public repo — for a
            // private repo the portal must resolve via download-release instead.
            download_url: asset?.browser_download_url ?? null,
          };
        }),
    ).then((all) => all.filter((r) => r.asset_id != null)); // only surface releases that actually shipped a Windows build

    // Announce a new release to every organization the first time it's seen.
    // The watermark lives in the internal `app` schema (service-role only).
    // Best-effort: a notification failure must never break the Downloads page.
    if (releases.length) {
      try {
        const latest = releases[0];
        const db = adminClient();
        const { data: mark } = await db.from("release_watermark").select("last_tag").eq("id", true).maybeSingle();
        if (mark?.last_tag !== latest.tag_name) {
          await db.from("release_watermark").upsert({ id: true, last_tag: latest.tag_name });
          await db.rpc("notify_new_release", { p_tag: latest.tag_name, p_title: latest.name });
        }
      } catch (e) {
        console.error("release-watermark/notify failed (non-fatal)", e);
      }
    }

    const data = { releases };
    cache = { at: Date.now(), repo, data };
    return json(data);
  } catch (e) {
    console.error("github-releases failed", e);
    return json({ releases: [], error: "unexpected error" }, 500);  // details stay in the function log
  }
});
