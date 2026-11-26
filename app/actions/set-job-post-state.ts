"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { cancelOpenScreeningInterviews } from "@/helpers/jobs/job-interviews";
import type { JobPostState, ManualCloseReason } from "@/helpers/jobs/job-states";
import { setJobPostState, type SetJobPostStateResult } from "@/helpers/jobs/set-job-post-state";

export type SetJobPostStateActionResult =
  | (Extract<SetJobPostStateResult, { ok: true }> & {
      /** D9: AI interviews cancelled after a close or fill. */
      interviewsCancelled?: number;
      /** Set when the move applied but cancelling the interviews didn't. */
      interviewsError?: string;
    })
  | Exclude<SetJobPostStateResult, { ok: true }>;

/**
 * SERVER ACTION: moves one of the session company's job posts to another
 * state (JL-REQ-005). The company comes from the session; the work is in
 * `helpers/jobs/set-job-post-state.ts`, shared with the agent. With
 * `cancelOpenInterviews` on a close or fill, the job's open AI screening
 * interviews are cancelled after the move applied (D9).
 */
export async function setJobPostStateAction(params: {
  jobPostId: string;
  to: JobPostState;
  reason?: ManualCloseReason | null;
  note?: string | null;
  cancelOpenInterviews?: boolean;
}): Promise<SetJobPostStateActionResult> {
  const jobId = typeof params?.jobPostId === "string" ? params.jobPostId : null;
  const auth = await requireCompanyForAction({ permission: "jobs.publish", jobId });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await setJobPostState(
    { supabase: auth.supabase, company: auth.company, user: auth.user },
    { jobPostId: params.jobPostId, to: params.to, reason: params.reason, note: params.note },
  );
  if (!result.ok) return result;

  const closing = params.to === "closed" || params.to === "filled";
  if (!closing || params.cancelOpenInterviews !== true || !result.changed) return result;

  const cancelled = await cancelOpenScreeningInterviews(
    { supabase: auth.supabase, company: auth.company },
    params.jobPostId,
  );
  if (!cancelled.ok) return { ...result, interviewsError: cancelled.error };
  return {
    ...result,
    interviewsCancelled: cancelled.cancelled,
    ...(cancelled.failed > 0 ? { interviewsError: `${cancelled.failed} AI interviews couldn't be cancelled.` } : {}),
  };
}
