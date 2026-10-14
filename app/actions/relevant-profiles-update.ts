"use server";

import { after } from "next/server";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { processJobPostingRelevance } from "@/helpers/profiles/relevant-profiles-utils";

/** A run still "in progress" after this long is treated as dead and may be restarted. */
const STALE_PROGRESS_MS = 15 * 60 * 1000;

/**
 * SERVER ACTION: starts a relevant-profiles run for one of the session
 * company's job postings (RS-F08). It marks the posting `progress` itself and
 * refuses while a recent run is still going, since each run makes paid rerank
 * calls.
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

  const startedAt = Date.parse(posting.updated_at);
  if (
    posting.matching_status === "progress" &&
    !(Date.now() - startedAt > STALE_PROGRESS_MS)
  ) {
    return { success: false, error: "Matching is already in progress for this job." };
  }

  const { error: markError } = await supabase
    .from("job_postings")
    .update({
      matching_status: "progress",
      matching_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (markError) return { success: false, error: "Failed to start matching." };

  after(async () => {
    try {
      await processJobPostingRelevance(user.id, jobId);
    } catch (err) {
      await supabase
        .from("job_postings")
        .update({
          matching_status: "failed",
          matching_error: "unknown error occured",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      await eventCaptureServerException({
        error: err,
        distinctId: user.id,
        properties: { flow: "trigger_job_posting_relevance_after_block" },
      });
    }
  });

  return { success: true, message: "processing started" };
}
