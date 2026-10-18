import { revalidateTag } from "next/cache";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";

export type DeleteJobPostResult = { ok: true; title: string } | { ok: false; error: string };

/**
 * Deletes one of `company`'s job postings and its public `all_jobs` row
 * (RS-F10). Its applications go with it (ON DELETE CASCADE). The `all_jobs`
 * row goes first: its FK on `job_postings.job_id` is `ON DELETE SET NULL`, so
 * if the second delete fails the posting is still there to retry, and no
 * public listing is left orphaned. Shared by the server action and the
 * recruiter agent; `company` must come from the session, and the caller
 * checks jobs.delete.
 */
export async function deleteJobPost(
  { supabase, company }: { supabase: SupabaseClient<Database>; company: MyCompany },
  { jobPostingId }: { jobPostingId: string },
): Promise<DeleteJobPostResult> {
  if (typeof jobPostingId !== "string" || !isUuid(jobPostingId)) {
    return { ok: false, error: "Job posting not found." };
  }

  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select("id, job_id, title")
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
  revalidateTag(careersCompanyTag(company.id));

  return { ok: true, title: posting.title };
}
