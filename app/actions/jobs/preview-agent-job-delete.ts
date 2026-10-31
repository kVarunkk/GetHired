"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { previewAgentJobDelete, type PreviewAgentJobDeleteResult } from "@/helpers/jobs/preview-agent-job-delete";

const input = z.object({ jobPostId: z.string().refine(isUuid) });

/**
 * SERVER ACTION: the agent's approval card for a proposed `deleteJobPost`
 * (RA-REQ-005). The work is `previewAgentJobDelete`, which MCP shares. The
 * company comes from the session, and the check is the delete's own
 * (jobs.delete on that job).
 */
export async function previewAgentJobDeleteAction(raw: unknown): Promise<PreviewAgentJobDeleteResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Job posting not found." };

  const auth = await requireCompanyForAction({ permission: "jobs.delete", jobId: parsed.data.jobPostId });
  if (!auth.ok) return { ok: false, error: auth.error };
  return previewAgentJobDelete(auth, raw);
}
