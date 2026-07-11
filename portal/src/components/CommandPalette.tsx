import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import clsx from "clsx";
import { NAV, NavItem } from "./nav";
import { useAuth } from "../contexts/AuthContext";

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const { can, profile } = useAuth();

  const items = useMemo(() => {
    const visible = NAV.flatMap((g) => g.items).filter(
      (i: NavItem) =>
        (!i.perm || can(i.perm)) && (!i.superOnly || profile?.is_super_admin),
    );
    if (!q) return visible;
    const needle = q.toLowerCase();
    return visible.filter((i) => i.label.toLowerCase().includes(needle));
  }, [q, can, profile]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Search size={15} className="text-ink-3" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm text-ink-1 placeholder-ink-3 outline-none"
            placeholder="Go to…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, items.length - 1));
              if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
              if (e.key === "Enter" && items[idx]) {
                nav(items[idx].to);
                setOpen(false);
              }
            }}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3">ESC</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {items.length === 0 && <p className="px-4 py-3 text-sm text-ink-3">No matches.</p>}
          {items.map((i, n) => (
            <button
              key={i.to}
              className={clsx(
                "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm",
                n === idx ? "bg-accent/10 text-accent" : "text-ink-2 hover:bg-surface-2",
              )}
              onMouseEnter={() => setIdx(n)}
              onClick={() => { nav(i.to); setOpen(false); }}
            >
              <i.icon size={14} /> {i.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
