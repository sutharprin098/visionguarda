import { ReactNode, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Download, Search } from "lucide-react";
import { downloadCsv } from "../lib/format";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** plain value for sorting + CSV export; defaults to render output if string */
  value?: (row: T) => string | number | null;
  sortable?: boolean;
  /** show a select filter over these distinct values */
  filter?: boolean;
  width?: string;
}

export interface BulkAction<T> {
  label: string;
  danger?: boolean;
  run: (rows: T[]) => void | Promise<void>;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  searchText?: (row: T) => string;
  bulkActions?: BulkAction<T>[];
  onRowClick?: (row: T) => void;
  exportName?: string;
  pageSize?: number;
  emptyText?: string;
}

export default function DataTable<T>({
  rows, columns, rowKey, searchText, bulkActions, onRowClick, exportName,
  pageSize = 12, emptyText = "No records.",
}: Props<T>) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const colValue = (c: Column<T>, r: T): string | number | null =>
    c.value ? c.value(r) : null;

  const filtered = useMemo(() => {
    let out = rows;
    if (q && searchText) {
      const needle = q.toLowerCase();
      out = out.filter((r) => searchText(r).toLowerCase().includes(needle));
    }
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      const col = columns.find((c) => c.key === key);
      if (col) out = out.filter((r) => String(colValue(col, r) ?? "") === val);
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = colValue(col, a), bv = colValue(col, b);
          if (av == null) return 1;
          if (bv == null) return -1;
          return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
        });
      }
    }
    return out;
  }, [rows, q, filters, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const selectedRows = rows.filter((r) => selected.has(rowKey(r)));
  const filterCols = columns.filter((c) => c.filter);

  function exportCsv() {
    const cols = columns.filter((c) => c.value);
    downloadCsv(
      exportName ?? "export",
      cols.map((c) => c.header),
      filtered.map((r) => cols.map((c) => colValue(c, r))),
    );
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(pageRows.map(rowKey)) : new Set());
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchText && (
          <div className="relative flex-1 sm:flex-initial min-w-[200px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input w-full sm:w-60 pl-8 text-xs py-1.5"
              placeholder="Search…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
            />
          </div>
        )}
        {filterCols.map((c) => {
          const opts = [...new Set(rows.map((r) => String(colValue(c, r) ?? "")).filter(Boolean))].sort();
          return (
            <select
              key={c.key}
              className="input w-auto text-xs py-1.5"
              value={filters[c.key] ?? ""}
              onChange={(e) => { setFilters({ ...filters, [c.key]: e.target.value }); setPage(0); }}
            >
              <option value="">{c.header}: all</option>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        })}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 w-full sm:w-auto mt-1 sm:mt-0">
          <span className="text-xs font-mono text-ink-3">{filtered.length} of {rows.length} records</span>
          {exportName && (
            <button className="btn-ghost px-2.5 py-1.5 text-xs gap-1.5" onClick={exportCsv}>
              <Download size={13} /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Bulk actions bar */}
      {bulkActions && selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2">
          <span className="text-sm font-semibold text-accent">{selected.size} selected</span>
          {bulkActions.map((a) => (
            <button
              key={a.label}
              className={clsx("text-xs font-medium hover:underline", a.danger ? "text-danger" : "text-accent")}
              onClick={async () => { await a.run(selectedRows); setSelected(new Set()); }}
            >
              {a.label}
            </button>
          ))}
          <button className="ml-auto text-xs text-ink-3 hover:underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Desktop Table View */}
      <div className="card hidden md:block overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr>
              {bulkActions && (
                <th className="th w-8">
                  <input type="checkbox" className="accent-[#5b8cff]"
                         checked={pageRows.length > 0 && pageRows.every((r) => selected.has(rowKey(r)))}
                         onChange={(e) => toggleAll(e.target.checked)} />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.key} className="th" style={c.width ? { width: c.width } : undefined}>
                  {c.sortable ? (
                    <button
                      className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink-1"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 },
                        )
                      }
                    >
                      {c.header}
                      <ChevronsUpDown size={11} className={sort?.key === c.key ? "text-accent" : ""} />
                    </button>
                  ) : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={columns.length + (bulkActions ? 1 : 0)} className="td py-10 text-center text-ink-3">{emptyText}</td></tr>
            )}
            {pageRows.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k}
                    className={clsx("transition hover:bg-surface-2", onRowClick && "cursor-pointer")}
                    onClick={() => onRowClick?.(r)}>
                  {bulkActions && (
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="accent-[#5b8cff]"
                             checked={selected.has(k)}
                             onChange={(e) => {
                               const next = new Set(selected);
                               e.target.checked ? next.add(k) : next.delete(k);
                               setSelected(next);
                             }} />
                    </td>
                  )}
                  {columns.map((c) => <td key={c.key} className="td">{c.render(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List View */}
      <div className="space-y-3 md:hidden">
        {pageRows.length === 0 ? (
          <div className="card p-8 text-center text-ink-3 text-sm">{emptyText}</div>
        ) : (
          pageRows.map((r) => {
            const k = rowKey(r);
            const actionCol = columns.find((c) => c.key === "actions" || c.header === "");
            const normalCols = columns.filter((c) => c !== actionCol);

            return (
              <div
                key={k}
                className={clsx(
                  "card p-4 space-y-3 border border-line/70 transition bg-surface-1 shadow-sm",
                  onRowClick && "cursor-pointer active:bg-surface-2"
                )}
                onClick={() => onRowClick?.(r)}
              >
                {/* Mobile Card Header */}
                <div className="flex items-start justify-between gap-3 border-b border-line/50 pb-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    {bulkActions && (
                      <input
                        type="checkbox"
                        className="accent-[#5b8cff] mt-0.5 h-4 w-4 shrink-0"
                        checked={selected.has(k)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const next = new Set(selected);
                          e.target.checked ? next.add(k) : next.delete(k);
                          setSelected(next);
                        }}
                      />
                    )}
                    <div className="min-w-0 font-semibold text-ink-1 text-sm">
                      {normalCols[0] ? normalCols[0].render(r) : null}
                    </div>
                  </div>

                  {/* Status/Badge column if present */}
                  {normalCols[1] && (
                    <div className="shrink-0 text-xs">
                      {normalCols[1].render(r)}
                    </div>
                  )}
                </div>

                {/* Mobile Card Body: Key-Value Pairs */}
                {normalCols.length > 2 && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {normalCols.slice(2).map((c) => (
                      <div key={c.key} className="space-y-0.5 min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                          {c.header}
                        </div>
                        <div className="text-ink-1 truncate">{c.render(r)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Mobile Card Actions Footer */}
                {actionCol && (
                  <div
                    className="flex items-center justify-end gap-3 pt-2 border-t border-line/40 text-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {actionCol.render(r)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between sm:justify-end gap-2 text-sm text-ink-3">
          <button className="btn-ghost px-3 py-1.5 text-xs font-semibold" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} className="inline mr-1" /> Previous
          </button>
          <span className="font-mono text-xs">Page {page + 1} of {pages}</span>
          <button className="btn-ghost px-3 py-1.5 text-xs font-semibold" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next <ChevronRight size={14} className="inline ml-1" />
          </button>
        </div>
      )}
    </div>
  );
}
