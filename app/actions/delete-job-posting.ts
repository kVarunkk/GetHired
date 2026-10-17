"use server";

import { revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";

/**
 * SERVER ACTION: deletes one of the session company's job postings and its
 * public `all_jobs` row (RS-F10). The `all_jobs` row goes first: its FK on
 * `job_postings.job_id` is `ON DELETE SET NULL`, so if the second delete fails
 * the posting is still there to retry, and no public listing is left orphaned.
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
  const { supabase, company } = auth;

  if (typeof jobPostingId !== "string" || !isUuid(jobPostingId)) {
    return { ok: false, error: "Job posting not found." };
  }

  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select("id, job_id")
    .eq("id", jobPostingId)
    .eq("company_id", company.id)
    .maybeSingle();

  if (loadError) return { ok: false, error: "Failed to load the job posting." };
  if (!posting) return { ok: false, error: "Job posting not found." };

  // Ownership is settled above; the service role is only used from here on.
  const service = createServiceRoleClient();

  if (posting.job_id) {
    const { error } = await service.from("all_jobs").delete().eq("id", posting.job_id);
    if (error) return { ok: false, error: "Failed to remove the public job listing." };
  }

  const { error: deleteError } = await service
    .from("job_postings")
    .delete()
    .eq("id", posting.id)
    .eq("company_id", company.id);
  if (deleteError) return { ok: false, error: "Failed to delete the job posting." };

  if (posting.job_id) revalidateTag(`job-${posting.job_id}`);

  return { ok: true };
}
