import { revalidatePath, revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { assertLimit } from "@/helpers/billing/entitlements";
import {
  EntitlementError,
  toEntitlementActionError,
  type EntitlementActionError,
} from "@/helpers/billing/errors";

export type SetJobPostStatusResult =
  | { ok: true }
  | { ok: false; error: string }
  | ({ ok: false } & EntitlementActionError);

/**
 * Activates or deactivates one of `company`'s job postings and its public
 * `all_jobs` row. Activating checks the plan's `active_job_posts` limit first
 * (BL-DEC-007); deactivating is always allowed. The job_postings trigger
 * enforce_active_job_post_limit is the DB backstop. Shared by the server
 * action and the recruiter agent; `company` must come from the session.
 */
export async function setJobPostStatus(
  { supabase, company }: { supabase: SupabaseClient<Database>; company: MyCompany },
  {
    jobPostingId,
    status,
  }: {
    jobPostingId: string;
    status: "active" | "inactive";
  },
): Promise<SetJobPostStatusResult> {
  if (typeof jobPostingId !== "string" || !isUuid(jobPostingId)) {
    return { ok: false, error: "Job posting not found." };
  }
  if (status !== "active" && status !== "inactive") {
    return { ok: false, error: "Invalid status." };
  }

  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select("id, job_id, status")
    .eq("id", jobPostingId)
    .eq("company_id", company.id)
    .maybeSingle();

  if (loadError) return { ok: false, error: "Failed to load the job posting." };
  if (!posting) return { ok: false, error: "Job posting not found." };
  if (posting.status === status) return { ok: true };

  if (status === "active") {
    try {
      await assertLimit(company.id, "active_job_posts");
    } catch (err) {
      if (err instanceof EntitlementError) return { ok: false, ...toEntitlementActionError(err) };
      throw err;
    }
  }

  // Ownership and the limit are settled above; the service role is used from here on.
  const service = createServiceRoleClient();

  const { error: updateError } = await service
    .from("job_postings")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", posting.id)
    .eq("company_id", company.id);
  if (updateError) return { ok: false, error: "Failed to update the job posting." };

  if (posting.job_id) {
    const { error } = await service.from("all_jobs").update({ status }).eq("id", posting.job_id);
    if (error) return { ok: false, error: "Failed to update the public job listing." };
    revalidateTag(`job-${posting.job_id}`);
    revalidatePath(`/jobs/${posting.job_id}`);
  }

  return { ok: true };
}
