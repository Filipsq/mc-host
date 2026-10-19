import { Fragment, type ReactNode } from "react";
import type { SortColumn, SortRow, SortValue } from "./SortableTable";

/** One column of a sortable admin table: its header, its <td>, and what it sorts by (none = not sortable). */
export type ColumnDef<T> = Omit<SortColumn, "sortable"> & {
  cell: (row: T) => ReactNode;
  value?: (row: T) => SortValue | Date | undefined;
};

/** Turns column definitions into SortableTable's props. Falsy entries are columns left out. */
export function sortable<T>(defs: (ColumnDef<T> | false | null | undefined)[], rows: T[], key: (row: T) => string) {
  const cols = defs.filter((d): d is ColumnDef<T> => !!d);
  return {
    columns: cols.map(({ label, labelHidden, desc, value }) => ({ label, labelHidden, desc, sortable: !!value })),
    rows: rows.map(
      (row): SortRow => ({
        key: key(row),
        cells: cols.map((c, i) => <Fragment key={i}>{c.cell(row)}</Fragment>),
        values: cols.map((c) => {
          const v = c.value?.(row);
          return v instanceof Date ? v.getTime() : (v ?? null);
        }),
      }),
    ),
  };
}
