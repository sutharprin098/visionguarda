import { useEffect, useState } from "react";
import { Download, Play, Pause, CheckCircle2, AlertCircle, ShieldAlert, Cpu } from "lucide-react";
import { getSupabase } from "../lib/session";

interface ModelPackage {
  id: string;
  name: string;
  task: string;
  runtime: string;
  version: string;
  size_bytes: number;
  checksum: string;
  signature: string;
  download_url: string;
  release_notes?: string;
  hardware_support?: string[];
}

interface DownloadState {
  status: "idle" | "downloading" | "paused" | "complete" | "error";
  percent?: number;
  speed?: number; // bytes/sec
  remainingSeconds?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

export default function ModelManagerUI({
  modelPackages,
  activeModelName,
  orgId,
  canConfigure,
}: {
  modelPackages: ModelPackage[];
  activeModelName?: string;
  orgId: string;
  canConfigure: boolean;
}) {
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});

  // Fetch initial download status for all packages
  useEffect(() => {
    async function checkStatuses() {
      const states: Record<string, DownloadState> = {};
      for (const pkg of modelPackages) {
        try {
          const res = await (window as any).camai.getDownloadStatus({ modelName: pkg.name });
          if (res.ok) {
            states[pkg.name] = {
              status: res.status,
              downloadedBytes: res.downloadedBytes,
              totalBytes: res.totalBytes,
              speed: res.speed,
            };
          }
        } catch (e) {
          console.error(e);
        }
      }
      setDownloads(states);
    }
    checkStatuses();
  }, [modelPackages]);

  // Handle download progress listeners
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];

    modelPackages.forEach((pkg) => {
      const unsub = (window as any).camai.onDownloadProgress(pkg.name, (progress: any) => {
        setDownloads((prev) => ({
          ...prev,
          [pkg.name]: {
            status: progress.status,
            percent: progress.percent,
            speed: progress.speed,
            remainingSeconds: progress.remainingSeconds,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            error: progress.error,
          },
        }));
      });
      unsubscribes.push(unsub);
    });

    return () => unsubscribes.forEach((unsub) => unsub());
  }, [modelPackages]);

  async function handleDownload(pkg: ModelPackage) {
    try {
      setDownloads((prev) => ({
        ...prev,
        [pkg.name]: { status: "downloading", percent: 0 },
      }));
      await (window as any).camai.downloadModel({
        url: pkg.download_url,
        modelName: pkg.name,
        expectedChecksum: pkg.checksum,
        signature: pkg.signature,
      });
    } catch (e: any) {
      setDownloads((prev) => ({
        ...prev,
        [pkg.name]: { status: "error", error: e.message },
      }));
    }
  }

  async function handlePause(pkg: ModelPackage) {
    try {
      await (window as any).camai.pauseDownload({ modelName: pkg.name });
    } catch (e: any) {
      console.error(e);
    }
  }

  async function handleActivate(pkg: ModelPackage) {
    if (!canConfigure) return;
    try {
      const sb = await getSupabase();
      await sb.from("settings").upsert({
        org_id: orgId,
        scope: "org",
        key: "ai.model",
        value: pkg.name,
      });
    } catch (e) {
      console.error("Failed to activate model:", e);
    }
  }

  function formatBytes(bytes?: number): string {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function formatSpeed(bytesPerSec?: number): string {
    if (!bytesPerSec) return "0 KB/s";
    return `${formatBytes(bytesPerSec)}/s`;
  }

  function formatEta(seconds?: number): string {
    if (seconds === undefined) return "Calculating...";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Enterprise AI Models</h3>
          <p className="text-xs text-zinc-500">Download and deploy authorized neural networks across your hardware.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {modelPackages.map((pkg) => {
          const download = downloads[pkg.name] || { status: "idle" };
          const isActive = activeModelName === pkg.name;
          const isDownloaded = download.status === "complete";
          const isDownloading = download.status === "downloading";
          const isPaused = download.status === "paused";

          return (
            <div key={pkg.id} className={`card p-4 relative border transition flex flex-col justify-between ${isActive ? "border-accent/50 bg-accent/5" : "border-line"}`}>
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-sm text-zinc-200">{pkg.name}</h4>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      <span className="text-[10px] bg-surface-2 px-1.5 py-0.5 rounded text-zinc-400 font-mono capitalize">
                        {pkg.task}
                      </span>
                      <span className="text-[10px] bg-surface-2 px-1.5 py-0.5 rounded text-zinc-400 font-mono capitalize">
                        {pkg.runtime}
                      </span>
                      <span className="text-[10px] bg-surface-2 px-1.5 py-0.5 rounded text-zinc-400 font-mono">
                        v{pkg.version}
                      </span>
                    </div>
                  </div>

                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    isActive ? "bg-accent/15 text-accent" :
                    isDownloaded ? "bg-ok/15 text-ok" :
                    isDownloading ? "bg-warn/15 text-warn animate-pulse" :
                    isPaused ? "bg-surface-3 text-zinc-400" :
                    "bg-surface-2 text-zinc-500"
                  }`}>
                    {isActive ? "Active" : isDownloaded ? "Downloaded" : isDownloading ? "Downloading" : isPaused ? "Paused" : "Not Downloaded"}
                  </span>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-zinc-500">
                  <div className="flex items-center gap-1.5">
                    <Cpu size={12} className="text-zinc-400" />
                    <span>Hardware: {Array.isArray(pkg.hardware_support) ? pkg.hardware_support.join(", ") : "CPU, GPU"}</span>
                  </div>
                  {pkg.release_notes && <p className="italic text-[11px] leading-relaxed">{pkg.release_notes}</p>}
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-line">
                {/* Progress bar for active downloads */}
                {(isDownloading || isPaused) && (
                  <div className="mb-3 space-y-1.5">
                    <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                      <span>{formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}</span>
                      {isDownloading && (
                        <span>
                          {formatSpeed(download.speed)} • ETA: {formatEta(download.remainingSeconds)}
                        </span>
                      )}
                      {isPaused && <span className="text-zinc-500">Paused</span>}
                    </div>
                    <div className="h-1.5 w-full bg-surface-0 rounded-full overflow-hidden">
                      <div className="h-full bg-accent transition-all duration-300" style={{ width: `${download.percent || 0}%` }} />
                    </div>
                  </div>
                )}

                {/* Error handling */}
                {download.status === "error" && (
                  <div className="mb-3 flex items-center gap-2 rounded bg-danger/10 border border-danger/25 p-2 text-xs text-danger">
                    <AlertCircle size={13} className="shrink-0" />
                    <span className="truncate">{download.error || "Verification failed"}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  {!isDownloaded && !isDownloading && !isPaused && (
                    <button
                      onClick={() => handleDownload(pkg)}
                      className="btn-accent flex items-center gap-1.5 text-xs px-3 py-1.5"
                    >
                      <Download size={13} />
                      Download ({formatBytes(pkg.size_bytes)})
                    </button>
                  )}

                  {isDownloading && (
                    <button
                      onClick={() => handlePause(pkg)}
                      className="btn-surface flex items-center gap-1.5 text-xs px-3 py-1.5"
                    >
                      <Pause size={13} />
                      Pause
                    </button>
                  )}

                  {isPaused && (
                    <button
                      onClick={() => handleDownload(pkg)}
                      className="btn-accent flex items-center gap-1.5 text-xs px-3 py-1.5"
                    >
                      <Play size={13} />
                      Resume
                    </button>
                  )}

                  {isDownloaded && !isActive && (
                    <button
                      onClick={() => handleActivate(pkg)}
                      disabled={!canConfigure}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded transition ${
                        canConfigure
                          ? "bg-ok hover:bg-ok-hover text-white font-medium shadow-sm"
                          : "bg-surface-3 text-zinc-500 cursor-not-allowed"
                      }`}
                    >
                      <CheckCircle2 size={13} />
                      Deploy Model
                    </button>
                  )}

                  {isActive && (
                    <div className="flex items-center gap-1 text-[11px] text-accent font-medium font-mono py-1">
                      <CheckCircle2 size={13} /> Live Inference Active
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
