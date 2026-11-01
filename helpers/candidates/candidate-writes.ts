import { revalidatePath } from "next/cache";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { candidateFieldsSchema, fieldErrorsOf, type CandidateFieldErrors } from "./candidate-schema";
import { IMPORT_MESSAGES, importMessage } from "./copy";
import type { ImportSession } from "./import-session";
import { CANDIDATES_LIST_PATH } from "./paths";
import { deleteCandidateFiles } from "./resume-import";

/** BI-REQ-007: one delete removes at most this many (as `delete_company_candidates`). */
export const MAX_DELETE_CANDIDATES = 200;

/** The import's fields, any subset of them. Unknown keys (the opt-out, claim columns) are refused. */
const fieldsSchema = candidateFieldsSchema.partial().strict();

export type UpdateCandidateResult = { ok: true } | { ok: false; error: string; errors?: CandidateFieldErrors };
export type DeleteCandidatesResult = { ok: true; deleted: number } | { ok: false; error: string };

/**
 * BI-REQ-004: edits a company candidate's fields with the import's schema.
 * Only the fields sent change. `update_company_candidate` checks
 * applicants.import (unscoped, or for one of the candidate's jobs) and that
 * the email isn't another candidate's. Shared by `updateCandidateAction` and
 * the agent's `updateMyCandidate`.
 */
export async function updateCandidate(
  auth: ImportSession,
  candidateId: string,
  rawFields: Record<string, unknown>,
): Promise<UpdateCandidateResult> {
  const fieldsResult = fieldsSchema.safeParse(rawFields);
  if (!fieldsResult.success) {
    return { ok: false, error: "Fix the highlighted fields.", errors: fieldErrorsOf(fieldsResult.error) };
  }
  const fields: Record<string, unknown> = Object.fromEntries(
    Object.entries(fieldsResult.data).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(fields).length === 0) return { ok: false, error: IMPORT_MESSAGES.invalid };
  if (typeof fields.location === "string") [fields.location] = await canonicalizeLocations([fields.location]);

  const { data, error } = await auth.supabase.rpc("update_company_candidate", {
    p_candidate_id: candidateId,
    p_fields: fields as never,
  });
  if (error) throw new Error(`Failed to save the candidate: ${error.message}`);
  const result = data as { ok: boolean; reason?: string };
  if (!result.ok) return { ok: false, error: importMessage(result.reason) };

  revalidatePath(`/company/candidates/${candidateId}`, "layout");
  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  return { ok: true };
}

/**
 * BI-REQ-007: deletes company candidates with their imported applications,
 * list memberships and resume files. A claimed person's applications and
 * interviews stay, unlinked (BIT-100). The caller has checked
 * applicants.import unscoped, since a candidate can be in jobs the member
 * isn't on; `delete_company_candidates` checks it again. The audit entry has
 * the count, no names. Shared by `deleteCandidatesAction` and the agent's
 * `deleteMyCandidates`.
 */
export async function deleteCandidates(auth: ImportSession, candidateIds: string[]): Promise<DeleteCandidatesResult> {
  const { data, error } = await auth.supabase.rpc("delete_company_candidates", {
    p_candidate_ids: candidateIds,
  });
  if (error) throw new Error(`Failed to delete the candidates: ${error.message}`);
  const result = data as { ok: boolean; reason?: string; deleted?: number; resume_paths?: string[] };
  if (!result.ok) return { ok: false, error: importMessage(result.reason) };
  await deleteCandidateFiles(result.resume_paths ?? []);

  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  revalidatePath("/company/applications");
  return { ok: true, deleted: result.deleted ?? 0 };
}
