"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { FilterSelect } from "@/components/DataTable";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CandidateFieldKey } from "@/helpers/candidates/candidate-schema";
import { TARGET_LABELS, type MappedRow } from "@/helpers/candidates/map-columns";
import { candidatePath } from "@/helpers/candidates/paths";
import {
  DUPLICATE_ACTION_LABELS,
  DUPLICATE_ACTIONS,
  filterPreviewRows,
  IMPORTED_STATUSES,
  NO_PREVIEW_FILTERS,
  PREVIEW_STATUS_LABELS,
  PREVIEW_STATUSES,
  previewFiltersActive,
  type DuplicateAction,
  type Preview,
  type PreviewFilters,
  type PreviewRow,
  type PreviewStatus,
  type SelectionFilter,
} from "@/helpers/candidates/preview-rows";
import { cn } from "@/utils/utils";

export type GridField = CandidateFieldKey | "stage";

const STATUS_VARIANT: Record<PreviewStatus, BadgeProps["variant"]> = {
  ready: "success",
  error: "destructive",
  duplicate_in_file: "outline",
  existing: "warning",
  known: "secondary",
};

const SELECTION_LABELS: Record<SelectionFilter, string> = {
  selected: "Selected",
  not_selected: "Not selected",
};

const selectable = (r: PreviewRow) => IMPORTED_STATUSES.includes(r.status);

type Selection = {
  /** The shown rows that can be ticked, on every page. */
  shown: PreviewRow[];
  checked: boolean | "indeterminate";
  filtered: boolean;
  onSelect: (indices: number[], selected: boolean) => void;
  disabled: boolean;
};

// The boxes read the selection from here rather than from the column
// definitions, so ticking a box doesn't rebuild the columns and remount the
// cells (which would also drop the keyboard focus).
const SelectionContext = createContext<Selection | null>(null);

function SelectAllBox() {
  const { shown, checked, filtered, onSelect, disabled } = useContext(SelectionContext)!;
  return (
    <Checkbox
      aria-label={filtered ? "Select all shown rows" : "Select all rows"}
      checked={checked}
      disabled={disabled || shown.length === 0}
      onCheckedChange={() =>
        onSelect(
          shown.map((r) => r.index),
          checked !== true,
        )
      }
    />
  );
}

function RowBox({ row }: { row: PreviewRow }) {
  const { onSelect, disabled } = useContext(SelectionContext)!;
  return (
    <Checkbox
      aria-label={`Import row ${row.index + 1}`}
      title={selectable(row) ? undefined : "Fix this row to import it."}
      checked={row.selected}
      disabled={disabled || !selectable(row)}
      onCheckedChange={(value) => onSelect([row.index], value === true)}
    />
  );
}

/** A cell that edits on blur or Enter, so the preview re-runs once per edit. */
export function EditableCell({
  value,
  error,
  label,
  onCommit,
  disabled,
}: {
  value: string;
  error?: string;
  label: string;
  onCommit: (value: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // The row changed outside this cell (a reload of the file): show it.
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <div className="flex min-w-[9rem] flex-col gap-1">
      <Input
        value={draft}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={cn("h-8 text-sm", error && "border-destructive")}
      />
      {error && <p className="whitespace-normal text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * BI-REQ-013/014: every row of the file with its status, the counts per
 * status, cells that can be fixed in place, and what to do with each
 * existing candidate. Error rows and later duplicates are skipped, and so are
 * the rows the user unticks. The header box ticks or unticks every row the
 * filters show, on every page.
 */
export default function ImportPreviewGrid({
  preview,
  rows,
  fields,
  overrides,
  defaultAction,
  onEdit,
  onOverride,
  onSelect,
  disabled = false,
}: {
  preview: Preview;
  /** The mapped rows, as edited. */
  rows: MappedRow[];
  /** The mapped fields, in column order. */
  fields: GridField[];
  overrides: Record<number, DuplicateAction>;
  defaultAction: DuplicateAction;
  onEdit: (index: number, field: GridField, value: string) => void;
  onOverride: (index: number, action: DuplicateAction) => void;
  /** Ticks (`selected`) or unticks these rows. */
  onSelect: (indices: number[], selected: boolean) => void;
  disabled?: boolean;
}) {
  const [filters, setFilters] = useState<PreviewFilters>(NO_PREVIEW_FILTERS);
  const filter = (next: Partial<PreviewFilters>) => setFilters((old) => ({ ...old, ...next }));
  // A column that's no longer shown (Stage without a job) stops filtering.
  const field = fields.includes(filters.field as GridField) ? filters.field : null;
  const active = useMemo(() => ({ ...filters, field }), [filters, field]);
  const data = useMemo(
    () => filterPreviewRows(preview.rows, rows, fields, active),
    [preview.rows, rows, fields, active],
  );

  // The header box acts on every shown row that can be imported.
  const shownSelectable = useMemo(() => data.filter(selectable), [data]);
  const shownSelected = shownSelectable.filter((r) => r.selected).length;
  const allChecked: boolean | "indeterminate" =
    shownSelectable.length > 0 && shownSelected === shownSelectable.length
      ? true
      : shownSelected > 0
        ? "indeterminate"
        : false;
  const filtered = previewFiltersActive(active);
  const importable = preview.rows.filter(selectable).length;
  const selection = useMemo<Selection>(
    () => ({
      shown: shownSelectable,
      checked: allChecked,
      filtered,
      onSelect,
      disabled,
    }),
    [shownSelectable, allChecked, filtered, onSelect, disabled],
  );

  const columns = useMemo<ColumnDef<PreviewRow>[]>(
    () => [
      {
        id: "select",
        header: () => <SelectAllBox />,
        cell: ({ row }) => <RowBox row={row.original} />,
        meta: { className: "w-8", headerClassName: "w-8" },
      },
      {
        id: "row",
        header: "#",
        cell: ({ row }) => <span className="tabular-nums text-muted-foreground">{row.original.index + 1}</span>,
        meta: { className: "w-12" },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex min-w-[10rem] flex-col items-start gap-1 whitespace-normal">
              <Badge variant={STATUS_VARIANT[r.status]}>{PREVIEW_STATUS_LABELS[r.status]}</Badge>
              {r.status === "existing" && r.existingId && (
                <Link
                  href={candidatePath(r.existingId)}
                  className="text-xs underline underline-offset-4"
                  target="_blank"
                >
                  Open candidate
                </Link>
              )}
              {r.status === "known" && r.knownUserId && (
                <Link
                  href={`/company/profiles/${r.knownUserId}`}
                  className="text-xs underline underline-offset-4"
                  target="_blank"
                >
                  View profile
                </Link>
              )}
              {selectable(r) && !r.selected && (
                <span className="text-xs text-muted-foreground">Not selected: won&apos;t be imported</span>
              )}
              {r.noEmailForJob && (
                <span className="text-xs text-muted-foreground">No email: won&apos;t be added to the job</span>
              )}
            </div>
          );
        },
      },
      ...fields.map((field): ColumnDef<PreviewRow> => ({
        id: field,
        header: TARGET_LABELS[field],
        cell: ({ row }) => (
          <EditableCell
            value={rows[row.original.index]?.[field] ?? ""}
            error={row.original.errors[field]}
            label={`${TARGET_LABELS[field]}, row ${row.original.index + 1}`}
            disabled={disabled}
            onCommit={(value) => onEdit(row.original.index, field, value)}
          />
        ),
      })),
      {
        id: "action",
        header: "If already a candidate",
        cell: ({ row }) =>
          row.original.status === "existing" ? (
            <Select
              value={overrides[row.original.index] ?? defaultAction}
              onValueChange={(next) => onOverride(row.original.index, next as DuplicateAction)}
              disabled={disabled}
            >
              <SelectTrigger
                className="h-8 min-w-[10rem]"
                aria-label={`Duplicate action, row ${row.original.index + 1}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DUPLICATE_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {DUPLICATE_ACTION_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null,
      },
    ],
    [fields, rows, overrides, defaultAction, onEdit, onOverride, disabled],
  );

  return (
    <SelectionContext.Provider value={selection}>
      <div className="flex flex-col gap-4">
        <ul className="flex flex-wrap gap-2" aria-label="Rows by status">
          {PREVIEW_STATUSES.map((s) => (
            <li key={s}>
              <Badge variant={preview.counts[s] > 0 ? STATUS_VARIANT[s] : "outline"}>
                {PREVIEW_STATUS_LABELS[s]}: {preview.counts[s].toLocaleString("en-US")}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {preview.selected.toLocaleString("en-US")} of {importable.toLocaleString("en-US")} importable{" "}
          {importable === 1 ? "row" : "rows"} selected
        </p>
        <DataTable
          data={data}
          columns={columns}
          noun="rows"
          pageSize={25}
          getRowId={(r) => String(r.index)}
          aria-label="Rows to import"
          emptyMessage="No rows match the filters."
          externalFiltersActive={filtered}
          onClearFilters={() => setFilters(NO_PREVIEW_FILTERS)}
          filters={() => (
            <>
              <Input
                type="search"
                value={filters.query}
                onChange={(e) => filter({ query: e.target.value })}
                placeholder={field ? `Search ${TARGET_LABELS[field as GridField]}` : "Search rows"}
                aria-label="Search rows"
                className="w-[180px] shrink-0 text-sm"
              />
              <FilterSelect
                value={field}
                onChange={(v) => filter({ field: v })}
                options={fields.map((f) => ({
                  value: f,
                  label: TARGET_LABELS[f],
                }))}
                allLabel="All columns"
                label="Search in column"
                className="w-[160px]"
              />
              <FilterSelect
                value={filters.status}
                onChange={(v) => filter({ status: v as PreviewStatus | null })}
                options={PREVIEW_STATUSES.map((s) => ({
                  value: s,
                  label: PREVIEW_STATUS_LABELS[s],
                }))}
                allLabel="All statuses"
                label="Filter by status"
              />
              <FilterSelect
                value={filters.selection}
                onChange={(v) => filter({ selection: v as SelectionFilter | null })}
                options={(Object.keys(SELECTION_LABELS) as SelectionFilter[]).map((s) => ({
                  value: s,
                  label: SELECTION_LABELS[s],
                }))}
                allLabel="Selected or not"
                label="Filter by selection"
                className="w-[160px]"
              />
            </>
          )}
        />
      </div>
    </SelectionContext.Provider>
  );
}
