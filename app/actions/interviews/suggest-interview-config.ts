"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { suggestInterviewConfig, type SuggestConfigResult } from "@/helpers/interview/screening/suggest-config";

/**
 * SERVER ACTION: drafts competencies and questions from the job post
 * (SI-REQ-002). Needs interviews.manage on the job. Nothing is saved.
 */
export async function suggestInterviewConfigAction({ jobPostId }: { jobPostId: string }): Promise<SuggestConfigResult> {
  const auth = await requireCompanyForAction({
    permission: "interviews.manage",
    jobId: typeof jobPostId === "string" ? jobPostId : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };

  const { data: job } = await auth.supabase
    .from("job_postings")
    .select("title, description, skills")
    .eq("id", jobPostId)
    .eq("company_id", auth.company.id)
    .maybeSingle();
  if (!job) return { ok: false, error: "Job posting not found." };

  return suggestInterviewConfig(job);
}
