import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, MonitorDown, ShieldAlert, Tag, Loader2, ShieldCheck, Copy, Check } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { GithubRelease } from "../../lib/types";
import { PageHeader, Badge, Empty } from "../../components/ui";

function ChecksumRow({ sha256 }: { sha256: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!sha256) {
    return <p className="mt-2 text-xs text-ink-3">No published checksum for this release.</p>;
  }
  return (
    <button
      className="mt-2 flex items-center gap-1.5 text-xs text-ink-3 hover:text-ink-1"
      title="Copy SHA-256 checksum"
      onClick={async () => {
        await navigator.clipboard.writeText(sha256);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      <ShieldCheck size={12} className="text-ok" />
      <span className="font-mono">SHA-256: {sha256.slice(0, 16)}…{sha256.slice(-8)}</span>
      {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  );
}

function fmtSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "—";
}

export default function DownloadsPage() {
  const { data, isLoading, isError } = useQuery({
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
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // The releases repo is typically private, so GitHub's plain
  // browser_download_url doesn't work unauthenticated — resolve a
  // short-lived presigned URL server-side (download-release audits the
  // download itself, so no separate client-side audit call is needed).
  async function download(r: GithubRelease) {
    if (!r.asset_id) return;
    setDownloadingId(r.asset_id);
    try {
      const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
        "download-release", { body: { asset_id: r.asset_id } },
      );
      if (error || !data?.url) return;
      window.open(data.url, "_blank");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <>
      <PageHeader title="Downloads" subtitle="CamAI Desktop for Windows. Activate with your license key." />

      {(data?.error || isError) && (
        <div className="card mb-6 flex items-center gap-2 p-4 text-sm text-warn">
          <ShieldAlert size={16} />
          {data?.error ?? "Could not reach the release service right now. Please try again shortly."}
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
                <h2 className="font-semibold text-ink-1">CamAI Desktop {latest.version}</h2>
                {latest.prerelease && <Badge tone="warn">pre-release</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-ink-3">
                {fmtSize(latest.size_bytes)} · Released {format(new Date(latest.published_at), "dd MMM yyyy")}
              </p>
              <ChecksumRow sha256={latest.checksum_sha256} />
            </div>
          </div>
          <button className="btn-primary" onClick={() => download(latest)} disabled={downloadingId != null && downloadingId === latest.asset_id}>
            {downloadingId === latest.asset_id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {downloadingId === latest.asset_id ? "Preparing…" : "Download EXE"}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-ink-3">Fetching latest releases from GitHub…</p>
      ) : isError && !releases.length ? (
        <Empty text="Could not load releases right now. Please try again in a moment." />
      ) : !releases.length ? (
        <Empty text="No Windows builds published yet. Publish a GitHub Release with an .exe asset to show it here." />
      ) : (
        <div className="space-y-3">
          {releases.map((r) => (
            <div key={r.tag_name} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag size={13} className="text-ink-3" />
                  <span className="text-sm font-medium text-ink-1">{r.name}</span>
                  {r.prerelease && <Badge tone="warn">pre-release</Badge>}
                </div>
                <button className="btn-ghost btn-sm" onClick={() => download(r)} disabled={downloadingId === r.asset_id}>
                  {downloadingId === r.asset_id ? "Preparing…" : "Download"}
                </button>
              </div>
              {r.release_notes && <p className="mt-2 whitespace-pre-line text-sm text-ink-2">{r.release_notes}</p>}
              <div className="mt-2 flex items-center gap-3 text-xs text-ink-3">
                <span>{format(new Date(r.published_at), "dd MMM yyyy")}</span>
                <span>{fmtSize(r.size_bytes)}</span>
                {r.asset_name && <span className="font-mono">{r.asset_name}</span>}
              </div>
              <ChecksumRow sha256={r.checksum_sha256} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
