"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/helpers/agent/auth";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { loadInterviewPlan, saveInterviewPlan, type PlanItem, type SavePlanResult } from "@/helpers/interviews/plan";

/**
 * SERVER ACTION: replaces a job's interview plan (IV-REQ-001–003). Needs
 * `interview_plans.manage` on the job; the company is the session's, and the
 * RPC takes it from the job. Interviews already scheduled keep their snapshot.
 * Returns the saved plan with its ids.
 */
export async function saveInterviewPlanAction({
  jobPostId,
  items,
}: {
  jobPostId: string;
  items: unknown;
}): Promise<Exclude<SavePlanResult, { ok: true }> | { ok: true; plan: PlanItem[] }> {
  if (!isUuid(jobPostId)) return { ok: false, error: "Job posting not found." };
  const auth = await requireCompanyForAction({ permission: "interview_plans.manage", jobId: jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await saveInterviewPlan(auth.supabase, jobPostId, items);
  if (!result.ok) return result;
  revalidatePath(`/company/job-posts/${jobPostId}/interview-plan`);
  // The saved ids, so the editor's next save keeps them (IV-REQ-003).
  return { ok: true, plan: await loadInterviewPlan(auth.supabase, jobPostId) };
}
