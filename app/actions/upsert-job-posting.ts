"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import type { JobPostingInput } from "@/helpers/jobs/job-posting-schema";
import { upsertJobPosting, type UpsertJobPostingResult } from "@/helpers/jobs/upsert-job-posting";

type UpsertResult =
  | { success: true; isUpdate: boolean }
  | Exclude<UpsertJobPostingResult, { success: true }>;

/**
 * SERVER ACTION: creates or edits one of the session company's job postings
 * (RS-SEC-001, RS-SEC-002). The company always comes from the session; the
 * work is in `helpers/jobs/upsert-job-posting.ts`, shared with the agent.
 */
export async function upsertJobPostingAction(params: {
  values: JobPostingInput;
  existingPostingId?: string;
}): Promise<UpsertResult> {
  // RP-REQ-002: a new post needs jobs.create, an edit jobs.edit on that job.
  const auth = await requireCompanyForAction(
    params.existingPostingId
      ? { permission: "jobs.edit", jobId: params.existingPostingId }
      : { permission: "jobs.create" },
  );
  if (!auth.ok) return { success: false, error: auth.error };

  const result = await upsertJobPosting(auth, params);
  return result.success ? { success: true, isUpdate: result.isUpdate } : result;
}
