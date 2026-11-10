import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { companyAllows } from "@/helpers/companies/require-company";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { transition } from "@/helpers/db/transition";
import { MATCHING_TIMEOUT_MS, RELEVANCE_PROFILES_QUEUE, type RelevanceProfilesMessage } from "./relevance-queue";

export type QueueJobRelevanceResult = { success: true; message: string } | { success: false; error: string };

/**
 * Queues a relevant-profiles run for one of the company's job postings
 * (RS-F08). start_matching marks the posting `progress` and refuses while a
 * live run holds it, in one statement (SM-REQ-004), since each run makes paid
 * rerank calls. The worker does the matching, retries it and emails the
 * company.
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

  // The worker looks the company up by its owner's user id (TM-CON-001), which
  // comes from the session's membership, never from the client.
  const ownerId = company.ownerUserId ?? user?.id;
  if (!ownerId) return { success: false, error: "Failed to start matching." };

  // With the caller's session, so the database checks matching.run for the
  // job (another company's job reads as forbidden). Started before queueing,
  // so a fast worker's completed/failed isn't overwritten.
  const { data: started, error: startError } = await supabase.rpc("start_matching", {
    p_job_id: jobId,
    p_timeout_seconds: MATCHING_TIMEOUT_MS / 1000,
  });
  if (startError) return { success: false, error: "Failed to start matching." };
  const outcome = started as { ok: boolean; reason?: string } | null;
  if (!outcome?.ok) {
    if (outcome?.reason === "in_progress") {
      return { success: false, error: "Matching is already in progress for this job." };
    }
    if (outcome?.reason === "not_found" || outcome?.reason === "forbidden") {
      return { success: false, error: "Job posting not found." };
    }
    return { success: false, error: "Failed to start matching." };
  }

  const service = createServiceRoleClient();
  const { error: sendError } = await service
    .schema("pgmq_public")
    .rpc("send", {
      queue_name: RELEVANCE_PROFILES_QUEUE,
      message: { userId: ownerId, jobId } satisfies RelevanceProfilesMessage,
      sleep_seconds: 0,
    });

  if (sendError) {
    // From `progress` only: nothing was queued, so the run started above is
    // over. job_postings writes are owner/admin under RLS (TM-REQ-004) and any
    // member with matching.run may get here, hence the service role.
    await transition(
      service,
      "job_postings",
      { id: jobId, column: "matching_status" },
      {
        from: ["progress"],
        to: "failed",
        patch: { matching_error: "Couldn't queue matching.", updated_at: new Date().toISOString() },
      },
    ).catch(() => undefined);

    await eventCaptureServerException({
      error: new Error(sendError.message),
      distinctId: user?.id ?? ownerId,
      properties: { flow: "trigger_job_posting_relevance_enqueue", jobId },
    });
    return { success: false, error: "Failed to start matching." };
  }

  return { success: true, message: "processing started" };
}
