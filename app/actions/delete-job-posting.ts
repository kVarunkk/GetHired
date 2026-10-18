"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { deleteJobPost } from "@/helpers/jobs/delete-job-post";

/**
 * SERVER ACTION: deletes one of the session company's job postings. The
 * company always comes from the session; the work is in
 * `helpers/jobs/delete-job-post.ts`, shared with the agent.
 */
export async function deleteJobPostingAction({
  jobPostingId,
}: {
  jobPostingId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction({
    permission: "jobs.delete",
    jobId: typeof jobPostingId === "string" ? jobPostingId : null,
  });
  if (!auth.ok) return { ok: false, error: auth.error };

  const result = await deleteJobPost(auth, { jobPostingId });
  return result.ok ? { ok: true } : result;
}
