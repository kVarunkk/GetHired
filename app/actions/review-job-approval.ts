"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { JOB_STATE_REFUSALS } from "@/helpers/jobs/job-state-copy";
import { REVIEW_DECISION_STATE, isReviewDecision, type ReviewDecision } from "@/helpers/jobs/job-states";
import { setJobPostState, type SetJobPostStateResult } from "@/helpers/jobs/set-job-post-state";

/**
 * SERVER ACTION (JL-REQ-020/022): an approver approves a pending job (it
 * opens) or sends it back to a draft with a note. Needs `jobs.approve` on the
 * job; `set_job_post_state` checks it, the note and the plan's limit again.
 */
export async function reviewJobApprovalAction(params: {
  jobPostId: string;
  decision: ReviewDecision;
  note?: string | null;
}): Promise<SetJobPostStateResult> {
  const jobId = typeof params?.jobPostId === "string" ? params.jobPostId : null;
  const auth = await requireCompanyForAction({ permission: "jobs.approve", jobId });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!isReviewDecision(params.decision)) return { ok: false, error: JOB_STATE_REFUSALS.invalid_transition };
  const note = typeof params.note === "string" ? params.note.trim() : "";
  if (params.decision === "request_changes" && !note) return { ok: false, error: JOB_STATE_REFUSALS.note_required };

  return setJobPostState(
    { supabase: auth.supabase, company: auth.company, user: auth.user },
    {
      jobPostId: params.jobPostId,
      to: REVIEW_DECISION_STATE[params.decision],
      note: note || null,
      from: ["pending_approval"],
    },
  );
}
