import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  Search, CheckCheck, Trash2, ImageOff, Volume2, VolumeX, Loader2,
  ExternalLink, ArrowUpDown, X, Download, Keyboard,
} from "lucide-react";
import clsx from "clsx";
import type { AlertEvent } from "../../lib/alertEngine";
import { SEVERITY_THEME, SEVERITY_RANK, type Severity } from "../../lib/alertCatalog";
import { listEvidencePage, type EvidenceRecord } from "../../lib/evidenceStore";
import { exportAlertsCsv, exportAlertsJson, exportAlertsPdf } from "../../lib/alertsListExport";
import { useAlertState } from "./AlertProvider";
import { formatAge, clockTime, confidenceLabel, evidenceRecordToAlertEvent } from "./alertUtils";
import IncidentWindow from "./IncidentWindow";

/**
 * The single dedicated surface for alerts in this app. Nothing about an alert
 * is ever shown anywhere else — no floating cards, no drawer, no screen-edge
 * glow. This page is realtime (the events it renders come straight from
 * AlertProvider's live derivation), and it pages further back than memory
 * holds by reading the local evidence vault on demand.
 */

const ROW_H = 76;
const OVERSCAN = 6;
const VIRTUALIZE_ABOVE = 30;
const PAGE_SIZE = 50;
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
type SortKey = "time" | "severity" | "confidence";

interface UrlPair { cropUrl: string | null; fullUrl: string | null }

export default function AlertsPage({ active }: { active: boolean }) {
  const alertState = useAlertState();
  const { events: liveEvents } = alertState;

  const [historical, setHistorical] = useState<EvidenceRecord[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const urlCacheRef = useRef(new Map<string, UrlPair>());

  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set());
  const [cameraFilter, setCameraFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Revoke every cached object URL for a set of vault ids.
  const revokeCached = useCallback((ids: Iterable<string>) => {
    for (const id of ids) {
      const c = urlCacheRef.current.get(id);
      if (!c) continue;
      if (c.cropUrl) URL.revokeObjectURL(c.cropUrl);
      if (c.fullUrl) URL.revokeObjectURL(c.fullUrl);
      urlCacheRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    return () => revokeCached([...urlCacheRef.current.keys()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveIds = useMemo(() => new Set(liveEvents.map((e) => e.id)), [liveEvents]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const oldestTs = historical.length
      ? historical[historical.length - 1].ts
      : (liveEvents.length ? liveEvents[liveEvents.length - 1].ts : Date.now() + 1);
    const page = await listEvidencePage({ beforeTs: oldestTs, limit: PAGE_SIZE });
    for (const rec of page) {
      if (urlCacheRef.current.has(rec.id)) continue;
      urlCacheRef.current.set(rec.id, {
        cropUrl: rec.crop ? URL.createObjectURL(rec.crop) : null,
        fullUrl: rec.full ? URL.createObjectURL(rec.full) : null,
      });
    }
    setHistorical((prev) => [...prev, ...page]);
    if (page.length < PAGE_SIZE) setHasMore(false);
    setLoadingMore(false);
  }, [loadingMore, hasMore, historical, liveEvents]);

  // Historical rows already covered by the in-memory (live) list are dropped
  // so the same alert never appears twice while it is still fresh.
  const historicalAsEvents = useMemo(
    () => historical
      .filter((r) => !liveIds.has(r.id))
      .map((r) => evidenceRecordToAlertEvent(r, urlCacheRef.current.get(r.id)?.cropUrl ?? null, urlCacheRef.current.get(r.id)?.fullUrl ?? null)),
    [historical, liveIds],
  );

  const allRows = useMemo(() => [...liveEvents, ...historicalAsEvents], [liveEvents, historicalAsEvents]);

  const cameras = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allRows) map.set(e.cameraId, e.cameraName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = allRows.filter((e) => {
      if (severityFilter.size > 0 && !severityFilter.has(e.severity)) return false;
      if (cameraFilter !== "all" && e.cameraId !== cameraFilter) return false;
      if (!q) return true;
      const hay = [
        e.def.title, e.cameraName, e.siteName, e.sourceKey,
        e.meta.plate, e.trackId != null ? `#${e.trackId}` : "",
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
    rows = rows.slice().sort((a, b) => {
      let cmp = 0;
      if (sortKey === "time") cmp = a.ts - b.ts;
      else if (sortKey === "severity") cmp = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      else cmp = (a.confidence ?? -1) - (b.confidence ?? -1);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [allRows, search, severityFilter, cameraFilter, sortKey, sortDir]);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const handleAcknowledge = useCallback((ids: string[]) => {
    alertState.acknowledgeMany(ids);
    const now = Date.now();
    setHistorical((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, acknowledgedAt: now } : r)));
  }, [alertState]);

  const handleDelete = useCallback((ids: string[]) => {
    alertState.deleteEvents(ids);
    setHistorical((prev) => prev.filter((r) => !ids.includes(r.id)));
    revokeCached(ids);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    if (detailId && ids.includes(detailId)) setDetailId(null);
  }, [alertState, revokeCached, detailId]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelected(new Set(filtered.map((e) => e.id)));
  }, [filtered]);

  const exportTargets = useCallback((): AlertEvent[] => {
    if (selected.size > 0) return filtered.filter((e) => selected.has(e.id));
    return filtered;
  }, [selected, filtered]);

  // --- virtualization --------------------------------------------------------
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const rafRef = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = containerRef.current;
      if (!el) return;
      setScrollTop(el.scrollTop);
      const nearBottom = el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 6;
      if (nearBottom) void loadMore();
    });
  }, [loadMore]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const virtual = filtered.length > VIRTUALIZE_ABOVE;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN) : 0;
  const end = virtual
    ? Math.min(filtered.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN)
    : filtered.length;
  const slice = filtered.slice(start, end);

  // Only rows actually on screen (plus the open detail) get live crop refreshes.
  useEffect(() => {
    const visible = new Set(slice.map((e) => e.id));
    if (detailId) visible.add(detailId);
    alertState.setVisibleIds(visible);
  }, [slice, detailId, alertState]);

  // --- keyboard shortcuts ------------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement
        || document.activeElement instanceof HTMLTextAreaElement;

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && !typing) {
        setSelected(new Set());
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) {
        e.preventDefault();
        selectAllFiltered();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        const row = filtered[focusedIndex];
        if (row) setDetailId(row.id);
        return;
      }
      if (e.key.toLowerCase() === "a") {
        const ids = selected.size > 0 ? [...selected] : (filtered[focusedIndex] ? [filtered[focusedIndex].id] : []);
        if (ids.length) handleAcknowledge(ids);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = selected.size > 0 ? [...selected] : (filtered[focusedIndex] ? [filtered[focusedIndex].id] : []);
        if (ids.length && window.confirm(`Delete ${ids.length} alert${ids.length === 1 ? "" : "s"}? This removes them from this node's evidence vault.`)) {
          handleDelete(ids);
        }
        return;
      }
      if (e.key.toLowerCase() === "e") {
        exportAlertsCsv(exportTargets());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, filtered, focusedIndex, selected, selectAllFiltered, handleAcknowledge, handleDelete, exportTargets]);

  const detail = useMemo(() => allRows.find((e) => e.id === detailId) ?? null, [allRows, detailId]);
  const unackedFiltered = useMemo(() => filtered.filter((e) => !e.acknowledged).length, [filtered]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search alerts… (press / to focus)"
            className="w-full rounded-lg border border-line bg-surface-1 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-accent/50 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-surface-1 p-0.5 border border-line">
          {SEVERITIES.map((s) => {
            const on = severityFilter.has(s);
            return (
              <button
                key={s}
                onClick={() => setSeverityFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(s)) next.delete(s); else next.add(s);
                  return next;
                })}
                className={clsx(
                  "rounded-md px-2 py-1 text-[10px] font-medium capitalize transition",
                  on ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                )}
                style={on ? { background: SEVERITY_THEME[s].wash, color: SEVERITY_THEME[s].text } : undefined}
              >
                {s}
              </button>
            );
          })}
        </div>

        <select
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-xs text-zinc-300 focus:border-accent/50 focus:outline-none"
        >
          <option value="all">All cameras</option>
          {cameras.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>

        <button
          onClick={() => setSortKey((k) => (k === "time" ? "severity" : k === "severity" ? "confidence" : "time"))}
          title="Change sort field"
          className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-surface-2"
        >
          <ArrowUpDown size={12} /> {sortKey}
        </button>
        <button
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          title="Toggle sort direction"
          className="rounded-lg border border-line bg-surface-1 px-2 py-1.5 text-xs text-zinc-400 hover:bg-surface-2"
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </button>

        <button
          onClick={() => alertState.setSound(!alertState.sound)}
          title={alertState.sound ? "Mute critical chime" : "Unmute critical chime"}
          className="rounded-lg border border-line bg-surface-1 p-1.5 text-zinc-400 hover:bg-surface-2"
        >
          {alertState.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>
      </header>

      <div className="flex items-center justify-between gap-2 py-2 text-[11px] text-zinc-500">
        <div className="flex items-center gap-3">
          <span>{filtered.length} alert{filtered.length === 1 ? "" : "s"}{unackedFiltered > 0 && ` · ${unackedFiltered} unacknowledged`}</span>
          {alertState.suppressed > 0 && <span>· {alertState.suppressed} suppressed by flood control</span>}
          {!alertState.snapshotsAvailable && <span className="text-warn">· snapshots unavailable on this display</span>}
        </div>
        <div className="flex items-center gap-1.5 text-zinc-600">
          <Keyboard size={12} />
          <span>/ search · a acknowledge · Del delete · ↑↓ move · Enter open · Esc clear selection</span>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
          <span className="text-xs font-medium text-zinc-200">{selected.size} selected</span>
          <button onClick={() => handleAcknowledge([...selected])} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-white/5">
            <CheckCheck size={13} /> Acknowledge
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Delete ${selected.size} alert${selected.size === 1 ? "" : "s"}? This removes them from this node's evidence vault.`)) {
                handleDelete([...selected]);
              }
            }}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10"
          >
            <Trash2 size={13} /> Delete
          </button>
          <div className="ml-auto flex items-center gap-1">
            <ExportButtons targets={exportTargets} />
            <button onClick={() => setSelected(new Set())} className="rounded-md p-1.5 text-zinc-500 hover:bg-white/5" title="Clear selection">
              <X size={13} />
            </button>
          </div>
        </div>
      )}
      {selected.size === 0 && (
        <div className="mb-2 flex items-center justify-between">
          <button onClick={selectAllFiltered} className="text-[11px] text-zinc-500 hover:text-zinc-300" disabled={filtered.length === 0}>
            Select all {filtered.length > 0 && `(${filtered.length})`}
          </button>
          <ExportButtons targets={exportTargets} />
        </div>
      )}

      <div ref={containerRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface-1/40">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-zinc-600">
            <span className="text-xs">No alerts match these filters.</span>
          </div>
        ) : (
          <div style={{ height: filtered.length * ROW_H, position: "relative" }}>
            {slice.map((e, i) => (
              <div
                key={e.id}
                style={{ position: "absolute", top: (start + i) * ROW_H, left: 0, right: 0, height: ROW_H - 6 }}
              >
                <AlertRow
                  event={e}
                  focused={start + i === focusedIndex}
                  selected={selected.has(e.id)}
                  onToggleSelected={() => toggleSelected(e.id)}
                  onOpen={() => setDetailId(e.id)}
                  onAcknowledge={() => handleAcknowledge([e.id])}
                  onOpenLive={() => alertState.openLive(e.cameraId)}
                />
              </div>
            ))}
          </div>
        )}
        {hasMore && (
          <div className="flex justify-center py-3">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs text-zinc-400 hover:bg-surface-2 disabled:opacity-50"
            >
              {loadingMore ? <Loader2 size={13} className="animate-spin" /> : null}
              {loadingMore ? "Loading…" : "Load older alerts"}
            </button>
          </div>
        )}
      </div>

      {detail && (
        <IncidentWindow
          event={detail}
          allEvents={allRows}
          captureMediaFor={alertState.captureMediaFor}
          onClose={() => setDetailId(null)}
          onAcknowledge={(id) => handleAcknowledge([id])}
          onOpenLive={alertState.openLive}
          onSelectEvent={setDetailId}
        />
      )}
    </div>
  );
}

function ExportButtons({ targets }: { targets: () => AlertEvent[] }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => exportAlertsCsv(targets())} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-zinc-400 hover:bg-surface-2">
        <Download size={11} /> CSV
      </button>
      <button onClick={() => exportAlertsJson(targets())} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-zinc-400 hover:bg-surface-2">
        <Download size={11} /> JSON
      </button>
      <button onClick={() => exportAlertsPdf(targets())} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] text-zinc-400 hover:bg-surface-2">
        <Download size={11} /> PDF
      </button>
    </div>
  );
}

function AlertRow({
  event: e, focused, selected, onToggleSelected, onOpen, onAcknowledge, onOpenLive,
}: {
  event: AlertEvent;
  focused: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onAcknowledge: () => void;
  onOpenLive: () => void;
}) {
  const theme = SEVERITY_THEME[e.severity];
  const Icon = e.def.icon;
  return (
    <div
      className={clsx(
        "flex h-full w-full items-center gap-2.5 rounded-xl border p-2 transition",
        focused ? "border-accent/40 bg-accent/5" : "border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.05]",
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelected}
        onClick={(ev) => ev.stopPropagation()}
        className="shrink-0 accent-accent"
      />
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <div className="relative h-[52px] w-[88px] shrink-0 overflow-hidden rounded-lg bg-black/50">
          {e.cropUrl ? (
            <img src={e.cropUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-700"><ImageOff size={14} /></div>
          )}
          <span className="absolute inset-y-0 left-0 w-[2px]" style={{ background: theme.accent }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon size={12} style={{ color: theme.accent }} className="shrink-0" />
            <span className="truncate text-[12px] font-medium text-zinc-200">{e.def.title}</span>
            {e.live && <span className="camai-live-dot h-1 w-1 shrink-0 rounded-full bg-red-400" />}
            {!e.acknowledged && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: theme.accent }} />
            )}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-zinc-500">
            {e.cameraName} · {confidenceLabel(e.confidence)}
            {e.meta.plate && ` · ${e.meta.plate}`}
          </div>
          <div className="text-[10px] text-zinc-600">{formatAge(e.ts)} · {clockTime(e.ts)}</div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={onOpenLive} title="Open live feed" className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
          <ExternalLink size={13} />
        </button>
        {!e.acknowledged && (
          <button onClick={onAcknowledge} title="Acknowledge" className="rounded-md p-1.5 text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
            <CheckCheck size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
