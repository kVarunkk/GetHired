import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { companyAllows } from "@/helpers/companies/require-company";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isMatchingInProgress, RELEVANCE_PROFILES_QUEUE, type RelevanceProfilesMessage } from "./relevance-queue";

export type QueueJobRelevanceResult = { success: true; message: string } | { success: false; error: string };

/**
 * Queues a relevant-profiles run for one of the company's job postings
 * (RS-F08). It marks the posting `progress` itself and refuses while a recent
 * run is still going, since each run makes paid rerank calls. The worker does
 * the matching, retries it and emails the company.
 *
 * The caller passes the session it already resolved (the server action, the
 * job form's save, the recruiter agent and MCP), so nothing here reads the
 * request. It re-checks `matching.run` for the job.
 */
export async function queueJobPostingRelevance(
  {
    supabase,
    company,
    user,
  }: { supabase: SupabaseClient<Database>; company: MyCompany; user?: { id: string } },
  jobId: string,
): Promise<QueueJobRelevanceResult> {
  if (typeof jobId !== "string" || !isUuid(jobId)) {
    return { success: false, error: "Job posting not found." };
  }
  const denied = companyAllows(company, { permission: "matching.run", jobId });
  if (denied) return { success: false, error: denied };

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

  // The worker looks the company up by its owner's user id (TM-CON-001), which
  // comes from the session's membership, never from the client.
  const ownerId = company.ownerUserId ?? user?.id;
  if (!ownerId) return { success: false, error: "Failed to start matching." };

  // Ownership is settled above. Any member may run matching, but job_postings
  // writes are owner/admin under RLS (TM-REQ-004), so the status marks use the
  // service role, scoped to the session company.
  const service = createServiceRoleClient();

  // Marked before queueing, so a fast worker's completed/failed isn't overwritten.
  const { error: markError } = await service
    .from("job_postings")
    .update({
      matching_status: "progress",
      matching_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("company_id", company.id);
  if (markError) return { success: false, error: "Failed to start matching." };

  const { error: sendError } = await service
    .schema("pgmq_public")
    .rpc("send", {
      queue_name: RELEVANCE_PROFILES_QUEUE,
      message: { userId: ownerId, jobId } satisfies RelevanceProfilesMessage,
      sleep_seconds: 0,
    });

  if (sendError) {
    await service
      .from("job_postings")
      .update({
        matching_status: "failed",
        matching_error: "Couldn't queue matching.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("company_id", company.id);

    await eventCaptureServerException({
      error: new Error(sendError.message),
      distinctId: user?.id ?? ownerId,
      properties: { flow: "trigger_job_posting_relevance_enqueue", jobId },
    });
    return { success: false, error: "Failed to start matching." };
  }

  return { success: true, message: "processing started" };
}
