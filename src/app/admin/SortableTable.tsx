"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

/** What a cell sorts by: text, a number (dates as their time), or null for "nothing here", always last. */
export type SortValue = string | number | null;

export type SortColumn = {
  label: string;
  /** Header shown only to screen readers (e.g. over a column of buttons). */
  labelHidden?: boolean;
  /** Unset means the column isn't sortable (e.g. buttons). */
  sortable?: boolean;
  /** Numbers and dates start biggest/newest first on the first click. */
  desc?: boolean;
};

export type SortRow = { key: string; cells: ReactNode[]; values: SortValue[] };

type Sort = { col: number; dir: "asc" | "desc" };

/**
 * An admin table whose headers sort it when clicked (again to flip the order).
 * Rows arrive already rendered from the server; until a header is clicked they keep the server's order.
 * The chosen order is remembered for the browser tab under `id`, so it survives filtering and reloads.
 */
export default function SortableTable({ id, columns, rows, locale }: { id: string; columns: SortColumn[]; rows: SortRow[]; locale: string }) {
  const [sort, setSort] = useState<Sort | null>(null);
  const storageKey = `admin-sort:${id}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Sort | null;
      if (saved && columns[saved.col]?.sortable) setSort(saved);
    } catch {}
    // Only on first show; the columns don't change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a.values[sort.col];
      const y = b.values[sort.col];
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      const diff = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
      return sign * diff;
    });
  }, [rows, sort, locale]);

  function choose(col: number) {
    const next: Sort =
      sort?.col === col ? { col, dir: sort.dir === "asc" ? "desc" : "asc" } : { col, dir: columns[col].desc ? "desc" : "asc" };
    setSort(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch {}
  }

  return (
    <table className="admin-table">
      <thead>
        <tr>
          {columns.map((c, i) => {
            const active = sort?.col === i;
            return (
              <th
                key={i}
                aria-label={c.labelHidden ? c.label : undefined}
                aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                {c.sortable ? (
                  <button type="button" className={`th-sort${active ? " active" : ""}`} onClick={() => choose(i)}>
                    {c.label}
                    <span className="arrow" aria-hidden>
                      {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                ) : (
                  !c.labelHidden && c.label
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.key}>{r.cells}</tr>
        ))}
      </tbody>
    </table>
  );
}
