"use server";

import { z } from "zod";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { addCandidatesToJob, type AddToJobResult } from "@/helpers/candidates/add-to-job";

/** As `add_candidates_to_job`. */
const MAX_ADD_TO_JOB = 200;

const inputSchema = z
  .object({
    jobPostId: z.string().uuid(),
    candidateIds: z.array(z.string().uuid()).min(1).max(MAX_ADD_TO_JOB),
    stageId: z.string().uuid().optional(),
  })
  .strict();

export type AddCandidatesToJobResult = AddToJobResult;

/**
 * SERVER ACTION (BI-REQ-005): adds company candidates to a job as imported
 * applications, in its first Applied stage unless `stageId` says otherwise.
 * Candidates already in the job, or with no email, are counted, not added.
 * Nobody is emailed.
 */
export async function addCandidatesToJobAction(
  input: z.input<typeof inputSchema>,
): Promise<AddCandidatesToJobResult> {
  const parsed = inputSchema.safeParse(input);
  // An unparseable job id needs scope `all`, so it's still refused for scoped members.
  const auth = await requireCompanyForAction({
    permission: "applicants.import",
    jobId: parsed.success ? parsed.data.jobPostId : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!parsed.success) return { ok: false, error: `Choose a job and 1 to ${MAX_ADD_TO_JOB} candidates.` };

  return addCandidatesToJob(auth.supabase, parsed.data);
}
