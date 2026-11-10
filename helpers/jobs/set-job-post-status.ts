import { revalidatePath, revalidateTag } from "next/cache";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { assertLimit } from "@/helpers/billing/entitlements";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import {
  EntitlementError,
  toEntitlementActionError,
  type EntitlementActionError,
} from "@/helpers/billing/errors";

export type SetJobPostStatusResult =
  | { ok: true }
  | { ok: false; error: string }
  | ({ ok: false } & EntitlementActionError);

/** Copy for the reasons `set_job_post_status` refuses with. */
const REFUSALS: Record<string, string> = {
  not_found: "Job posting not found.",
  forbidden: forbiddenMessage("jobs.publish"),
  active_job_posts: "Your plan's active job post limit is reached.",
};

/**
 * Activates or deactivates one of `company`'s job postings and its public
 * `all_jobs` row. Activating checks the plan's `active_job_posts` limit first
 * (BL-DEC-007); deactivating is always allowed. Both rows change in one
 * transaction (`set_job_post_status`, SM-REQ-007), which also re-checks the
 * permission and the limit. Setting the status a post already has still
 * calls it, so a retry repairs an `all_jobs` row that drifted. Shared by the
 * server action and the recruiter agent; `company` must come from the session.
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

  if (status === "active" && posting.status !== "active") {
    try {
      await assertLimit(company.id, "active_job_posts");
    } catch (err) {
      if (err instanceof EntitlementError) return { ok: false, ...toEntitlementActionError(err) };
      throw err;
    }
  }

  const { data, error } = await supabase.rpc("set_job_post_status", {
    p_job_post_id: posting.id,
    p_status: status,
  });
  if (error) return { ok: false, error: "Failed to update the job posting." };
  const result = data as { ok: boolean; reason?: string; job_id?: string | null } | null;
  if (!result?.ok) {
    return { ok: false, error: REFUSALS[result?.reason ?? ""] ?? "Failed to update the job posting." };
  }

  const jobId = result.job_id ?? posting.job_id;
  if (jobId) {
    revalidateTag(`job-${jobId}`);
    revalidateTag(careersCompanyTag(company.id));
    revalidatePath(`/jobs/${jobId}`);
  }

  return { ok: true };
}
