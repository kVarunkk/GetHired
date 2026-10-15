"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { setJobPostStatus, type SetJobPostStatusResult } from "@/helpers/jobs/set-job-post-status";

/**
 * SERVER ACTION: activates or deactivates one of the session company's job
 * postings. The company always comes from the session; the work is in
 * `helpers/jobs/set-job-post-status.ts`, shared with the agent.
 */
export async function setJobPostingStatusAction(params: {
  jobPostingId: string;
  status: "active" | "inactive";
}): Promise<SetJobPostStatusResult> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  return setJobPostStatus(auth, params);
}
