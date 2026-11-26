import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { JOBS_FEED_TAG } from "@/helpers/jobs/feed-tag";
import {
  parseJobSearchParams,
  searchJobs,
  SearchJobsTrace,
} from "@/helpers/jobs/search-jobs";

/**
 * A page of the signed-out jobs feed, cached for an hour per set of filters.
 * `query` is the cleaned, serialized filters (`serializeFiltersToURL`). It runs
 * with the public client and no user, so every visitor shares the entry: never
 * use it for a relevance search. A failed search throws, so it isn't cached.
 */
export function loadPublicJobsFeed(query: string, trace?: SearchJobsTrace) {
  return unstable_cache(
    async () => {
      const result = await searchJobs(
        createPublicClient(),
        null,
        parseJobSearchParams(new URLSearchParams(query)),
        trace,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    [JOBS_FEED_TAG, query],
    { tags: [JOBS_FEED_TAG], revalidate: 3600 },
  )();
}
