"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { queueJobPostingRelevance, type QueueJobRelevanceResult } from "@/helpers/profiles/queue-job-relevance";

/**
 * SERVER ACTION: queues a relevant-profiles run for one of the session
 * company's job postings (RS-F08), the same way triggerRelevanceUpdate queues
 * an applicant's relevant jobs. The work is `queueJobPostingRelevance`, which
 * the agent and MCP call with the session they already resolved.
 */
export async function triggerJobPostingRelevanceUpdate(jobId: string): Promise<QueueJobRelevanceResult> {
  const auth = await requireCompanyForAction({
    permission: "matching.run",
    jobId: typeof jobId === "string" ? jobId : null,
  });
  if (!auth.ok) return { success: false, error: auth.error };
  return queueJobPostingRelevance(auth, jobId);
}
