import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, MonitorDown, ShieldAlert, Tag } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { audit } from "../../lib/audit";
import { GithubRelease } from "../../lib/types";
import { PageHeader, Badge, Empty } from "../../components/ui";

function fmtSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "—";
}

export default function DownloadsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["github-releases"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<{ releases: GithubRelease[]; error?: string }>(
        "github-releases",
      );
      if (error) throw error;
      return data!;
    },
    // GitHub is the source of truth — poll so a freshly published release
    // shows up here without the user having to reload.
    refetchInterval: 5 * 60_000,
  });

  const releases = data?.releases ?? [];
  const latest = releases[0];

  function download(r: GithubRelease) {
    if (!r.download_url) return;
    window.open(r.download_url, "_blank");
    audit("app.download", "release", r.tag_name, { module: "downloads", detail: { version: r.version } });
  }

  return (
    <>
      <PageHeader title="Downloads" subtitle="CamAI Desktop for Windows. Activate with your license key." />

      {data?.error && (
        <div className="card mb-6 flex items-center gap-2 p-4 text-sm text-warn">
          <ShieldAlert size={16} /> {data.error}
        </div>
      )}

      {latest && (
        <div className="card mb-6 flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <MonitorDown size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-zinc-100">CamAI Desktop {latest.version}</h2>
                {latest.prerelease && <Badge tone="warn">pre-release</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-zinc-500">
                {fmtSize(latest.size_bytes)} · Released {format(new Date(latest.published_at), "dd MMM yyyy")}
              </p>
            </div>
          </div>
          <button className="btn-primary" onClick={() => download(latest)}>
            <Download size={15} /> Download EXE
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-ink-3">Fetching latest releases from GitHub…</p>
      ) : !releases.length ? (
        <Empty text="No Windows builds published yet. Publish a GitHub Release with an .exe asset to show it here." />
      ) : (
        <div className="space-y-3">
          {releases.map((r) => (
            <div key={r.tag_name} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag size={13} className="text-ink-3" />
                  <span className="text-sm font-medium text-zinc-100">{r.name}</span>
                  {r.prerelease && <Badge tone="warn">pre-release</Badge>}
                </div>
                <button className="btn-ghost text-xs" onClick={() => download(r)} disabled={!r.download_url}>
                  Download
                </button>
              </div>
              {r.release_notes && <p className="mt-2 whitespace-pre-line text-sm text-zinc-400">{r.release_notes}</p>}
              <div className="mt-2 flex items-center gap-3 text-xs text-zinc-600">
                <span>{format(new Date(r.published_at), "dd MMM yyyy")}</span>
                <span>{fmtSize(r.size_bytes)}</span>
                {r.asset_name && <span className="font-mono">{r.asset_name}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
