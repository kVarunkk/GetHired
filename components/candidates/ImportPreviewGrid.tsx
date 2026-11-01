"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import DataTable, { FilterSelect } from "@/components/DataTable";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CandidateFieldKey } from "@/helpers/candidates/candidate-schema";
import { TARGET_LABELS, type MappedRow } from "@/helpers/candidates/map-columns";
import { candidatePath } from "@/helpers/candidates/paths";
import {
  DUPLICATE_ACTION_LABELS,
  DUPLICATE_ACTIONS,
  PREVIEW_STATUS_LABELS,
  PREVIEW_STATUSES,
  type DuplicateAction,
  type Preview,
  type PreviewRow,
  type PreviewStatus,
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
 * existing candidate. Error rows and later duplicates are skipped.
 */
export default function ImportPreviewGrid({
  preview,
  rows,
  fields,
  overrides,
  defaultAction,
  onEdit,
  onOverride,
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
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const data = useMemo(
    () => (status ? preview.rows.filter((r) => r.status === status) : preview.rows),
    [preview.rows, status],
  );

  const columns = useMemo<ColumnDef<PreviewRow>[]>(
    () => [
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
                <Link href={candidatePath(r.existingId)} className="text-xs underline underline-offset-4" target="_blank">
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
              {r.noEmailForJob && (
                <span className="text-xs text-muted-foreground">No email: won&apos;t be added to the job</span>
              )}
            </div>
          );
        },
      },
      ...fields.map(
        (field): ColumnDef<PreviewRow> => ({
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
        }),
      ),
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
              <SelectTrigger className="h-8 min-w-[10rem]" aria-label={`Duplicate action, row ${row.original.index + 1}`}>
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
      <DataTable
        data={data}
        columns={columns}
        noun="rows"
        pageSize={25}
        getRowId={(r) => String(r.index)}
        aria-label="Rows to import"
        externalFiltersActive={status !== null}
        onClearFilters={() => setStatus(null)}
        filters={() => (
          <FilterSelect
            value={status}
            onChange={(v) => setStatus(v as PreviewStatus | null)}
            options={PREVIEW_STATUSES.map((s) => ({ value: s, label: PREVIEW_STATUS_LABELS[s] }))}
            allLabel="All rows"
            label="Filter by status"
          />
        )}
      />
    </div>
  );
}
