"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companyAllows, requireCompanyForAction } from "@/helpers/companies/require-company";
import { assertAllowance, holdEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError, toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { importMessage } from "@/helpers/candidates/copy";
import { candidateImportPath, jobImportPath } from "@/helpers/candidates/paths";
import { MAX_PARSING_BATCHES, RESUME_BUCKET } from "@/helpers/candidates/resume-files";
import { importRowRef, inChunks, releaseRowHolds, resumeImportsThatFit } from "@/helpers/candidates/resume-import";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const inputSchema = z
  .object({
    batchId: z.string().uuid(),
    /** The destination (CP-REQ-001). Absent: the batch's own; null: the talent pool. */
    jobPostId: z.string().uuid().nullable().optional(),
    talentListId: z.string().uuid().nullable().optional(),
    autoInvite: z.boolean().optional(),
    stageId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type SubmitResumeBatchResult =
  | { ok: true; queued: number }
  | { ok: false; error: string; fit?: number; total?: number }
  | EntitlementActionError;

/**
 * SERVER ACTION (BI-REQ-021/022): queues a draft resume batch for parsing.
 * Only files that reached Storage are queued; the rest fail as unreadable
 * and hold nothing. Holds one resume_imports unit per file for the session
 * user (the worker consumes or releases each); when the allowance can't
 * cover them, nothing is held and the result says how many fit. Stores
 * the destination (CP-REQ-001/011): the job, the list, the stage and the
 * auto-invite switch (BI-REQ-015b). Any scope of applicants.import gets past
 * the first check; a job in the input needs it for that job and a list
 * needs talent_lists.manage, and `submit_resume_batch` checks them again
 * with the batch's job.
 */
export async function submitResumeBatchAction(input: z.input<typeof inputSchema>): Promise<SubmitResumeBatchResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };
  const { batchId, autoInvite, stageId, jobPostId, talentListId } = parsed.data;
  const companyId = auth.company.id;
  if (jobPostId !== undefined) {
    const denied = companyAllows(auth.company, { permission: "applicants.import", jobId: jobPostId });
    if (denied) return { ok: false, error: denied };
  }
  if (talentListId) {
    const denied = companyAllows(auth.company, { permission: "talent_lists.manage" });
    if (denied) return { ok: false, error: denied };
  }

  const { data: batch } = await auth.supabase
    .from("candidate_import_batches")
    .select("id, status, job_post_id, expires_at")
    .eq("id", batchId)
    .eq("company_id", companyId)
    .eq("kind", "resumes")
    .maybeSingle();
  if (!batch) return { ok: false, error: importMessage("not_found") };
  if (batch.status !== "draft") return { ok: false, error: importMessage("already_submitted") };

  const { count: parsing } = await auth.supabase
    .from("candidate_import_batches")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("kind", "resumes")
    .eq("status", "parsing");
  if ((parsing ?? 0) >= MAX_PARSING_BATCHES) return { ok: false, error: importMessage("parsing_limit") };

  const { data: rows, error: rowsError } = await auth.supabase
    .from("candidate_import_rows")
    .select("id, file_path")
    .eq("batch_id", batchId)
    .eq("status", "queued");
  if (rowsError) throw new Error(`Failed to load the files: ${rowsError.message}`);

  // Which files reached Storage. The folder is the batch's own.
  const { data: stored, error: listError } = await createServiceRoleClient()
    .storage.from(RESUME_BUCKET)
    .list(`${companyId}/${batchId}`, { limit: 1000 });
  if (listError) throw new Error(`Failed to list the uploads: ${listError.message}`);
  const storedNames = new Set((stored ?? []).map((o) => o.name));
  const uploaded = (rows ?? []).filter((r) => storedNames.has(r.file_path?.split("/").pop() ?? ""));
  if (uploaded.length === 0) return { ok: false, error: importMessage("no_files_uploaded") };

  // BI-REQ-021: nothing is held unless every file fits.
  try {
    await assertAllowance(companyId, "resume_imports", uploaded.length, auth.user.id);
  } catch (err) {
    if (!(err instanceof EntitlementError)) throw err;
    const fit = await resumeImportsThatFit(companyId, uploaded.length, auth.user.id);
    return {
      ok: false,
      fit,
      total: uploaded.length,
      error:
        fit === 0
          ? "Your plan has no resume imports left. Buy more or wait for next month's."
          : `Your plan covers ${fit} of these ${uploaded.length} resumes. Remove ${uploaded.length - fit} or buy more.`,
    };
  }

  const held: string[] = [];
  const expiresAt = new Date(batch.expires_at);
  try {
    await inChunks(uploaded, 5, async (row) => {
      await holdEntitlement(companyId, "resume_imports", 1, importRowRef(row.id), auth.user.id, { expiresAt });
      held.push(row.id);
    });
  } catch (err) {
    await releaseRowHolds(companyId, held);
    if (err instanceof EntitlementError) return toEntitlementActionError(err);
    throw err;
  }

  const { data, error } = await auth.supabase.rpc("submit_resume_batch", {
    p_batch_id: batchId,
    p_row_ids: held,
    p_options: {
      auto_invite: autoInvite ?? false,
      stage_id: stageId ?? null,
      ...(jobPostId !== undefined ? { job_post_id: jobPostId } : {}),
      ...(talentListId !== undefined ? { talent_list_id: talentListId } : {}),
    },
  });
  const result = data as { ok: boolean; reason?: string; queued?: number } | null;
  if (error || !result?.ok) {
    await releaseRowHolds(companyId, held);
    if (error) throw new Error(`Failed to submit the resumes: ${error.message}`);
    return { ok: false, error: importMessage(result?.reason) };
  }

  // The page the import was opened from shows the open batch after a reload.
  if (batch.job_post_id) revalidatePath(jobImportPath(batch.job_post_id));
  else revalidatePath(candidateImportPath());
  return { ok: true, queued: result.queued ?? 0 };
}
