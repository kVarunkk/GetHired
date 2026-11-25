import { revalidatePath, revalidateTag } from "next/cache";
import { careersCompanyTag } from "@/helpers/careers/cache-tags";
import { enqueueFeedRebuild } from "@/helpers/distribution/feed-queue";
import { enqueueIndexPing } from "@/helpers/distribution/index-queue";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";

/**
 * `deleted`: the post had no applications and is gone. `archived`: it has
 * applications, so it was closed and hidden instead, and candidates keep
 * their record of it.
 */
export type DeleteJobPostOutcome = "deleted" | "archived";

export type DeleteJobPostResult =
  | { ok: true; title: string; outcome: DeleteJobPostOutcome; applications: number }
  | { ok: false; error: string };

export type RestoreJobPostResult = { ok: true; title: string } | { ok: false; error: string };

const REFUSALS: Record<string, string> = {
  not_found: "Job posting not found.",
  forbidden: forbiddenMessage("jobs.delete"),
};

type RemoveRpcResult = {
  ok: boolean;
  reason?: string;
  outcome?: DeleteJobPostOutcome;
  job_id?: string | null;
  title?: string;
  applications?: number;
  was_active?: boolean;
};

function revalidateJob(companyId: string, jobId: string | null | undefined) {
  if (jobId) {
    revalidateTag(`job-${jobId}`);
    revalidatePath(`/jobs/${jobId}`);
  }
  revalidateTag(careersCompanyTag(companyId));
}

/**
 * Removes one of `company`'s job posts (RS-F10). A post with applications is
 * archived (closed and hidden from the company's lists, restorable) instead
 * of deleted, so candidates never lose their application history; one with
 * none is deleted with its public `all_jobs` row. `remove_job_post` decides
 * and acts in one transaction and re-checks jobs.delete. Shared by the
 * server action, the recruiter agent and MCP; `company` must come from the
 * session, and the caller checks jobs.delete.
 */
export async function deleteJobPost(
  { supabase, company }: { supabase: SupabaseClient<Database>; company: MyCompany },
  { jobPostingId }: { jobPostingId: string },
): Promise<DeleteJobPostResult> {
  if (typeof jobPostingId !== "string" || !isUuid(jobPostingId)) {
    return { ok: false, error: "Job posting not found." };
  }

  // Within the session company first: another company's id is "not found".
  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostingId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (loadError) return { ok: false, error: "Failed to load the job posting." };
  if (!posting) return { ok: false, error: "Job posting not found." };

  const { data, error } = await supabase.rpc("remove_job_post", { p_job_post_id: posting.id });
  if (error) return { ok: false, error: "Failed to delete the job posting." };
  const result = data as RemoveRpcResult | null;
  if (!result?.ok || !result.outcome) {
    return { ok: false, error: REFUSALS[result?.reason ?? ""] ?? "Failed to delete the job posting." };
  }

  revalidateJob(company.id, result.job_id);
  // MP-REQ-002/003: a live job that closed or went away leaves the search engines and feeds.
  if (result.was_active && result.job_id) {
    await enqueueIndexPing({ jobId: result.job_id, reason: "closed" });
    await enqueueFeedRebuild();
  }

  return { ok: true, title: result.title ?? "", outcome: result.outcome, applications: result.applications ?? 0 };
}

/** Brings an archived job post back to the company's lists, still closed. jobs.delete, like the archive. */
export async function restoreJobPost(
  { supabase, company }: { supabase: SupabaseClient<Database>; company: MyCompany },
  { jobPostingId }: { jobPostingId: string },
): Promise<RestoreJobPostResult> {
  if (typeof jobPostingId !== "string" || !isUuid(jobPostingId)) {
    return { ok: false, error: "Job posting not found." };
  }
  const { data: posting, error: loadError } = await supabase
    .from("job_postings")
    .select("id")
    .eq("id", jobPostingId)
    .eq("company_id", company.id)
    .maybeSingle();
  if (loadError) return { ok: false, error: "Failed to load the job posting." };
  if (!posting) return { ok: false, error: "Job posting not found." };

  const { data, error } = await supabase.rpc("restore_job_post", { p_job_post_id: posting.id });
  if (error) return { ok: false, error: "Failed to restore the job posting." };
  const result = data as { ok: boolean; reason?: string; job_id?: string | null; title?: string } | null;
  if (!result?.ok) {
    return { ok: false, error: REFUSALS[result?.reason ?? ""] ?? "Failed to restore the job posting." };
  }
  revalidateJob(company.id, result.job_id);
  return { ok: true, title: result.title ?? "" };
}
