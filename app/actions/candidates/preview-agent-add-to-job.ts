"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { previewAgentAddToJob, type AddToJobPreview } from "@/helpers/candidates/preview-agent-add-to-job";

const jobOf = z.object({ jobPostId: z.string().uuid() });

/**
 * SERVER ACTION (CPT-058): the agent's approval card for a proposed
 * `addCandidatesToJob` call. The work is `previewAgentAddToJob`, which MCP
 * shares. The company comes from the session.
 */
export async function previewAgentAddToJobAction(input: unknown): Promise<AddToJobPreview> {
  const job = jobOf.safeParse(input);
  const auth = await requireCompanyForAction({
    permission: "applicants.import",
    jobId: job.success ? job.data.jobPostId : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentAddToJob(auth, input);
}
