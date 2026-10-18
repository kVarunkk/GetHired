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

