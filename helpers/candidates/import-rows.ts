// The resume review grid's rows (BI-REQ-023/024). Client-safe: shared by the
// status action and the grid.

import type { Json } from "@/utils/types/database.types";
import type { CandidateResumeWarning } from "./parse-candidate-resume";

export type ImportRowStatus = "queued" | "parsing" | "parsed" | "failed" | "removed" | "confirmed";
export type DuplicateAction = "skip" | "fill" | "overwrite";

export type ImportRowView = {
  id: string;
  fileName: string;
  status: ImportRowStatus;
  errorCode: string | null;
  /** What the worker read, with the member's edits over it. */
  fields: Record<string, unknown>;
  /** The member's edits alone. */
  edited: Record<string, unknown>;
  warnings: CandidateResumeWarning[];
  /** An existing candidate with the email the worker read. */
  duplicateOf: string | null;
  duplicateAction: DuplicateAction | null;
};

export type ImportBatchView = {
  id: string;
  status: string;
  jobPostId: string | null;
  talentListId: string | null;
  stageId: string | null;
  autoInvite: boolean;
  expiresAt: string;
};

const objectOf = (value: Json | null | undefined): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The row's fields: the worker's, then the member's edits over them (as confirm reads them). */
export const mergedFields = (extracted: Json | null, edited: Json | null): Record<string, unknown> => ({
  ...objectOf(objectOf(extracted).fields as Json),
  ...objectOf(edited),
});

export function importRowView(row: {
  id: string;
  file_name: string;
  status: string;
  error_code: string | null;
  extracted: Json | null;
  edited: Json | null;
  warnings: Json;
  duplicate_of: string | null;
  duplicate_action: string | null;
}): ImportRowView {
  const edited = objectOf(row.edited);
  // A warning is answered once the member edits that field.
  const warnings = (Array.isArray(row.warnings) ? (row.warnings as CandidateResumeWarning[]) : []).filter(
    (w) => w && typeof w.field === "string" && !(w.field in edited),
  );
  return {
    id: row.id,
    fileName: row.file_name,
    status: row.status as ImportRowStatus,
    errorCode: row.error_code,
    fields: mergedFields(row.extracted, row.edited),
    edited,
    warnings,
    duplicateOf: row.duplicate_of,
    duplicateAction: (row.duplicate_action as DuplicateAction | null) ?? null,
  };
}

/** Rows the worker hasn't finished: the grid keeps polling while any are left. */
export const isInFlight = (row: Pick<ImportRowView, "status">) => row.status === "queued" || row.status === "parsing";

/** A parsed row without an email blocks Confirm (BI-REQ-025). */
export const needsEmail = (row: Pick<ImportRowView, "status" | "fields">) =>
  row.status === "parsed" && !(typeof row.fields.email === "string" && row.fields.email.trim());
