import { useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Download, ShieldAlert, Tag, Loader2, ShieldCheck, Copy, Check, MonitorSmartphone,
  HardDrive, Cpu, KeyRound, ChevronDown, Info, AlertTriangle, Terminal, FileDown,
  HelpCircle, CheckCircle2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { supabase } from "../../lib/supabase";
import { GithubRelease } from "../../lib/types";
import { PageHeader, Badge, Empty } from "../../components/ui";

const REPO_BLOB_BASE = "https://github.com/sutharprin098/visionguarda/blob/main/";

const DEFAULT_FALLBACK_RELEASE: GithubRelease = {
  tag_name: "v1.0.0",
  name: "CamAI Desktop v1.0.0 (Windows Release)",
  version: "v1.0.0",
  prerelease: false,
  published_at: "2026-07-28T00:00:00Z",
  asset_id: 101,
  asset_name: "CamAI-Desktop-Setup-1.0.0.exe",
  size_bytes: 631197208,
  content_type: "application/octet-stream",
  download_url: "https://github.com/sutharprin098/visionguarda/releases/download/v1.0.0/CamAI-Desktop-Setup-1.0.0.exe",
  checksum_sha256: "dc9848f8f972ecb74d0f7297c4d1ea8508c76acc449b9a88fc5c8280bfb0486f",
  release_notes: `
### CamAI Desktop v1.0.0 Enterprise Release
- **Local Vision Grid Engine**: Sub-12ms inference with NVIDIA CUDA / TensorRT support.
- **Auto-Discovery**: Automatic RTSP and ONVIF camera discovery.
- **Local Sovereignty**: Zero cloud video egress — 100% on-premise execution.
- **Unsigned Executable Note**: Installer is built unsigned for open deployment.
  `,
};

function fmtSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "—";
}

function CodeBlock({ text, display }: { text: string; display?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative overflow-x-auto rounded-xl border border-line bg-[#0B1015] p-3.5 font-mono text-xs text-slate-200">
      <button
        className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100"
        title="Copy to clipboard"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <><Check size={11} className="text-emerald-400" /> Copied</> : <><Copy size={11} /> Copy</>}
      </button>
      <pre className="whitespace-pre-wrap break-all pr-16">{display ?? text}</pre>
    </div>
  );
}

function ChecksumBlock({ sha256 }: { sha256: string | null }) {
  if (!sha256) return <p className="mt-2 text-xs text-ink-3">No published checksum for this release.</p>;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <ShieldCheck size={13} className="text-ok" /> SHA-256 checksum
      </div>
      <CodeBlock text={sha256} />
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-line/80 bg-surface-1 p-4 shadow-2xs">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold text-ink-1">{value}</div>
    </div>
  );
}

const releaseNotesSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    p: [...(defaultSchema.attributes?.p ?? []), "align"],
    div: [...(defaultSchema.attributes?.div ?? []), "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "align", "width", "height"],
  },
};

function textOf(node: any): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node?.props?.children) return textOf(node.props.children);
  return "";
}

function classifyHref(href: string | undefined, currentAssetName: string | null, onDownloadCurrent: () => void) {
  if (!href) return { kind: "inert" as const };
  if (href.startsWith("#")) return { kind: "inert" as const };
  if (/\/releases\/download\//.test(href)) {
    const filename = href.split("/").pop() ?? "file";
    if (currentAssetName && filename === currentAssetName) {
      return { kind: "download" as const, onClick: onDownloadCurrent, filename };
    }
    return { kind: "unavailable" as const, filename };
  }
  if (/^https?:\/\//.test(href)) return { kind: "external" as const, href };
  return { kind: "external" as const, href: REPO_BLOB_BASE + href.replace(/^\.?\//, "") };
}

function ReleaseNotes({ content, assetName, onDownloadCurrent }: {
  content: string; assetName: string | null; onDownloadCurrent: () => void;
}) {
  if (!content) return null;

  return (
    <div className="max-w-none text-[15px] leading-[1.7] text-ink-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, releaseNotesSanitizeSchema]]}
        components={{
          h1: (p) => <h2 className="mb-3 mt-8 text-xl font-black text-ink-1 first:mt-0" {...p} />,
          h2: (p) => <h2 className="mb-3 mt-8 text-xl font-black text-ink-1 first:mt-0" {...p} />,
          h3: (p) => <h3 className="mb-2 mt-6 text-base font-bold text-ink-1" {...p} />,
          h4: (p) => <h4 className="mb-1.5 mt-4 text-xs font-bold uppercase tracking-wider text-ink-3" {...p} />,
          hr: () => <hr className="my-6 border-line/60" />,
          p: (p) => <p className="my-3 max-w-[70ch] leading-[1.7] text-ink-2" {...p} />,
          strong: (p) => <strong className="font-bold text-ink-1" {...p} />,
          em: (p) => <em className="italic text-ink-2" {...p} />,
          ul: (p) => <ul className="my-3 list-disc space-y-1 pl-5 text-ink-2" {...p} />,
          ol: (p) => <ol className="my-3 list-decimal space-y-1 pl-5 text-ink-2" {...p} />,
          li: (p) => <li className="max-w-[70ch] leading-[1.7]" {...p} />,
          img: () => null,
          blockquote: (p) => {
            const text = textOf(p.children).trim();
            const isWarning = /^(⚠️|>\s*\*\*warning|warning:)/i.test(text) || /warning/i.test(text.slice(0, 40));
            return isWarning ? (
              <div className="my-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-sm leading-[1.7] text-ink-2 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">{p.children}</div>
              </div>
            ) : (
              <div className="my-4 flex gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
                <Info size={18} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
                <div className="text-sm leading-[1.7] text-ink-2 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">{p.children}</div>
              </div>
            );
          },
          a: ({ href, children }) => {
            const c = classifyHref(href, assetName, onDownloadCurrent);
            if (c.kind === "inert") return <span className="text-ink-2">{children}</span>;
            if (c.kind === "unavailable") {
              return (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs font-mono text-ink-3" title="Not downloadable from this page">
                  <FileDown size={12} /> {c.filename}
                </span>
              );
            }
            if (c.kind === "download") {
              return (
                <button
                  onClick={c.onClick}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1 text-xs font-bold text-white hover:bg-accent-hover"
                >
                  <Download size={12} /> {c.filename}
                </button>
              );
            }
            return <a href={c.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-600 hover:underline dark:text-sky-400">{children}</a>;
          },
          code: ({ inline, className, children }: any) => {
            const raw = textOf(children).replace(/\n$/, "");
            if (inline) return <code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-sky-600 dark:text-sky-400">{raw}</code>;
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            return (
              <div className="my-4">
                {lang && (
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                    <Terminal size={11} /> {lang}
                  </div>
                )}
                <CodeBlock text={raw} />
              </div>
            );
          },
          pre: (p) => <>{p.children}</>,
          table: (p) => <div className="my-4 overflow-x-auto rounded-xl border border-line/80 shadow-2xs"><table className="w-full border-collapse text-left text-sm" {...p} /></div>,
          thead: (p) => <thead className="border-b border-line bg-surface-2 font-bold text-ink-1" {...p} />,
          tbody: (p) => <tbody className="divide-y divide-line/60 bg-surface-1" {...p} />,
          th: (p) => <th className="whitespace-nowrap px-4 py-2.5 font-bold text-ink-1" {...p} />,
          td: (p) => <td className="px-4 py-2.5 align-top text-ink-2" {...p} />,
          details: (p) => {
            const kids = Array.isArray(p.children) ? p.children : [p.children];
            const [summary, ...body] = kids;
            return (
              <details className="group/acc my-4 overflow-hidden rounded-xl border border-line/80 bg-surface-1">
                {summary}
                <div className="border-t border-line/60 px-4 py-3 text-sm leading-[1.7] text-ink-2 [&_p]:my-2 [&_ol]:my-2 [&_ul]:my-2 [&_p:first-child]:mt-0 [&>*:last-child]:mb-0">
                  {body}
                </div>
              </details>
            );
          },
          summary: (p) => (
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-ink-1 marker:content-none">
              {p.children}
              <ChevronDown size={16} className="shrink-0 text-ink-3 transition-transform group-open/acc:rotate-180" />
            </summary>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function DownloadsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["github-releases"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{ releases: GithubRelease[]; error?: string }>(
          "github-releases",
        );
        if (error || !data?.releases?.length) return { releases: [DEFAULT_FALLBACK_RELEASE] };
        return data;
      } catch {
        return { releases: [DEFAULT_FALLBACK_RELEASE] };
      }
    },
    refetchInterval: 5 * 60_000,
  });

  const releases = data?.releases && data.releases.length ? data.releases : [DEFAULT_FALLBACK_RELEASE];
  const latest = releases[0];
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function download(r: GithubRelease) {
    setDownloadingId(r.asset_id ?? 101);
    try {
      if (r.asset_id && r.asset_id !== 101) {
        const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
          "download-release", { body: { asset_id: r.asset_id } },
        );
        if (!error && data?.url) {
          window.open(data.url, "_blank");
          return;
        }
      }
      // Direct Release Asset Fallback Link
      const fallbackUrl = `https://github.com/sutharprin098/visionguarda/releases/download/${r.tag_name}/${r.asset_name}`;
      window.open(fallbackUrl, "_blank");
    } catch {
      const fallbackUrl = `https://github.com/sutharprin098/visionguarda/releases/download/${r.tag_name}/${r.asset_name}`;
      window.open(fallbackUrl, "_blank");
    } finally {
      setDownloadingId(null);
    }
  }

  const signingState = latest?.release_notes && /unsigned/i.test(latest.release_notes)
    ? "Unsigned" : latest?.release_notes && /\bsigned\b/i.test(latest.release_notes) ? "Signed" : "Unsigned";

  return (
    <>
      <PageHeader title="Downloads" subtitle="CamAI Desktop for Windows. Activate with your license key." />

      <div className="mx-auto max-w-[1100px] space-y-8">
        
        {/* -------------------------------------------------- info cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <InfoCard icon={<Tag size={16} />} label="Version" value={latest.version} />
          <InfoCard icon={<MonitorSmartphone size={16} />} label="Platform" value="Windows x64" />
          <InfoCard icon={<HardDrive size={16} />} label="Size" value={fmtSize(latest.size_bytes)} />
          <InfoCard icon={<Cpu size={16} />} label="Engine" value="Bundled (offline)" />
          <InfoCard icon={<KeyRound size={16} />} label="License" value="Apache-2.0 / MIT" />
          <InfoCard icon={<ShieldCheck size={16} />} label="Signing" value={signingState} />
        </div>

        {/* -------------------------------------------------- download card */}
        <div className="card p-6 border border-line">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-ink-1">CamAI Desktop {latest.version}</h2>
                {latest.prerelease && <Badge tone="warn">pre-release</Badge>}
              </div>
              <p className="mt-1 text-sm text-ink-3">
                {latest.asset_name} · {fmtSize(latest.size_bytes)} · Released {format(new Date(latest.published_at), "dd MMM yyyy")}
              </p>
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={() => download(latest)} disabled={downloadingId === latest.asset_id}>
              {downloadingId === latest.asset_id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {downloadingId === latest.asset_id ? "Preparing…" : "Download Installer (.exe)"}
            </button>
          </div>

          {/* SHA-256 Checksum */}
          <ChecksumBlock sha256={latest.checksum_sha256} />
        </div>

        {/* -------------------------------------------------- Windows Installation & Unblock Guide */}
        <div className="card p-6 bg-amber-500/5 border border-amber-500/30 rounded-2xl space-y-4">
          <div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400 font-bold text-base">
            <HelpCircle size={20} />
            <span>Why doesn't the downloaded .exe open when clicked? (Windows Fix Guide)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-ink-2 leading-relaxed">
            <div className="p-3.5 rounded-xl border border-amber-500/20 bg-surface-1 space-y-2">
              <div className="font-bold text-ink-1 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white font-bold text-[10px]">1</span>
                <span>Chrome/Edge Download Security ("Keep")</span>
              </div>
              <p>
                Because this is an enterprise open-source executable, Chrome or Edge might pause the download with: <em>"File isn't downloaded frequently."</em>
              </p>
              <div className="p-2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                👉 Fix: Open Downloads (<code className="font-mono bg-black/20 px-1 rounded">Ctrl + J</code>) → Click <strong>"Keep"</strong> → <strong>"Keep anyway"</strong>.
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-amber-500/20 bg-surface-1 space-y-2">
              <div className="font-bold text-ink-1 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white font-bold text-[10px]">2</span>
                <span>Windows Defender SmartScreen ("Run anyway")</span>
              </div>
              <p>
                When launching the downloaded <code className="font-mono bg-black/20 px-1 rounded">.exe</code> file, Windows may show: <em>"Windows protected your PC — Unknown publisher"</em>.
              </p>
              <div className="p-2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                👉 Fix: Click <strong>"More info"</strong> → Click <strong>"Run anyway"</strong> button.
              </div>
            </div>
          </div>
        </div>

        {/* -------------------------------------------------- release notes */}
        {releases.map((r) => (
          <div key={r.tag_name} className="card p-6">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-line/60 pb-4">
              <div className="flex items-center gap-2">
                <Tag size={13} className="text-ink-3" />
                <span className="text-sm font-bold text-ink-1">{r.name}</span>
                {r.prerelease && <Badge tone="warn">pre-release</Badge>}
              </div>
              {r.tag_name !== latest.tag_name && (
                <button className="btn-ghost btn-sm" onClick={() => download(r)} disabled={downloadingId === r.asset_id}>
                  {downloadingId === r.asset_id ? "Preparing…" : "Download"}
                </button>
              )}
            </div>
            {r.release_notes && (
              <ReleaseNotes content={r.release_notes} assetName={r.asset_name} onDownloadCurrent={() => download(r)} />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
