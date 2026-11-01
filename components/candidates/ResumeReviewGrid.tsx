"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, RotateCw, Trash2 } from "lucide-react";
import DataTable from "@/components/DataTable";
import { EditableCell } from "@/components/candidates/ImportPreviewGrid";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * BI-REQ-023/024: one row per resume with its status, what was read (edited
 * in place; a warning shows under its cell until the field is edited), the
 * existing candidate with the same email and what to do with them, and
 * Retry (failed) or Remove. A read row without an email is highlighted
 * when it blocks Confirm (a job, BI-REQ-025); without a job it's only noted
 * (CP-REQ-002).
 */
export default function ResumeReviewGrid({
  rows,
  known,
  defaultAction,
  onEdit,
  onDuplicateAction,
  onRetry,
  onRemove,
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
  /** Everyone needs an email: the import goes to a job. */
  emailRequired?: boolean;
  disabled?: boolean;
}) {
  const columns = useMemo<ColumnDef<ImportRowView>[]>(
    () => [
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
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={disabled || isInFlight(r)}
                aria-label={`Remove ${r.fileName}`}
                onClick={() => onRemove(r.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
        meta: { className: "w-24" },
      },
    ],
    [known, defaultAction, onEdit, onDuplicateAction, onRetry, onRemove, emailRequired, disabled],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      noun="resumes"
      pageSize={25}
      getRowId={(r) => r.id}
      aria-label="Resumes to import"
    />
  );
}
