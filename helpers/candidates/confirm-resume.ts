import { revalidatePath } from "next/cache";
import { z } from "zod";
import { companyAllows } from "@/helpers/companies/require-company";
import { createTalentList, deleteTalentList } from "@/helpers/pipeline/talent-lists";
import { parseCandidateFields } from "./candidate-schema";
import { IMPORT_MESSAGES, importCountsOf, importMessage, type ImportCounts } from "./copy";
import { mergedFields } from "./import-rows";
import type { ImportSession } from "./import-session";
import { CANDIDATES_LIST_PATH } from "./paths";
import { deleteCandidateFiles } from "./resume-import";

const duplicateAction = z.enum(["skip", "fill", "overwrite"]);

export const confirmResumeSchema = z
  .object({
    batchId: z.string().uuid(),
    /** The destination (CP-REQ-001). Absent: the batch's own; null: the talent pool. */
    jobPostId: z.string().uuid().nullable().optional(),
    talentListId: z.string().uuid().nullable().optional(),
    newListName: z.string().trim().min(1).max(200).optional(),
    stageId: z.string().uuid().nullable().optional(),
    duplicateAction: duplicateAction.optional(),
    /**
     * The read rows to import (the grid's ticked boxes). The batch's other
     * read rows are dropped with their files. Absent: every read row (the
     * agent's confirmImport).
     */
    rowIds: z.array(z.string().uuid()).min(1).max(100).optional(),
    rowActions: z
      .array(z.object({ rowId: z.string().uuid(), duplicateAction }).strict())
      .max(100)
      .optional(),
    autoInvite: z.boolean().optional(),
    attested: z.boolean(),
    lawfulBasisNote: z.string().trim().max(200).optional(),
  })
  .strict();

export type ConfirmResumeInput = z.output<typeof confirmResumeSchema>;

export type ConfirmResumeResult =
  | {
      ok: true;
      counts: ImportCounts;
      jobPostId: string | null;
      list: { id: string; slug: string; name: string } | null;
    }
  | { ok: false; error: string; rowIds?: string[] };

/**
 * BI-REQ-025, CP-REQ-001–005: confirms a resume batch's parsed rows into its
 * destination: the talent pool, a talent list (which it can create, with
 * talent_lists.manage) and/or a job. Every row is validated again here with
 * the candidate schema (the worker's read plus the member's edits); with a
 * job every row needs an email, without one it's optional.
 * `confirm_candidate_import` checks applicants.import for the job (unscoped
 * without one), the list and the attestation, re-runs the known-user check
 * from the session (BI-REQ-019), applies the duplicate actions and creates
 * the applications, which the screening trigger queues. No stage email is
 * sent (BI-REQ-015c). The files no candidate kept are deleted. Shared by
 * `confirmResumeImportAction` and the agent's `confirmImport`.
 */
export async function confirmResumeBatch(auth: ImportSession, data: ConfirmResumeInput): Promise<ConfirmResumeResult> {
  if (data.jobPostId !== undefined) {
    const denied = companyAllows(auth.company, { permission: "applicants.import", jobId: data.jobPostId });
    if (denied) return { ok: false, error: denied };
  }
  if (data.talentListId && data.newListName) return { ok: false, error: IMPORT_MESSAGES.invalid };
  if (data.talentListId || data.newListName) {
    const denied = companyAllows(auth.company, { permission: "talent_lists.manage" });
    if (denied) return { ok: false, error: denied };
  }
  if (!data.attested) return { ok: false, error: IMPORT_MESSAGES.not_attested };

  const { data: rows, error: rowsError } = await auth.supabase
    .from("candidate_import_rows")
    .select("id, extracted, edited")
    .eq("batch_id", data.batchId)
    .eq("company_id", auth.company.id)
    .eq("status", "parsed");
  if (rowsError) throw new Error(`Failed to load the import: ${rowsError.message}`);

  const chosen = data.rowIds ? new Set(data.rowIds) : null;
  const invalid = (rows ?? []).filter(
    (row) => (!chosen || chosen.has(row.id)) && !parseCandidateFields(mergedFields(row.extracted, row.edited)).ok,
  );
  if (invalid.length > 0) {
    return { ok: false, error: "Fix the highlighted rows first.", rowIds: invalid.map((r) => r.id) };
  }

  let listId = data.talentListId;
  let newList: { id: string; slug: string; name: string } | null = null;
  if (data.newListName) {
    const created = await createTalentList(auth, data.newListName);
    if (!created.ok) return { ok: false, error: created.error };
    newList = { id: created.list.id, slug: created.list.slug, name: created.list.name };
    listId = created.list.id;
  }
  // A list made for this import goes again if the import doesn't go through.
  const dropNewList = async () => {
    if (newList) await deleteTalentList(auth, newList.id).catch(() => {});
  };

  const { data: result, error } = await auth.supabase.rpc("confirm_candidate_import", {
    p_batch_id: data.batchId,
    p_rows: (data.rowActions ?? []).map((r) => ({ row_id: r.rowId, duplicate_action: r.duplicateAction })),
    p_options: {
      ...(data.jobPostId !== undefined ? { job_post_id: data.jobPostId } : {}),
      ...(listId !== undefined ? { talent_list_id: listId } : {}),
      stage_id: data.stageId ?? null,
      ...(data.rowIds ? { row_ids: data.rowIds } : {}),
      duplicate_action: data.duplicateAction ?? "skip",
      auto_invite: data.autoInvite ?? false,
      attested: true,
      lawful_basis_note: data.lawfulBasisNote ?? null,
    },
  });
  if (error) {
    await dropNewList();
    throw new Error(`Failed to confirm the import: ${error.message}`);
  }
  const confirmed = result as {
    ok: boolean;
    reason?: string;
    row_ids?: string[];
    counts?: unknown;
    delete_paths?: string[];
  };
  if (!confirmed.ok) {
    await dropNewList();
    return { ok: false, error: importMessage(confirmed.reason), rowIds: confirmed.row_ids };
  }

  await deleteCandidateFiles(confirmed.delete_paths ?? []);

  const { data: batch } = await auth.supabase
    .from("candidate_import_batches")
    .select("job_post_id, talent_lists(id, slug, name)")
    .eq("id", data.batchId)
    .maybeSingle();
  const jobPostId = batch?.job_post_id ?? null;
  const list = newList ?? batch?.talent_lists ?? null;
  revalidatePath(CANDIDATES_LIST_PATH);
  // A talent list's tab shows its candidates too.
  revalidatePath("/company/profiles");
  revalidatePath("/company/applications");
  if (jobPostId) revalidatePath(`/company/job-posts/${jobPostId}`, "layout");
  return { ok: true, counts: importCountsOf(confirmed.counts), jobPostId, list };
}
