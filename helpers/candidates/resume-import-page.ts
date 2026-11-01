import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { loadImportPage, type ImportPage } from "./import-page";
import { importRowView, type ImportBatchView, type ImportRowView } from "./import-rows";

export type ResumeImportPage = ImportPage & {
  /** The member's latest resume import for this place that isn't confirmed yet, to pick up after a reload. */
  open: { batch: ImportBatchView; rows: ImportRowView[] } | null;
};

/**
 * What the resume import needs (BI-REQ-020–025, CP-REQ-010/011), from a job
 * page (`jobId`) or the Candidates page: the import page's destinations, and
 * the member's open batch for that place. A job page resumes the batch it
 * opened for that job; the Candidates page resumes the one it opened, which
 * may have been given a job since. Null when the member can't import anyone.
 */
export async function loadResumeImportPage(
  supabase: SupabaseClient<Database>,
  company: MyCompany,
  { userId, jobId = null }: { userId: string; jobId?: string | null },
): Promise<ResumeImportPage | null> {
  const page = await loadImportPage(supabase, company, { jobId });
  if (!page) return null;
  if (page.notFound) return { ...page, open: null };

  let batches = supabase
    .from("candidate_import_batches")
    .select("id, status, job_post_id, talent_list_id, stage_id, auto_invite, expires_at")
    .eq("company_id", company.id)
    .eq("kind", "resumes")
    .eq("created_by", userId)
    .in("status", ["parsing", "ready"])
    .gt("expires_at", new Date().toISOString());
  batches = page.fixedJob
    ? batches.eq("opened_from", "job").eq("job_post_id", page.fixedJob.id)
    : batches.eq("opened_from", "candidates");
  const { data: batch } = await batches.order("created_at", { ascending: false }).limit(1).maybeSingle();

  let open: ResumeImportPage["open"] = null;
  if (batch) {
    const { data: rows, error } = await supabase
      .from("candidate_import_rows")
      .select("id, file_name, status, error_code, extracted, edited, warnings, duplicate_of, duplicate_action")
      .eq("batch_id", batch.id)
      .neq("status", "removed")
      .order("created_at")
      .order("id");
    if (error) throw error;
    open = {
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

  return { ...page, open };
}
