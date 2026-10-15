"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  isMatchingInProgress,
  RELEVANCE_PROFILES_QUEUE,
  type RelevanceProfilesMessage,
} from "@/helpers/profiles/relevance-queue";

/**
 * SERVER ACTION: queues a relevant-profiles run for one of the session
 * company's job postings (RS-F08), the same way triggerRelevanceUpdate queues
 * an applicant's relevant jobs. It marks the posting `progress` itself and
 * refuses while a recent run is still going, since each run makes paid rerank
 * calls. The worker does the matching, retries it and emails the company.
 */
export async function triggerJobPostingRelevanceUpdate(
  jobId: string,
): Promise<{ success: true; message: string } | { success: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { success: false, error: auth.error };
  const { supabase, company, user } = auth;

  if (typeof jobId !== "string" || !isUuid(jobId)) {
    return { success: false, error: "Job posting not found." };
  }

  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select("id, matching_status, updated_at")
    .eq("id", jobId)
    .eq("company_id", company.id)
    .maybeSingle();

  if (loadError) return { success: false, error: "Failed to load the job posting." };
  if (!posting) return { success: false, error: "Job posting not found." };

  if (isMatchingInProgress(posting)) {
    return { success: false, error: "Matching is already in progress for this job." };
  }

  // Marked before queueing, so a fast worker's completed/failed isn't overwritten.
  const { error: markError } = await supabase
    .from("job_postings")
    .update({
      matching_status: "progress",
      matching_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (markError) return { success: false, error: "Failed to start matching." };

  // Ownership is settled above. The worker looks the company up by this
  // user id, so it comes from the session, never from the client.
  const { error: sendError } = await createServiceRoleClient()
    .schema("pgmq_public")
    .rpc("send", {
      queue_name: RELEVANCE_PROFILES_QUEUE,
      message: { userId: user.id, jobId } satisfies RelevanceProfilesMessage,
      sleep_seconds: 0,
    });

  if (sendError) {
    await supabase
      .from("job_postings")
      .update({
        matching_status: "failed",
        matching_error: "Couldn't queue matching.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    await eventCaptureServerException({
      error: new Error(sendError.message),
      distinctId: user.id,
      properties: { flow: "trigger_job_posting_relevance_enqueue", jobId },
    });
    return { success: false, error: "Failed to start matching." };
  }

  return { success: true, message: "processing started" };
}
