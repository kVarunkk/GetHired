import "server-only";
import { unstable_cache } from "next/cache";
import { allJobsSelectString } from "@/helpers/jobs/filterQueryBuilder";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isUuid } from "@/helpers/agent/auth";
import type { TJobIdPageData } from "@/utils/types/jobs.types";

/** One active job for its public page (/jobs/[id] and the careers job page), cached per job. */
export const getStaticJobDetails = async (
  jobId: string,
): Promise<TJobIdPageData | null> => {
  // A malformed id (e.g. a truncated link) makes Postgres reject the uuid
  // cast, so treat it as a missing job instead of a server error.
  if (!isUuid(jobId)) return null;
  return unstable_cache(
    async (id: string) => {
      const supabase = createServiceRoleClient();
      const selectString = `
        ${allJobsSelectString},
        normalized_locations,
        description,
        job_postings(*, company_info(*))
      `;

      const { data, error } = await supabase
        .from("all_jobs")
        .select(selectString)
        .eq("id", id)
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch job ${id}: ${error.message}`);
      }
      if (!data) return null;
      return {
        ...data,
        job_url: null,
        company_url: null,
      };
    },
    [`job-detail-${jobId}`],
    { revalidate: 86400, tags: [`job-${jobId}`] },
  )(jobId);
};


/** A company job that was open and no longer takes applications (JL-REQ-028). */
export type ClosedJobSummary = { id: string; jobName: string; companyName: string; companyId: string };

/** The states whose public page reads "no longer accepting applications". */
const NO_LONGER_OPEN_STATES = ["paused", "closed", "filled"] as const;

/**
 * The title and company of a paused, closed or filled company job, for the
 * page that says it's no longer accepting applications (JL-REQ-028). It reads
 * nothing else, so the page can't say which of the three it is or why
 * (JL-SEC-005). Drafts and pending jobs return null (a 404), and so do scraped
 * jobs. Cached under the job's tag, which `setJobPostState` revalidates.
 */
export const getClosedJobSummary = async (jobId: string): Promise<ClosedJobSummary | null> => {
  if (!isUuid(jobId)) return null;
  return unstable_cache(
    async (id: string) => {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase
        .from("all_jobs")
        .select("id, job_name, company_name, job_postings!inner(company_id, state)")
        .eq("id", id)
        .neq("status", "active")
        .in("job_postings.state", NO_LONGER_OPEN_STATES)
        .maybeSingle();
      if (error) throw new Error(`Failed to fetch job ${id}: ${error.message}`);
      const posting = data?.job_postings?.[0];
      if (!data || !posting) return null;
      return {
        id: data.id,
        jobName: data.job_name ?? "Job",
        companyName: data.company_name ?? "",
        companyId: posting.company_id,
      };
    },
    [`job-closed-${jobId}`],
    { revalidate: 86400, tags: [`job-${jobId}`] },
  )(jobId);
};
