import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, MonitorDown, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AppRelease } from "../../lib/types";
import { PageHeader, Badge, Empty } from "../../components/ui";

function fmtSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "—";
}

export default function DownloadsPage() {
  const { data: releases } = useQuery({
    queryKey: ["releases"],
    queryFn: async () =>
      (await supabase.from("app_releases").select("*").order("published_at", { ascending: false })).data as AppRelease[],
  });

  async function download(r: AppRelease) {
    const { data } = await supabase.storage.from("releases").createSignedUrl(r.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    await supabase.rpc("audit", { p_action: "app.download", p_target_type: "release", p_target_id: r.version });
  }

  const latest = releases?.[0];

  return (
    <>
      <PageHeader title="Downloads" subtitle="CamAI Desktop for Windows. Activate with your license key." />

      {latest && (
        <div className="card mb-6 flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <MonitorDown size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-zinc-100">CamAI Desktop {latest.version}</h2>
                <Badge tone="accent">{latest.channel}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-zinc-500">
                {latest.min_os}+ · {fmtSize(latest.size_bytes)} · Released {format(new Date(latest.published_at), "dd MMM yyyy")}
              </p>
            </div>
          </div>
          <button className="btn-primary" onClick={() => download(latest)}>
            <Download size={15} /> Download EXE
          </button>
        </div>
      )}

      {!releases?.length ? (
        <Empty text="No releases published yet. Upload builds to the 'releases' storage bucket and register them in app_releases." />
      ) : (
        <div className="space-y-3">
          {releases.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-100">v{r.version}</span>
                  <Badge>{r.platform}</Badge>
                </div>
                <button className="btn-ghost text-xs" onClick={() => download(r)}>Download</button>
              </div>
              {r.release_notes && <p className="mt-2 whitespace-pre-line text-sm text-zinc-400">{r.release_notes}</p>}
              <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-600">
                <ShieldCheck size={12} />
                <span className="font-mono">SHA-256: {r.sha256}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
