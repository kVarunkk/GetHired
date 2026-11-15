"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/helpers/agent/auth";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { copyInterviewPlan, loadInterviewPlan, type CopyPlanResult, type PlanItem } from "@/helpers/interviews/plan";

/**
 * SERVER ACTION: replaces `toJobId`'s interview plan with a copy of
 * `fromJobId`'s (IV-REQ-004). Needs `interview_plans.manage` on the target;
 * the RPC also checks the caller can see the source job's plan, and returns
 * the default interviewers it dropped. Returns the new plan.
 */
export async function copyInterviewPlanAction({
  fromJobId,
  toJobId,
}: {
  fromJobId: string;
  toJobId: string;
}): Promise<Exclude<CopyPlanResult, { ok: true }> | (Extract<CopyPlanResult, { ok: true }> & { plan: PlanItem[] })> {
  if (!isUuid(fromJobId) || !isUuid(toJobId)) return { ok: false, error: "Job posting not found." };
  const auth = await requireCompanyForAction({ permission: "interview_plans.manage", jobId: toJobId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await copyInterviewPlan(auth.supabase, { fromJobId, toJobId });
  if (!result.ok) return result;
  revalidatePath(`/company/job-posts/${toJobId}/interview-plan`);
  return { ...result, plan: await loadInterviewPlan(auth.supabase, toJobId) };
}
