"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { importMessage } from "@/helpers/candidates/copy";
import { importRowView, type ImportBatchView, type ImportRowView } from "@/helpers/candidates/import-rows";

const inputSchema = z.object({ batchId: z.string().uuid() }).strict();

export type ImportStatusResult = { ok: true; batch: ImportBatchView; rows: ImportRowView[] } | { ok: false; error: string };

/**
 * SERVER ACTION (BI-REQ-023): a resume batch and its rows, for the review
 * grid to poll while files parse. Reads through RLS, so only members who can
 * view the batch's job see it, and only the session company's batch.
 */
export async function importStatusAction(input: z.input<typeof inputSchema>): Promise<ImportStatusResult> {
  const auth = await requireCompanyForAction({ permission: "applicants.import" });
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: importMessage("invalid") };

  const { data: batch } = await auth.supabase
    .from("candidate_import_batches")
    .select("id, status, job_post_id, talent_list_id, stage_id, auto_invite, counts, expires_at")
    .eq("id", parsed.data.batchId)
    .eq("company_id", auth.company.id)
    .eq("kind", "resumes")
    .maybeSingle();
  if (!batch) return { ok: false, error: importMessage("not_found") };

  const { data: rows, error } = await auth.supabase
    .from("candidate_import_rows")
    .select("id, file_name, status, error_code, extracted, edited, warnings, duplicate_of, duplicate_action, created_at")
    .eq("batch_id", batch.id)
    .neq("status", "removed")
    .order("created_at")
    .order("id");
  if (error) throw new Error(`Failed to load the import: ${error.message}`);

  return {
    ok: true,
    batch: {
      id: batch.id,
      status: batch.status,
      jobPostId: batch.job_post_id,
      talentListId: batch.talent_list_id,
      stageId: batch.stage_id,
      autoInvite: batch.auto_invite,
      expiresAt: batch.expires_at,
    },
    rows: (rows ?? []).map(importRowView),
  };
}
