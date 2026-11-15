"use server";

import { isUuid } from "@/helpers/agent/auth";
import { toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import type { DraftPlanResult } from "@/helpers/interviews/ai/draft-plan";
import { draftPlanForJob } from "@/helpers/interviews/plan-draft";

/**
 * SERVER ACTION: drafts a job's interview plan from its post (IV-REQ-050).
 * Needs `interview_plans.manage` on the job. Nothing is saved: the editor
 * fills in the draft and the recruiter saves it. Charged one agent message
 * after a usable draft, never on a failure (`draftPlanForJob`, which the
 * agent shares).
 */
export async function draftInterviewPlanAction({
  jobPostId,
}: {
  jobPostId: string;
}): Promise<DraftPlanResult | EntitlementActionError> {
  if (!isUuid(jobPostId)) return { ok: false, error: "Job posting not found." };
  const auth = await requireCompanyForAction({ permission: "interview_plans.manage", jobId: jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await draftPlanForJob(auth, jobPostId);
  if ("entitlement" in result) return toEntitlementActionError(result.entitlement);
  if (!result.ok) return result;
  return { ok: true, items: result.items, notes: result.notes };
}
