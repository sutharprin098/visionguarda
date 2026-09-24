import { useEffect, useState } from "react";
import { Monitor, AppWindow, RefreshCw, X } from "lucide-react";
import clsx from "clsx";
import type { CaptureSource } from "../lib/bridge";

/**
 * Lets the operator pick exactly one surface to share.
 *
 * Replaces the previous behaviour where main.ts handed getDisplayMedia
 * `sources[0]` — always a screen, because getSources() lists screens first —
 * so "Share Screen" silently meant "share everything" with no way to scope it.
 *
 * There is deliberately no "Browser Tabs" tab here. Electron 31's desktopCapturer
 * enumerates `'screen' | 'window'` only; a Chrome tab is not an OS window (Chrome
 * paints every tab into one window) and only Chrome can isolate a tab, for a page
 * running inside Chrome. Picking "Google Chrome — WhatsApp Web" shares the Chrome
 * *window*: it shows whatever tab is in front, tab bar included. Offering a "Tabs"
 * section here would be a lie the capture layer can't honour.
 */
interface Props {
  onPick: (source: CaptureSource) => void;
  onCancel: () => void;
  /** Name of the previously used source, re-offered by name — ids are ephemeral
   *  and never survive a relaunch or a window reopen. */
  lastSourceName?: string | null;
}

export default function SourcePicker({ onPick, onCancel, lastSourceName }: Props) {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const list = await window.camai.capture.getSources();
      setSources(list);
      // Land the operator on the tab that has their last source in it.
      if (lastSourceName) {
        const prev = list.find((s) => s.name === lastSourceName);
        if (prev) { setTab(prev.kind); setSelected(prev.id); }
      }
    } catch (e: any) {
      setSources([]);
      setError(e?.message ?? "Could not list capture sources.");
    }
  }

  useEffect(() => { void load(); }, []);

  const shown = (sources ?? []).filter((s) => s.kind === tab);
  const pick = () => {
    const src = (sources ?? []).find((s) => s.id === selected);
    if (src) onPick(src);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-lg border border-line bg-surface-1 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-semibold text-zinc-200">Choose what to share</div>
          <div className="flex items-center gap-2">
            <button onClick={() => void load()} className="rounded p-1 text-zinc-400 hover:bg-surface-3 hover:text-zinc-200" title="Refresh list">
              <RefreshCw size={14} />
            </button>
            <button onClick={onCancel} className="rounded p-1 text-zinc-400 hover:bg-surface-3 hover:text-zinc-200" title="Cancel">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-line px-4 pt-3">
          {([["screen", "Entire Screen", Monitor], ["window", "Window", AppWindow]] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx(
                "flex items-center gap-1.5 rounded-t px-3 py-1.5 text-xs font-semibold transition",
                tab === k ? "bg-surface-3 text-accent" : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              <Icon size={13} />{label}
            </button>
          ))}
        </div>

        <div className="min-h-[220px] flex-1 overflow-y-auto p-4">
          {sources === null ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">Listing sources…</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-xs text-danger">{error}</div>
          ) : shown.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-zinc-500">
              {tab === "window" ? "No open windows to share." : "No screens detected."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {shown.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  onDoubleClick={() => onPick(s)}
                  className={clsx(
                    "group overflow-hidden rounded border text-left transition",
                    selected === s.id ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-zinc-600",
                  )}
                >
                  <div className="flex aspect-video items-center justify-center bg-zinc-950">
                    {s.thumbnail
                      ? <img src={s.thumbnail} alt="" className="h-full w-full object-contain" />
                      : <Monitor size={20} className="text-zinc-700" />}
                  </div>
                  <div className="flex items-center gap-1.5 bg-surface-2 px-2 py-1.5">
                    {s.appIcon && <img src={s.appIcon} alt="" className="h-3.5 w-3.5 shrink-0" />}
                    <div className="truncate text-[11px] text-zinc-300" title={s.name}>{s.name}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === "window" && (
          <div className="border-t border-line px-4 py-2 text-[10px] leading-relaxed text-zinc-500">
            Sharing a browser window follows whichever tab is in front — Windows exposes the
            window, not individual tabs, so a specific tab cannot be captured on its own.
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button onClick={onCancel} className="rounded bg-surface-3 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-700">
            Cancel
          </button>
          <button
            onClick={pick}
            disabled={!selected}
            className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
