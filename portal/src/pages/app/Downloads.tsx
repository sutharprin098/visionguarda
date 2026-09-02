import { useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Download, Tag, Loader2, ShieldCheck, Copy, Check, MonitorSmartphone,
  HardDrive, Cpu, ChevronDown, Info, AlertTriangle, Terminal, FileDown,
  HelpCircle, Calendar, Github, ArrowUpRight, PackageCheck,
  ShieldQuestion, KeyRound as KeyIcon, MousePointerClick,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { supabase } from "../../lib/supabase";
import { GithubRelease } from "../../lib/types";
import { PageHeader, Badge, Kpi } from "../../components/ui";

const REPO = "sutharprin098/visionguarda";
const REPO_URL = `https://github.com/${REPO}`;
const REPO_BLOB_BASE = `${REPO_URL}/blob/main/`;

// Shown only when the live `github-releases` edge function is unreachable —
// the page must never go blank just because that one call failed. Kept in
// sync with the real GitHub releases so a fallback view is never stale
// enough to mislead: same asset names, sizes and checksums as what's
// actually published.
const DEFAULT_FALLBACK_RELEASES: GithubRelease[] = [
  {
    tag_name: "v1.0.9",
    name: "CamAI Desktop v1.0.9 (Windows Release)",
    version: "v1.0.9",
    prerelease: false,
    published_at: "2026-09-03T01:25:00Z",
    asset_id: 110,
    asset_name: "CamAI-Desktop-Setup-1.0.9.exe",
    size_bytes: 356707397,
    content_type: "application/octet-stream",
    download_url: `/downloads/CamAI-Desktop-Setup-1.0.9.exe`,
    checksum_sha256: "27b124bb7c21cced5d0dbc33ab23144bbeeb9beccaaee6b545a273611d6bb281",
    release_notes: `
### 🚀 CamAI Desktop v1.0.9 & Mobile v1.0.9 Unified Release
- **CamAI Desktop v1.0.9**: Synchronized MJPEG frame burn-in overlay, aggressive RTSP socket backlog flushing, and sub-50ms hardware frame decoding.
- **Signed Android APK v1.0.9**: High-performance mobile client with 0-lag video-bounding-box synchronization and 24/7 background AI notification alerts.
    `,
  },
  {
    tag_name: "v1.0.8",
    name: "CamAI Desktop v1.0.8 (Windows Release)",
    version: "v1.0.8",
    prerelease: false,
    published_at: "2026-08-31T21:40:00Z",
    asset_id: 109,
    asset_name: "CamAI-Desktop-Setup-1.0.8.exe",
    size_bytes: 356706747,
    content_type: "application/octet-stream",
    download_url: `/downloads/CamAI-Desktop-Setup-1.0.8.exe`,
    checksum_sha256: "a0d7cdb1d53c48b8b299df2fad93b8e86d5f605ffb0ce39b4ab2b5bc5ed1f755",
    release_notes: `
### 🚀 CamAI Desktop v1.0.8 & Mobile v1.0.0 Unified Release
- **CamAI Desktop v1.0.8**: Bundled high-speed AI vision engine for Windows x64.
- **Signed Android APK v1.0.0**: Production release key signed APK with 24/7 background AI notification alerts and 1-Click OTA updates.
    `,
  },
  {
    tag_name: "v1.0.7",
    name: "CamAI Desktop v1.0.7 (Windows Release)",
    version: "v1.0.7",
    prerelease: false,
    published_at: "2026-08-28T18:50:00Z",
    asset_id: 108,
    asset_name: "CamAI-Desktop-Setup-1.0.7.exe",
    size_bytes: 356697721,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.7/CamAI-Desktop-Setup-1.0.7.exe`,
    checksum_sha256: "a21d36f9495c22812557c9afdb49826c70866d9a6c22a1dd47bc5a70330969c6",
    release_notes: `
### 🎯 Synchronized MJPEG Overlay & Zero Ghost Box AI Inference (v1.0.7)
- **Synchronized MJPEG Server Burn-in Overlay**: Direct zero-phase-mismatch visual overlay burn-in on MJPEG video frames, locking bounding boxes, speeds, and class labels to camera pixels at full 30 FPS.
- **Zero Ghost / Phantom Box Filtering**: Upgraded ByteTracker with \`n_init=2\` and \`COAST_RENDER_SECONDS=0.25s\` to eliminate floating ghost boxes on empty roads and single-frame false-positive detections.
- **High-Speed Stream Encoding Optimization**: Stream preview resizing before OpenCV drawing eliminates 1080p memory allocations, reducing pipeline decode latency and video stuttering.
- **Single Box Per Object Enforcement**: Enforced tracker-authoritative assignment in detection resolution to eliminate duplicate overlapping bounding boxes on moving vehicles.
    `,
  },
  {
    tag_name: "v1.0.6",
    name: "CamAI Desktop v1.0.6 (Windows Release)",
    version: "v1.0.6",
    prerelease: false,
    published_at: "2026-08-18T19:15:00Z",
    asset_id: 107,
    asset_name: "CamAI-Desktop-Setup-1.0.6.exe",
    size_bytes: 651028234,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.6/CamAI-Desktop-Setup-1.0.6.exe`,
    checksum_sha256: "316eaa0c25b1ea6065798ba05d4e79f00839217463d298220ccd28e00e4427fa",
    release_notes: `
### 🌙 Color-Preserving Zero-DCE Night Vision & Zero-Blackout Stream Auto-Reconnect (v1.0.6)
- **Zero Color Shifting Night-Vision AI**: Refactored Zero-DCE tone curve solver to operate strictly on Y-channel (Luminance) in YCrCb color space, eliminating all neon green/blue pixel distortions and over-exposure while preserving 100% natural colors.
- **Persistent Viewport & Auto-Reconnect**: Fixed Admin Studio stream error state handling to keep the stream viewport permanently mounted and auto-reconnect every 1s on network hiccups without unmounting into a black card.
- **Non-Blocking 30 FPS Synthetic Stream Recovery**: Capture thread emissions during network stream reconnects now generate smooth 30 FPS standby frames, keeping MJPEG connections alive and responsive at all times.
- **Auto-Launch Inactive Camera Threads**: FastAPI endpoints auto-launch inactive camera background threads upon stream request, resolving 404 stream errors.
    `,
  },
  {
    tag_name: "v1.0.5",
    name: "CamAI Desktop v1.0.5 (Windows Release)",
    version: "v1.0.5",
    prerelease: false,
    published_at: "2026-08-16T21:45:00Z",
    asset_id: 106,
    asset_name: "CamAI-Desktop-Setup-1.0.5.exe",
    size_bytes: 651025479,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.5/CamAI-Desktop-Setup-1.0.5.exe`,
    checksum_sha256: "8255137e1cc7c7c38d67dccc82c17e9072ba1ed61ea14327d0aba10116d8c601",
    release_notes: `
### ⚡ High Performance Grid & Seamless Fullscreen Transition (v1.0.5)
- **Zero Black Screen in Grid / Normal View**: Resolved state evaluation where camera streams turned black in non-fullscreen grid tiles.
- **Seamless Fullscreen & Minimize Transitions**: Fixed socket reconnection behavior when toggling between grid view and full-window mode.
- **Zero Socket Thrashing & Reduced Latency**: Eliminated repetitive DOM key remounts and CORS handshake retries, freeing HTTP socket pools for zero-lag rendering.
- **Auto Cache-Busting Reconnect**: Added automated smooth stream re-acquisition on network blips.
    `,
  },
  {
    tag_name: "v1.0.4",
    name: "CamAI Desktop v1.0.4 (Windows Release)",
    version: "v1.0.4",
    prerelease: false,
    published_at: "2026-08-16T18:00:00Z",
    asset_id: 105,
    asset_name: "CamAI-Desktop-Setup-1.0.4.exe",
    size_bytes: 651025479,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.4/CamAI-Desktop-Setup-1.0.4.exe`,
    checksum_sha256: "4bfe5948f1a2f064c6ea486bb06d93e89e331ea0fa64ed03f346e81b0cb53653",
    release_notes: `
### 🚀 Complete Production Stability & Enterprise Reliability (v1.0.4)
- **Instant Workspace Synchronization**: Integrated **Refresh Workspace (🔄)** control for zero-latency manual re-sync of cameras, zones, and rules from the database.
- **Zero Black-Screen Assurance**: Built-in 1-click **Virtual Stream Fallback** button on camera tiles to prevent blank states when network RTSP sources disconnect.
- **End-to-End RTSP Connection Hardening**: Hardened OpenCV 5s open/read timeouts, path slashes, and automated retry loops.
- **Containerized Server Deployment**: Embedded production-ready \`Dockerfile\` and \`docker-compose.yml\` for engine deployment with integrated health checks.
    `,
  },
  {
    tag_name: "v1.0.3",
    name: "CamAI Desktop v1.0.3 (Windows Release)",
    version: "v1.0.3",
    prerelease: false,
    published_at: "2026-08-16T12:00:00Z",
    asset_id: 104,
    asset_name: "CamAI-Desktop-Setup-1.0.3.exe",
    size_bytes: 651025479,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.3/CamAI-Desktop-Setup-1.0.3.exe`,
    checksum_sha256: "739535826d057717a6c6b743db7e0cedc7ca4a70f32050e3b17756b0f528daae",
    release_notes: `
### 🚀 Stream Stability, UI Sync & Docker Engine Deployment
- **Workspace Instant Refresh**: Added a dedicated **Refresh Workspace (🔄)** button to instantly re-sync camera configurations, zone rules, and live telemetry from the database without restarting.
- **Virtual Stream Fallback**: Embedded a 1-click **"Virtual Stream"** button on camera fault banners to immediately launch an active 30fps virtual demo stream whenever an external stream link is unreachable.
- **Fast Connection & Reconnect**: Implemented explicit 5-second open/read timeouts to prevent capture thread hangs on unresponsive network streams.
- **RTSP Path Normalization**: Auto-appends trailing slashes to bare RTSP targets for full compatibility with Android RTSP servers (pedroSG94).
- **Docker Engine Containerization**: Included high-performance Dockerfile and docker-compose orchestration in \`server/\` for zero-setup containerized engine execution.
    `,
  },
  {
    tag_name: "v1.0.2",
    name: "CamAI Desktop v1.0.2 (Windows Release)",
    version: "v1.0.2",
    prerelease: false,
    published_at: "2026-08-11T10:30:00Z",
    asset_id: 103,
    asset_name: "CamAI-Desktop-Setup-1.0.2.exe",
    size_bytes: 651025479,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.2/CamAI-Desktop-Setup-1.0.2.exe`,
    checksum_sha256: "d7bab93feacddd234570c8d71ff4979527085485dda33a48bfe6ae7309e99ac3",
    release_notes: `
### 🚀 Stability & Performance Hardening
- **Local Engine Supervisor Resilience**: Extended health probe timeout to 12s and adopted miss tolerance to 6 misses (30s). Added 750ms socket release delay to eliminate port 8000 TCP binding conflicts and crash loops.
- **Screen Capture WGC Error Fix**: Disabled WindowsGraphicsCapture and enabled GDIWindowCapture fallback to eliminate C++ \`ProcessFrame failed (-2147467259)\` pipeline errors.
- **Full-Width & Full-Screen UI Optimization**: Expanded single camera feed to fill 100% of workspace width and added a dedicated top-bar Full Screen action button.
- **Synchronized Health Polling**: Standardized frontend liveness check thresholds (5 retries) to prevent false-positive unreachable state warnings during AI model compilation.

### 🔒 Security & Distribution
- Unsigned Windows NSIS Installer bundled with local AI inference engine for 100% offline edge execution.
- Verified SHA-256: \`d7bab93feacddd234570c8d71ff4979527085485dda33a48bfe6ae7309e99ac3\`
    `,
  },
  {
    tag_name: "v1.0.1",
    name: "CamAI Desktop v1.0.1 (Windows Release)",
    version: "v1.0.1",
    prerelease: false,
    published_at: "2026-08-03T14:36:05Z",
    asset_id: 102,
    asset_name: "CamAI-Desktop-Setup-1.0.1.exe",
    size_bytes: 651000669,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.1/CamAI-Desktop-Setup-1.0.1.exe`,
    checksum_sha256: "bb344a54311130f7e4ae27781d6cde34c31bae15d92a3a2ddc07af8ed335dad1",
    release_notes: `
### 🚀 Improvements
- **Unified Alerts page**: every alert now lives in one realtime, searchable, filterable place — sort by severity, confidence or time, filter by camera, and scroll through history without losing your place. No more floating pop-ups, toasts or drawers scattered across the app.
- **Bulk workflows**: multi-select acknowledge and delete, plus one-click **CSV / JSON / PDF** export of any filtered or selected set of alerts.
- **Keyboard shortcuts** on the Alerts page — search, acknowledge, delete, and navigate without touching the mouse.
- The notification bell now does exactly one thing: shows the unread count and jumps straight to the Alerts page.
- **GPU-accelerated helmet & ANPR inference** on machines with a DirectML-capable GPU (previously silently CPU-only even when a GPU was available).
- Release publishing is now a single command with an automatically attached SHA-256 checksum.

### 🐛 Bug Fixes
- Eliminated helmet-detection false positives on **parked / riderless motorcycles** — a bike with no rider on it no longer raises a helmet violation. Verified over 5 rounds of live end-to-end testing against real traffic footage; 21/21 evidence crops correct on the final pass.
- Fixed a crash path that could silently zero out detections when a detection rule was configured with a plain \`true\`/\`false\` instead of an object.
- Fixed a dense-parking edge case where a real rider's violation could be mis-attributed to an adjacent parked motorcycle.
- Low-confidence vehicle classifications can no longer anchor a helmet or ANPR alert.
- Removed a redundant background polling loop that duplicated the realtime alert engine's own event stream.

### 🔒 Security & Distribution
- No security-relevant code changes in this release.
- Installer remains intentionally unsigned — verify the published SHA-256 checksum before running (see Known Issues).

### ⚠️ Known Issues
- The Windows installer is unsigned, so SmartScreen will show *"Windows protected your PC — Unknown publisher."* Click **More info → Run anyway**. A code-signing certificate is bound to a legal identity and isn't transferable, so this is deliberate until the acquiring organization signs future builds under its own identity.
    `,
  },
  {
    tag_name: "v1.0.0",
    name: "CamAI Desktop v1.0.0 (Windows Release)",
    version: "v1.0.0",
    prerelease: false,
    published_at: "2026-08-02T09:00:51Z",
    asset_id: 101,
    asset_name: "CamAI-Desktop-Setup-1.0.0.exe",
    size_bytes: 651011805,
    content_type: "application/octet-stream",
    download_url: `${REPO_URL}/releases/download/v1.0.0/CamAI-Desktop-Setup-1.0.0.exe`,
    checksum_sha256: "60bf9fb4f8ce30fbc2fe7bff6959db0c61609c1a3b32a06e55c98c8f94d1d81a",
    release_notes: `
### 🚀 New Features
- **Local Vision Grid Engine**: on-device inference pipeline, CUDA / TensorRT accelerated where available.
- **Auto-Discovery**: automatic RTSP and ONVIF camera discovery on the local network.
- **Local Sovereignty**: zero cloud video egress — 100% on-premise execution; only metadata and telemetry sync to the cloud.
- NSIS installer for Windows x64 with the AI engine bundled for fully offline operation.

### 🐛 Bug Fixes
- Fixed the packaged app reporting zero detections in some environments: the engine's WebSocket origin check rejected the \`file://\` origin Electron's renderer actually sends, silently dropping every telemetry connection (the AI pipeline itself was working the whole time).
- Fixed the bundled AI engine failing to unpack on some machines, which could leave every camera stuck at "Not Configured".
- Fixed the build pipeline occasionally shipping a stale bundled engine binary.

### 🔒 Security & Distribution
- Installer is intentionally unsigned for this release — see Known Issues.

### ⚠️ Known Issues
- The Windows installer is unsigned; SmartScreen will show *"Windows protected your PC — Unknown publisher."* Click **More info → Run anyway**.
- Verify integrity with the published \`.sha256\` checksum file before installing.
    `,
  },
];

function fmtSize(bytes: number) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "—";
}

function CodeBlock({ text, display }: { text: string; display?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative overflow-x-auto rounded-xl border border-line bg-[#0B1015] p-3.5 font-mono text-xs text-slate-200">
      <button
        className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-semibold text-slate-300 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
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
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <ShieldCheck size={13} className="text-ok" /> SHA-256 checksum
      </div>
      <CodeBlock text={sha256} />
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
          ul: (p) => <ul className="my-3 list-disc space-y-1.5 pl-5 text-ink-2" {...p} />,
          ol: (p) => <ol className="my-3 list-decimal space-y-1.5 pl-5 text-ink-2" {...p} />,
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

// ---------------------------------------------------------------------------
// Installation guide — four numbered steps plus a collapsible troubleshooting
// section, instead of one dense always-open block.
// ---------------------------------------------------------------------------

interface Step { title: string; body: ReactNode; icon: ReactNode }

const INSTALL_STEPS: Step[] = [
  {
    title: "Download the installer",
    icon: <Download size={16} />,
    body: <>Click <strong className="text-ink-1">Download Installer</strong> above. It's a single .exe served directly from GitHub Releases.</>,
  },
  {
    title: "Verify the checksum",
    icon: <ShieldCheck size={16} />,
    body: <>Optional but recommended — compare the file's SHA-256 against the checksum shown on this page before running it.</>,
  },
  {
    title: "Run it — allow SmartScreen",
    icon: <MousePointerClick size={16} />,
    body: <>Windows will warn <em>"Unknown publisher"</em> since this build is unsigned. Click <strong className="text-ink-1">More info → Run anyway</strong>.</>,
  },
  {
    title: "Activate with your license",
    icon: <KeyIcon size={16} />,
    body: <>Launch CamAI Desktop and enter the license key issued by your organization admin. No further setup needed.</>,
  },
];

interface FaqItem { q: string; a: ReactNode }

const TROUBLESHOOTING: FaqItem[] = [
  {
    q: `Chrome/Edge paused the download ("File isn't downloaded frequently")`,
    a: <>This is a heuristic warning browsers show for less-common executables, not a detection of anything wrong. Open Downloads (<code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-xs">Ctrl + J</code>), then click <strong className="text-ink-1">Keep</strong> → <strong className="text-ink-1">Keep anyway</strong>.</>,
  },
  {
    q: `Windows says "Windows protected your PC — Unknown publisher"`,
    a: <>Expected for this release — the installer is intentionally unsigned (see Known Issues on the release notes below). Click <strong className="text-ink-1">More info</strong>, then <strong className="text-ink-1">Run anyway</strong>. Always verify the SHA-256 checksum first if you're unsure.</>,
  },
  {
    q: "Antivirus flagged or quarantined the installer",
    a: <>Unsigned executables are sometimes flagged by heuristic antivirus scanning. Verify the file's checksum matches the one published on this page, then allow or restore it from quarantine in your antivirus settings.</>,
  },
  {
    q: "A camera stays stuck at \"Not Configured\"",
    a: <>Confirm the camera is reachable on the local network from this machine, then restart CamAI Desktop. If it persists, check the Engine Health tab inside the app for a specific error.</>,
  },
  {
    q: "License key says it's already activated",
    a: <>A license key is bound to one device at a time. Ask your organization admin to deactivate the previous device from the portal, or deactivate it yourself from the app's sidebar if you still have access.</>,
  },
];

function StepTile({ index, step }: { index: number; step: Step }) {
  return (
    <li className="relative rounded-xl border border-line/70 bg-surface-2/40 p-4 transition hover:border-accent/30 hover:bg-surface-2/70">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-white shadow-2xs">
          {index}
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          {step.icon}
        </span>
      </div>
      <div className="mt-3 t-h3">{step.title}</div>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">{step.body}</p>
    </li>
  );
}

function InstallGuide() {
  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="t-h2 flex items-center gap-2">
            <Terminal size={17} className="text-accent" /> Installing on Windows
          </h3>
          <p className="t-caption mt-1">Four quick steps — a first-time install takes under two minutes.</p>
        </div>
      </div>

      <ol className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INSTALL_STEPS.map((step, i) => <StepTile key={step.title} index={i + 1} step={step} />)}
      </ol>

      <details className="group/acc mt-5 overflow-hidden rounded-xl border border-line/70 bg-surface-1">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 marker:content-none">
          <span className="flex items-center gap-2 text-sm font-bold text-ink-1">
            <ShieldQuestion size={16} className="text-ink-3" /> Troubleshooting
          </span>
          <ChevronDown size={16} className="shrink-0 text-ink-3 transition-transform group-open/acc:rotate-180" />
        </summary>
        <div className="divide-y divide-line/60 border-t border-line/60">
          {TROUBLESHOOTING.map((item) => (
            <details key={item.q} className="group/faq px-4 py-3">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 marker:content-none">
                <span className="flex items-start gap-2 text-xs font-semibold text-ink-1">
                  <HelpCircle size={13} className="mt-0.5 shrink-0 text-ink-3" /> {item.q}
                </span>
                <ChevronDown size={14} className="mt-0.5 shrink-0 text-ink-3 transition-transform group-open/faq:rotate-180" />
              </summary>
              <div className="mt-2 pl-5 text-xs leading-relaxed text-ink-2">{item.a}</div>
            </details>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function DownloadsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["github-releases"],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.functions.invoke<{ releases: GithubRelease[]; error?: string }>(
          "github-releases",
        );
        if (error || !data?.releases?.length) return { releases: DEFAULT_FALLBACK_RELEASES };
        return data;
      } catch {
        return { releases: DEFAULT_FALLBACK_RELEASES };
      }
    },
    refetchInterval: 5 * 60_000,
  });

  const releases = data?.releases && data.releases.length ? data.releases : DEFAULT_FALLBACK_RELEASES;
  const latest = releases[0];
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function download(r: GithubRelease) {
    setDownloadingId(r.asset_id ?? 101);
    try {
      if (r.asset_id && r.asset_id !== 101 && r.asset_id !== 102) {
        const { data, error } = await supabase.functions.invoke<{ url?: string; error?: string }>(
          "download-release", { body: { asset_id: r.asset_id } },
        );
        if (!error && data?.url) {
          window.open(data.url, "_blank");
          return;
        }
      }
      const fallbackUrl = `/downloads/${r.asset_name}`;
      window.open(fallbackUrl, "_blank");
    } catch {
      const fallbackUrl = `/downloads/${r.asset_name}`;
      window.open(fallbackUrl, "_blank");
    } finally {
      setDownloadingId(null);
    }
  }

  const signingState = latest?.release_notes && /unsigned/i.test(latest.release_notes)
    ? "Unsigned" : latest?.release_notes && /\bsigned\b/i.test(latest.release_notes) ? "Signed" : "Unsigned";

  if (isLoading && !data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 space-y-8">
        <div className="skeleton h-48 w-full rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="skeleton h-72 w-full rounded-3xl" />
          <div className="skeleton h-72 w-full rounded-3xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-10">
      
      {/* -------------------------------------------------- Header Section */}
      <div className="relative overflow-hidden rounded-3xl border border-sky-300/60 bg-gradient-to-r from-slate-900 via-sky-950 to-indigo-950 p-6 sm:p-10 text-white shadow-2xl">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/20 border border-sky-400/30 text-sky-300 text-xs font-bold uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
              Official CamAI Distribution Hub
            </div>
            <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-white leading-tight">
              Downloads &amp; Release Matrix
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
              Get the latest production-grade CamAI releases for Windows Desktop and Android Mobile. On-premise sub-12ms AI vision engine, local data sovereignty, and cloud hybrid alerts.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-sky-200/90 pt-2">
              <span className="flex items-center gap-1.5"><Check className="text-emerald-400" size={14} /> DirectML &amp; CUDA GPU Accelerated</span>
              <span className="flex items-center gap-1.5"><Check className="text-emerald-400" size={14} /> 100% Offline Edge Mode</span>
              <span className="flex items-center gap-1.5"><Check className="text-emerald-400" size={14} /> Zero Cloud Video Egress</span>
            </div>
          </div>

          <div className="shrink-0 flex flex-col sm:flex-row md:flex-col gap-3">
            <a
              href={`${REPO_URL}/releases`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-sky-400/40 bg-white/10 hover:bg-white/20 text-white font-bold text-xs backdrop-blur-md transition-all shadow-md"
            >
              <Github size={16} />
              <span>View GitHub Releases</span>
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------- Dual Featured Hero Grid (Desktop & Mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Desktop Setup Card */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-sky-500/30 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-7 text-white shadow-xl hover:border-sky-400/50 transition-all">
          <div className="pointer-events-none absolute top-0 right-0 h-48 w-48 rounded-full bg-sky-500/10 blur-2xl" />

          <div className="space-y-4 relative z-10">
            <div className="flex items-center justify-between gap-3">
              <span className="px-3 py-1 rounded-full bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive size={13} strokeWidth={2.5} /> Desktop Release (v1.0.9)
              </span>
              <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20">
                Official Windows Build
              </span>
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                CamAI Desktop Security Suite
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                Bundled high-speed AI vision grid for Windows x64. Sub-12ms multi-camera detection, zero ghost box filtering, RTSP/ONVIF auto-discovery, and local SQLite/PostgreSQL storage.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Target OS</span>
                <span className="text-xs font-bold text-white mt-0.5 block">Windows 10 / 11 (64-bit)</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Installer Size</span>
                <span className="text-xs font-bold text-white mt-0.5 block">{fmtSize(latest.size_bytes)}</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">AI Engine</span>
                <span className="text-xs font-bold text-sky-400 mt-0.5 block">Bundled (Offline Ready)</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Release Date</span>
                <span className="text-xs font-bold text-white mt-0.5 block">{format(new Date(latest.published_at), "dd MMM yyyy")}</span>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800 space-y-3 relative z-10">
            <button
              onClick={() => download(latest)}
              disabled={downloadingId === latest.asset_id}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-sky-500 via-blue-600 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-extrabold text-sm shadow-xl shadow-sky-500/20 flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] active:scale-95"
            >
              {downloadingId === latest.asset_id ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              <span>{downloadingId === latest.asset_id ? "Preparing Download..." : "DOWNLOAD DESKTOP INSTALLER (.exe)"}</span>
            </button>
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>SHA-256 Verified Release</span>
              <span>Requires License Key Activation</span>
            </div>
          </div>
        </div>

        {/* Mobile APK Card */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-indigo-500/30 bg-gradient-to-b from-slate-900 via-indigo-950/90 to-slate-950 p-7 text-white shadow-xl hover:border-indigo-400/50 transition-all">
          <div className="pointer-events-none absolute top-0 right-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-2xl" />

          <div className="space-y-4 relative z-10">
            <div className="flex items-center justify-between gap-3">
              <span className="px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                <MonitorSmartphone size={13} strokeWidth={2.5} /> Mobile Release (v1.0.1)
              </span>
              <span className="text-xs font-mono font-bold text-sky-400 bg-sky-500/10 px-2.5 py-1 rounded-md border border-sky-500/20">
                Production Signed APK
              </span>
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                CamAI Mobile Security Hub
              </h2>
              <p className="mt-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
                Mobile security hub for Android smartphones. Direct live RTSP stream playback, real-time background alert push notifications, unified Google SSO authentication, and zero package conflict installation.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Compatible OS</span>
                <span className="text-xs font-bold text-white mt-0.5 block">Android 7.0+ (Nougat &amp; newer)</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Package File Size</span>
                <span className="text-xs font-bold text-white mt-0.5 block">3.5 MB (Instant Install)</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Authentication</span>
                <span className="text-xs font-bold text-indigo-400 mt-0.5 block">Single Google SSO</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Signature</span>
                <span className="text-xs font-bold text-emerald-400 mt-0.5 block">Signed Keystore (v1.0.1)</span>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800 space-y-3 relative z-10">
            <a
              href="/downloads/CamAI-Mobile-v1.0.1.apk"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-indigo-500 via-purple-600 to-sky-600 hover:from-indigo-400 hover:to-sky-500 text-white font-extrabold text-sm shadow-xl shadow-indigo-500/20 flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01] active:scale-95"
            >
              <Download size={18} />
              <span>DOWNLOAD ANDROID APK (v1.0.1)</span>
            </a>
            <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
              <span>Direct Public Link</span>
              <span>Instant Clean Installation</span>
            </div>
          </div>
        </div>

      </div>

      {/* -------------------------------------------------- Checksum Integrity & Installation Verification */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div>
            <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck size={20} className="text-sky-600" /> Security Verification &amp; Checksums
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Verify SHA-256 checksums before installing to guarantee software integrity.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
            Version {latest.version} Checksum
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <ChecksumBlock sha256={latest.checksum_sha256} />
          
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-4 text-xs space-y-2">
            <span className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Terminal size={14} className="text-sky-600" /> Verify Checksum via PowerShell (Windows):
            </span>
            <CodeBlock text={`Get-FileHash -Algorithm SHA256 .\\${latest.asset_name}`} />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- Installation Walkthrough */}
      <InstallGuide />

      {/* -------------------------------------------------- Release History Timeline */}
      <section className="space-y-6">
        <div className="flex items-center gap-2.5">
          <PackageCheck size={20} className="text-sky-600" />
          <h3 className="text-2xl font-black text-slate-900 dark:text-white">Full Release History</h3>
        </div>

        <div className="space-y-4">
          {releases.map((r, i) => {
            const isLatest = r.tag_name === latest.tag_name;
            const header = (
              <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag size={14} className="text-sky-600" />
                  <span className="text-base font-extrabold text-slate-900 dark:text-white">{r.name}</span>
                  {isLatest && <Badge tone="ok">Latest Release</Badge>}
                  {r.prerelease && <Badge tone="warn">Pre-release</Badge>}
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    · {format(new Date(r.published_at), "dd MMM yyyy")}
                  </span>
                </div>
                {!isLatest && (
                  <button
                    onClick={(e) => { e.preventDefault(); download(r); }}
                    disabled={downloadingId === r.asset_id}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-all"
                  >
                    {downloadingId === r.asset_id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                    <span>{downloadingId === r.asset_id ? "Preparing..." : "Download"}</span>
                  </button>
                )}
              </div>
            );

            if (isLatest) {
              return (
                <div key={r.tag_name} className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
                  <div className="mb-5 border-b border-slate-100 dark:border-slate-800 pb-4">{header}</div>
                  {r.release_notes && (
                    <ReleaseNotes content={r.release_notes} assetName={r.asset_name} onDownloadCurrent={() => download(r)} />
                  )}
                </div>
              );
            }

            return (
              <details key={r.tag_name} className="group/acc rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0 overflow-hidden shadow-2xs" open={i === 1}>
                <summary className="flex cursor-pointer list-none items-center gap-3 p-5 sm:p-6 marker:content-none hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                  <div className="flex-1 min-w-0">{header}</div>
                  <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform group-open/acc:rotate-180" />
                </summary>
                {r.release_notes && (
                  <div className="border-t border-slate-100 dark:border-slate-800 px-6 pb-6 pt-4">
                    <ReleaseNotes content={r.release_notes} assetName={r.asset_name} onDownloadCurrent={() => download(r)} />
                  </div>
                )}
              </details>
            );
          })}
        </div>
      </section>

    </div>
  );
}
