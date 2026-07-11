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
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {searchText && (
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="input w-60 pl-8"
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
              className="input w-auto"
              value={filters[c.key] ?? ""}
              onChange={(e) => { setFilters({ ...filters, [c.key]: e.target.value }); setPage(0); }}
            >
              <option value="">{c.header}: all</option>
              {opts.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-3">{filtered.length} of {rows.length}</span>
          {exportName && (
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={exportCsv}>
              <Download size={13} /> CSV
            </button>
          )}
        </div>
      </div>

      {/* bulk bar */}
      {bulkActions && selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2">
          <span className="text-sm text-accent">{selected.size} selected</span>
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

      {/* table */}
      <div className="card overflow-x-auto">
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

      {/* pagination */}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-ink-3">
          <button className="btn-ghost px-2 py-1" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span>Page {page + 1} / {pages}</span>
          <button className="btn-ghost px-2 py-1" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
