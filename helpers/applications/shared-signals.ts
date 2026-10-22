import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  CompanyInterviewAnalysisSchema,
  type CompanyInterviewAnalysisResult,
} from "@/helpers/interview/company-analysis-prompt";

export type SharedInterview = {
  status: "queued" | "processing" | "completed" | "failed";
  result: CompanyInterviewAnalysisResult | null;
};
export type SharedReview = { score: number | null; summary: string | null };
export type SharedSignals = {
  interview: SharedInterview | null;
  review: SharedReview | null;
  /** Attachments the company hasn't opened yet. */
  unviewedIds: string[];
};

const STATUSES = new Set(["queued", "processing", "completed", "failed"]);

/**
 * What the candidate shared with the company on one application (OR-REQ-032).
 * The attachments and the company-perspective analysis are read with the
 * company's own client, so RLS limits them to the company's applications and
 * to `perspective = 'company'` (OR-SEC-005). Companies have no access to
 * `resume_reviews`, so the review's score and summary are read with the
 * service role, and only for a review attached to an application RLS showed.
 */
export async function loadSharedSignals(
  supabase: SupabaseClient<Database>,
  applicationId: string,
): Promise<SharedSignals> {
  const { data: attachments, error } = await supabase
    .from("application_attachments")
    .select("id, kind, interview_session_id, resume_review_id, first_viewed_at")
    .eq("application_id", applicationId);
  if (error) throw new Error(`Failed to load shared items: ${error.message}`);

  const session = attachments?.find((a) => a.kind === "interview_session" && a.interview_session_id);
  const review = attachments?.find((a) => a.kind === "resume_review" && a.resume_review_id);

  const [interview, reviewRow] = await Promise.all([
    session?.interview_session_id
      ? supabase
          .from("interview_analyses")
          .select("status, result")
          .eq("interview_session_id", session.interview_session_id)
          .eq("perspective", "company")
          .maybeSingle()
          .then(({ data }) => data)
      : null,
    review?.resume_review_id
      ? createServiceRoleClient()
          .from("resume_reviews")
          .select("score, ai_response")
          .eq("id", review.resume_review_id)
          .eq("status", "completed")
          .maybeSingle()
          .then(({ data }) => data)
      : null,
  ]);

  let sharedInterview: SharedInterview | null = null;
  if (session) {
    const status = (STATUSES.has(interview?.status ?? "") ? interview!.status : "queued") as SharedInterview["status"];
    const parsed = status === "completed" ? CompanyInterviewAnalysisSchema.safeParse(interview?.result) : null;
    sharedInterview = { status: parsed && !parsed.success ? "failed" : status, result: parsed?.success ? parsed.data : null };
  }

  let sharedReview: SharedReview | null = null;
  if (reviewRow) {
    const feedback = (reviewRow.ai_response as { overall_feedback?: unknown } | null)?.overall_feedback;
    sharedReview = { score: reviewRow.score, summary: typeof feedback === "string" ? feedback : null };
  }

  return {
    interview: sharedInterview,
    review: sharedReview,
    unviewedIds: (attachments ?? []).filter((a) => !a.first_viewed_at).map((a) => a.id),
  };
}

/**
 * Sets `first_viewed_at` once on the attachments the company just saw, which
 * ends the candidate's right to un-share them. `ids` come from
 * `loadSharedSignals`, so they're already limited to this company's application.
 */
export async function markSharedSignalsViewed(applicationId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await createServiceRoleClient()
    .from("application_attachments")
    .update({ first_viewed_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .in("id", ids)
    .is("first_viewed_at", null);
  if (error) reportError("[shared-signals] couldn't mark as viewed", error.message);
}
