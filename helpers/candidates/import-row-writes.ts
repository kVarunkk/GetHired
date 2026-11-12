import { holdEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError, toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { candidateFieldsSchema, fieldErrorsOf, type CandidateFieldErrors } from "./candidate-schema";
import { importMessage } from "./copy";
import type { DuplicateAction } from "./import-rows";
import type { ImportSession } from "./import-session";
import { deleteCandidateFiles, importRowRef, releaseRowHolds } from "./resume-import";

/** Any subset of the import's fields; unknown keys are refused. */
const fieldsSchema = candidateFieldsSchema.partial().strict();

export type UpdateImportRowResult = { ok: true } | { ok: false; error: string; errors?: CandidateFieldErrors };
export type RemoveImportRowResult = { ok: true } | { ok: false; error: string };
export type RetryImportRowResult = { ok: true } | { ok: false; error: string } | EntitlementActionError;

// Shared by the review grid's actions and the recruiter agent's import tools.
// Each RPC checks applicants.import for the batch's job; the caller has
// checked it at some scope.

/**
 * BI-REQ-023/024: a member's edit to a review row (a read resume or a staged
 * spreadsheet row), validated with the candidate schema, and its duplicate
 * action. Edits are kept apart from what was read (`edited` over
 * `extracted`), and merge with earlier edits.
 */
export async function updateImportRow(
  auth: ImportSession,
  {
    rowId,
    fields: rawFields,
    duplicateAction,
  }: { rowId: string; fields?: Record<string, unknown>; duplicateAction?: DuplicateAction },
): Promise<UpdateImportRowResult> {
  let edited: Record<string, unknown> | null = null;
  if (rawFields) {
    const fieldsResult = fieldsSchema.safeParse(rawFields);
    if (!fieldsResult.success) {
      return { ok: false, error: "Fix the highlighted fields.", errors: fieldErrorsOf(fieldsResult.error) };
    }
    const fields: Record<string, unknown> = Object.fromEntries(
      Object.entries(fieldsResult.data).filter(([, value]) => value !== undefined),
    );
    if (typeof fields.location === "string") [fields.location] = await canonicalizeLocations([fields.location]);

    const { data: row } = await auth.supabase
      .from("candidate_import_rows")
      .select("edited")
      .eq("id", rowId)
      .eq("company_id", auth.company.id)
      .maybeSingle();
    if (!row) return { ok: false, error: importMessage("not_found") };
    const previous = row.edited && typeof row.edited === "object" && !Array.isArray(row.edited) ? row.edited : {};
    edited = { ...previous, ...fields };
  }
  if (!edited && !duplicateAction) return { ok: false, error: importMessage("invalid") };

  const { data, error } = await auth.supabase.rpc("update_import_row", {
    p_row_id: rowId,
    p_edited: edited as never,
    ...(duplicateAction ? { p_duplicate_action: duplicateAction } : {}),
  });
  if (error) throw new Error(`Failed to save the row: ${error.message}`);
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) return { ok: false, error: importMessage(result.reason) };
  return { ok: true };
}

/**
 * BI-REQ-023: takes a row out of its batch. A resume's hold is released if
 * one is left (a file removed before it was read costs nothing) and its file
 * is deleted; a staged spreadsheet row has neither.
 */
export async function removeImportRow(auth: ImportSession, rowId: string): Promise<RemoveImportRowResult> {
  const { data, error } = await auth.supabase.rpc("remove_import_row", { p_row_id: rowId });
  if (error) throw new Error(`Failed to remove the file: ${error.message}`);
  const result = data as { ok: boolean; reason?: string; file_path?: string | null };
  if (!result.ok) return { ok: false, error: importMessage(result.reason) };

  await releaseRowHolds(auth.company.id, [rowId]);
  if (result.file_path) await deleteCandidateFiles([result.file_path]);
  return { ok: true };
}

export type DiscardResumeImportResult = { ok: true } | { ok: false; error: string };

/**
 * Throws away a resume import that isn't confirmed (`discard_resume_import`),
 * so the page can start a new one: every row is removed, the batch expires,
 * holds left on unread rows are released and the files are deleted.
 */
export async function discardResumeImport(auth: ImportSession, batchId: string): Promise<DiscardResumeImportResult> {
  const { data, error } = await auth.supabase.rpc("discard_resume_import", { p_batch_id: batchId });
  if (error) throw new Error(`Failed to discard the import: ${error.message}`);
  const result = data as {
    ok: boolean;
    reason?: string;
    rows?: { id: string; file_path: string | null }[];
  };
  if (!result.ok) return { ok: false, error: importMessage(result.reason) };

  const rows = result.rows ?? [];
  await releaseRowHolds(auth.company.id, rows.map((r) => r.id));
  await deleteCandidateFiles(rows.flatMap((r) => (r.file_path ? [r.file_path] : [])));
  return { ok: true };
}

/**
 * BI-REQ-023: queues a failed resume again. A retry is a new hold of one
 * resume_imports unit, taken by the session user before `retry_import_row`
 * re-queues it; the hold is released if the row can't be retried.
 */
export async function retryImportRow(auth: ImportSession, rowId: string): Promise<RetryImportRowResult> {
  const { data: row } = await auth.supabase
    .from("candidate_import_rows")
    .select("id, status, candidate_import_batches(expires_at)")
    .eq("id", rowId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!row) return { ok: false, error: importMessage("not_found") };
  if (row.status !== "failed") return { ok: false, error: importMessage("not_failed") };

  const expiresAt = row.candidate_import_batches?.expires_at;
  try {
    await holdEntitlement(auth.company.id, "resume_imports", 1, importRowRef(rowId), auth.user.id, {
      ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}),
    });
  } catch (err) {
    if (err instanceof EntitlementError) return toEntitlementActionError(err);
    throw err;
  }

  const { data, error } = await auth.supabase.rpc("retry_import_row", { p_row_id: rowId });
  const result = data as { ok: boolean; reason?: string } | null;
  if (error || !result?.ok) {
    await releaseRowHolds(auth.company.id, [rowId]);
    if (error) throw new Error(`Failed to retry the file: ${error.message}`);
    return { ok: false, error: importMessage(result?.reason) };
  }
  return { ok: true };
}
