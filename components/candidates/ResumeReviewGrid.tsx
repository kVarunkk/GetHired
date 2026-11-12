"use client";

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, RotateCw, Trash2, X } from "lucide-react";
import ConfirmDialog from "@/components/ConfirmDialog";
import DataTable from "@/components/DataTable";
import { EditableCell } from "@/components/candidates/ImportPreviewGrid";
import { ImportRowResumeView } from "@/components/candidates/ImportResumeView";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CandidateFieldKey } from "@/helpers/candidates/candidate-schema";
import { isInFlight, needsEmail, type ImportRowStatus, type ImportRowView } from "@/helpers/candidates/import-rows";
import { TARGET_LABELS } from "@/helpers/candidates/map-columns";
import { candidatePath } from "@/helpers/candidates/paths";
import { DUPLICATE_ACTION_LABELS, DUPLICATE_ACTIONS, type DuplicateAction } from "@/helpers/candidates/preview-rows";
import { resumeErrorMessage } from "@/helpers/candidates/resume-files";

/** The fields the grid shows; the rest of the read is kept and saved as is. */
export const RESUME_GRID_FIELDS = [
  "full_name",
  "email",
  "phone",
  "location",
  "current_title",
  "current_company",
  "experience_years",
] as const satisfies readonly CandidateFieldKey[];

export type ResumeGridField = (typeof RESUME_GRID_FIELDS)[number];

const STATUS_LABELS: Record<ImportRowStatus, string> = {
  queued: "Waiting",
  parsing: "Reading",
  parsed: "Read",
  failed: "Failed",
  removed: "Removed",
  confirmed: "Imported",
};

const STATUS_VARIANT: Record<ImportRowStatus, BadgeProps["variant"]> = {
  queued: "outline",
  parsing: "outline",
  parsed: "success",
  failed: "destructive",
  removed: "outline",
  confirmed: "secondary",
};

const textOf = (value: unknown) =>
  value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value);

export type KnownUsers = Map<string, { userId: string; fullName: string | null }>;

type Selection = {
  /** Every read row, on every page: the ones a box can tick. */
  parsed: ImportRowView[];
  excluded: ReadonlySet<string>;
  onSelect: (rowIds: string[], selected: boolean) => void;
  disabled: boolean;
};

// The boxes read the selection from here rather than from the column
// definitions, so ticking a box doesn't rebuild the columns and remount the
// cells (which would drop an edit in progress and the keyboard focus).
const SelectionContext = createContext<Selection | null>(null);

function SelectAllBox() {
  const { parsed, excluded, onSelect, disabled } = useContext(SelectionContext)!;
  const ticked = parsed.filter((r) => !excluded.has(r.id)).length;
  const checked: boolean | "indeterminate" =
    parsed.length > 0 && ticked === parsed.length ? true : ticked > 0 ? "indeterminate" : false;
  return (
    <Checkbox
      aria-label="Select all resumes"
      checked={checked}
      disabled={disabled || parsed.length === 0}
      onCheckedChange={() =>
        onSelect(
          parsed.map((r) => r.id),
          checked !== true,
        )
      }
    />
  );
}

function RowBox({ row }: { row: ImportRowView }) {
  const { excluded, onSelect, disabled } = useContext(SelectionContext)!;
  if (row.status !== "parsed") return null;
  return (
    <Checkbox
      aria-label={`Import ${row.fileName}`}
      checked={!excluded.has(row.id)}
      disabled={disabled}
      onCheckedChange={(value) => onSelect([row.id], value === true)}
    />
  );
}

/**
 * BI-REQ-023/024: one row per resume with its status, a link to view the
 * file, what was read (edited in place; a warning shows under its cell until
 * the field is edited), the existing candidate with the same email and what
 * to do with them. A read row has a box: unticked rows aren't imported, and
 * their files are deleted at Confirm. A row still being read can be stopped
 * (which hands back its resume import), and a failed one retried or removed;
 * both ask first, since the file is deleted. A read row without an email is
 * highlighted when it blocks Confirm (a job, BI-REQ-025); without a job it's
 * only noted (CP-REQ-002).
 */
export default function ResumeReviewGrid({
  rows,
  known,
  defaultAction,
  onEdit,
  onDuplicateAction,
  onRetry,
  onRemove,
  excluded,
  onSelect,
  emailRequired = true,
  disabled = false,
}: {
  rows: ImportRowView[];
  /** GetHired users already in the company's pipeline, by lower-cased email (BI-REQ-019). */
  known: KnownUsers;
  defaultAction: DuplicateAction;
  onEdit: (rowId: string, field: ResumeGridField, value: string) => void;
  onDuplicateAction: (rowId: string, action: DuplicateAction) => void;
  onRetry: (rowId: string) => void;
  onRemove: (rowId: string) => void;
  /** The read rows the member unticked. */
  excluded: ReadonlySet<string>;
  onSelect: (rowIds: string[], selected: boolean) => void;
  /** Everyone needs an email: the import goes to a job. */
  emailRequired?: boolean;
  disabled?: boolean;
}) {
  const [removing, setRemoving] = useState<ImportRowView | null>(null);

  const parsed = useMemo(() => rows.filter((r) => r.status === "parsed"), [rows]);
  const selection = useMemo<Selection>(
    () => ({ parsed, excluded, onSelect, disabled }),
    [parsed, excluded, onSelect, disabled],
  );

  const columns = useMemo<ColumnDef<ImportRowView>[]>(
    () => [
      {
        id: "select",
        header: () => <SelectAllBox />,
        cell: ({ row }) => <RowBox row={row.original} />,
        meta: { className: "w-8", headerClassName: "w-8" },
      },
      {
        id: "file",
        header: "Resume",
        cell: ({ row }) => {
          const r = row.original;
          const email = textOf(r.fields.email).trim().toLowerCase();
          const knownUser = email ? known.get(email) : undefined;
          return (
            <div className="flex min-w-[12rem] max-w-[16rem] flex-col items-start gap-1 whitespace-normal">
              <span className="break-all text-sm font-medium">{r.fileName}</span>
              <ImportRowResumeView rowId={r.id} fileName={r.fileName} />
              <Badge variant={STATUS_VARIANT[r.status]}>
                {isInFlight(r) && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />}
                {STATUS_LABELS[r.status]}
              </Badge>
              {r.status === "failed" && (
                <span className="text-xs text-destructive">{resumeErrorMessage(r.errorCode)}</span>
              )}
              {needsEmail(r) &&
                (emailRequired ? (
                  <span className="text-xs text-destructive">Add an email to import them.</span>
                ) : (
                  <span className="text-xs text-muted-foreground">No email: can&apos;t be added to a job yet.</span>
                ))}
              {r.duplicateOf && (
                <Link href={candidatePath(r.duplicateOf)} className="text-xs underline underline-offset-4" target="_blank">
                  Already a candidate
                </Link>
              )}
              {knownUser && (
                <Link
                  href={`/company/profiles/${knownUser.userId}`}
                  className="text-xs underline underline-offset-4"
                  target="_blank"
                >
                  Already on GetHired: won&apos;t be imported
                </Link>
              )}
            </div>
          );
        },
      },
      ...RESUME_GRID_FIELDS.map(
        (field): ColumnDef<ImportRowView> => ({
          id: field,
          header: TARGET_LABELS[field],
          cell: ({ row }) => {
            const r = row.original;
            if (r.status !== "parsed") return <span className="text-muted-foreground">—</span>;
            const warning = r.warnings.find((w) => w.field === field)?.message;
            const error = emailRequired && field === "email" && needsEmail(r) ? "Required" : warning;
            return (
              <EditableCell
                value={textOf(r.fields[field])}
                error={error}
                label={`${TARGET_LABELS[field]}, ${r.fileName}`}
                disabled={disabled}
                onCommit={(value) => onEdit(r.id, field, value)}
              />
            );
          },
        }),
      ),
      {
        id: "duplicate",
        header: "If already a candidate",
        cell: ({ row }) => {
          const r = row.original;
          if (!r.duplicateOf || r.status !== "parsed") return null;
          return (
            <Select
              value={r.duplicateAction ?? defaultAction}
              onValueChange={(next) => onDuplicateAction(r.id, next as DuplicateAction)}
              disabled={disabled}
            >
              <SelectTrigger className="h-8 min-w-[10rem]" aria-label={`Duplicate action, ${r.fileName}`}>
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
          );
        },
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-1">
              {r.status === "failed" && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={disabled}
                    aria-label={`Retry ${r.fileName}`}
                    onClick={() => onRetry(r.id)}
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={disabled}
                    aria-label={`Remove ${r.fileName}`}
                    onClick={() => setRemoving(r)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
              {isInFlight(r) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={disabled}
                  aria-label={`Stop reading ${r.fileName}`}
                  title="Stop reading"
                  onClick={() => setRemoving(r)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        },
        meta: { className: "w-24" },
      },
    ],
    [known, defaultAction, onEdit, onDuplicateAction, onRetry, emailRequired, disabled],
  );

  const stopping = removing ? isInFlight(removing) : false;

  return (
    <SelectionContext.Provider value={selection}>
      <DataTable
        data={rows}
        columns={columns}
        noun="resumes"
        pageSize={25}
        getRowId={(r) => r.id}
        aria-label="Resumes to import"
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={stopping ? "Stop reading this resume?" : "Remove this resume?"}
        description={
          stopping
            ? `${removing?.fileName} won't be read or imported, and the file is deleted. Its resume import is handed back.`
            : `${removing?.fileName} is taken out of this import and the file is deleted.`
        }
        confirmLabel={stopping ? "Stop reading" : "Remove"}
        onConfirm={() => {
          if (removing) onRemove(removing.id);
        }}
      />
    </SelectionContext.Provider>
  );
}
