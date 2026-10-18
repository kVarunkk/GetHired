"use client";

import { useState, type ReactNode } from "react";
import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type OnChangeFn,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowUpDown, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/utils/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Classes for this column's body cells. */
    className?: string;
    /** Classes for this column's header cell. */
    headerClassName?: string;
  }
}

const DEFAULT_PAGE_SIZE = 10;

type DataTableProps<TData> = {
  data: TData[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  /** Plural noun for the footer and the default empty message: "Showing 1-10 of 24 {noun}". */
  noun: string;
  /** Shown in the body when no rows match. Defaults to "No {noun} found." */
  emptyMessage?: ReactNode;
  /** The filter controls, left of the toolbar. */
  filters?: (table: TanstackTable<TData>) => ReactNode;
  /** Extra controls, right of the toolbar next to Clear Filters. */
  actions?: ReactNode;
  /** Filters kept outside the table (URL params, custom filters) that count for Clear Filters. */
  externalFiltersActive?: boolean;
  /** Clears the external filters; column filters are cleared by the table. */
  onClearFilters?: () => void;
  initialSorting?: SortingState;
  columnVisibility?: VisibilityState;
  getRowId?: (row: TData) => string;
  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (selection: RowSelectionState) => void;
  /** Rows per page. null shows every row with no footer. */
  pageSize?: number | null;
  /** Replaces the page footer, for lists paged by the server. Every loaded row is shown. */
  footer?: ReactNode;
  /** Uses each column's `size` as its width (table-fixed). */
  fixedLayout?: boolean;
  /** Classes for every header and body cell. */
  cellClassName?: string;
  "aria-label"?: string;
};

/**
 * The app's one data table: filter toolbar, bordered table, empty row and a
 * "Showing x-y of N" footer with client-side paging. Sorting and filtering go
 * through TanStack column definitions; filters render through `filters`.
 */
export default function DataTable<TData>({
  data,
  columns,
  noun,
  emptyMessage,
  filters,
  actions,
  externalFiltersActive = false,
  onClearFilters,
  initialSorting = [],
  columnVisibility,
  getRowId,
  enableRowSelection = false,
  rowSelection,
  onRowSelectionChange,
  pageSize = DEFAULT_PAGE_SIZE,
  footer,
  fixedLayout = false,
  cellClassName,
  "aria-label": ariaLabel,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [page, setPage] = useState(1);

  // Any change to what's shown starts again from the first page.
  const resetting =
    <T,>(set: (fn: (old: T) => T) => void): OnChangeFn<T> =>
    (updater) => {
      set((old) => (updater instanceof Function ? updater(old) : updater));
      setPage(1);
    };

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
    enableRowSelection,
    onRowSelectionChange: (updater) =>
      onRowSelectionChange?.(
        updater instanceof Function ? updater(rowSelection ?? {}) : updater,
      ),
    onSortingChange: resetting(setSorting),
    onColumnFiltersChange: resetting(setColumnFilters),
    state: {
      sorting,
      columnFilters,
      ...(columnVisibility && { columnVisibility }),
      ...(rowSelection && { rowSelection }),
    },
  });

  const rows = table.getRowModel().rows;
  const paged = footer === undefined && pageSize !== null;
  const size = pageSize ?? rows.length;
  const totalPages = paged ? Math.max(1, Math.ceil(rows.length / size)) : 1;
  // Rows can disappear (a delete, an outside filter): stay on a real page.
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * size;
  const visibleRows = paged ? rows.slice(start, start + size) : rows;

  const hasFilters = columnFilters.length > 0 || externalFiltersActive;
  const clearFilters = () => {
    setColumnFilters([]);
    setPage(1);
    onClearFilters?.();
  };

  const filterControls = filters?.(table);
  const showToolbar = Boolean(filterControls || actions || hasFilters);

  return (
    <div className="space-y-4">
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 overflow-x-auto p-1">
            {filterControls}
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button
                variant="ghost"
                onClick={clearFilters}
                className="text-muted-foreground"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Clear Filters
              </Button>
            )}
            {actions}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table
          aria-label={ariaLabel}
          className={fixedLayout ? "table-fixed" : undefined}
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={fixedLayout ? { width: header.getSize() } : undefined}
                    className={cn(
                      cellClassName,
                      header.column.columnDef.meta?.headerClassName,
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {visibleRows.length ? (
              visibleRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={
                        fixedLayout ? { width: cell.column.getSize() } : undefined
                      }
                      className={cn(
                        cellClassName,
                        cell.column.columnDef.meta?.className,
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="h-24 whitespace-normal text-center text-muted-foreground"
                >
                  {emptyMessage ?? `No ${noun} found.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {footer ??
        (paged && (
          <DataTableFooter
            summary={
              <>
                Showing {visibleRows.length ? start + 1 : 0}-
                {start + visibleRows.length} of {rows.length} {noun}
              </>
            }
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="min-w-0"
            >
              <span className="truncate">Previous</span>
            </Button>
            <span className="whitespace-nowrap">
              {/* "Page" is dropped on the narrowest phones so the footer fits. */}
              <span className="max-[400px]:hidden">Page </span>
              {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="min-w-0"
            >
              <span className="truncate">Next</span>
            </Button>
          </DataTableFooter>
        ))}
    </div>
  );
}

/** The footer row under a DataTable: a summary on the left, paging controls on the right. */
export function DataTableFooter({
  summary,
  children,
}: {
  summary: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="my-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground sm:text-sm">
      <div>{summary}</div>
      <div className="flex min-w-0 max-w-full items-center gap-2">
        {children}
      </div>
    </div>
  );
}

/** A column header that toggles sorting. */
export function SortableHeader<TData>({
  column,
  label,
}: {
  column: Column<TData, unknown>;
  label: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );
}

/** A text search bound to one column's filter. */
export function TextFilter<TData>({
  table,
  column,
  placeholder,
  label,
  className,
}: {
  table: TanstackTable<TData>;
  column: string;
  placeholder: string;
  /** Accessible name. Defaults to "Filter by {placeholder}". */
  label?: string;
  className?: string;
}) {
  return (
    <Input
      placeholder={placeholder}
      aria-label={label ?? `Filter by ${placeholder.toLowerCase()}`}
      value={(table.getColumn(column)?.getFilterValue() as string) ?? ""}
      onChange={(event) =>
        table.getColumn(column)?.setFilterValue(event.target.value)
      }
      className={cn("w-[150px] shrink-0 text-sm", className)}
    />
  );
}

type FilterOption = string | { value: string; label: ReactNode };

/**
 * A filter dropdown with an "all" option first. `value` null means no
 * filter. For filters kept outside the table (URL params, custom state).
 * The "all" option's value is its label: Radix SelectItem can't take an
 * empty value.
 */
export function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  label,
  className,
  id,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: FilterOption[];
  /** The no-filter option, e.g. "All Statuses". */
  allLabel: string;
  /** Accessible name, e.g. "Filter by status". */
  label: string;
  className?: string;
  id?: string;
}) {
  return (
    <Select
      value={value ?? allLabel}
      onValueChange={(next) => onChange(next === allLabel ? null : next)}
    >
      <SelectTrigger
        id={id}
        className={cn("w-[180px] shrink-0", className)}
        aria-label={label}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={allLabel}>{allLabel}</SelectItem>
        {options.map((option) => {
          const { value: optionValue, label: optionLabel } =
            typeof option === "string"
              ? { value: option, label: option }
              : option;
          return (
            <SelectItem key={optionValue} value={optionValue}>
              {optionLabel}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** A FilterSelect bound to one column's filter (use the column's `filterFn: "equals"`). */
export function SelectFilter<TData>({
  table,
  column,
  ...props
}: {
  table: TanstackTable<TData>;
  column: string;
} & Omit<Parameters<typeof FilterSelect>[0], "value" | "onChange">) {
  return (
    <FilterSelect
      {...props}
      value={(table.getColumn(column)?.getFilterValue() as string) ?? null}
      onChange={(value) =>
        table.getColumn(column)?.setFilterValue(value ?? undefined)
      }
    />
  );
}
