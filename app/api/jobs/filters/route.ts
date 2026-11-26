import { reportError } from "@/helpers/posthog/report-error";
import { createPublicClient } from "@/lib/supabase/public";
import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/** Also bounds the cache keys. */
const MAX_QUERY_LENGTH = 60;

/**
 * Up to 50 companies matching what was typed. The whole list is longer than the
 * 1,000 rows one API request can return. The same for everyone, so each search
 * is cached for an hour (the search is part of the cache key). A failed load
 * throws, which unstable_cache doesn't store.
 */
const searchCompanies = unstable_cache(
  async (query: string) => {
    const { data, error } = await createPublicClient().rpc("search_job_companies", {
      p_query: query,
    });
    if (error) throw error;
    return data ?? [];
  },
  ["jobs-filter-company-search"],
  { revalidate: 3600 },
);

/** The jobs page's company filter. */
export async function GET(request: NextRequest) {
  try {
    // The search ignores case, so each spelling shares one cache entry.
    const query = (request.nextUrl.searchParams.get("query") ?? "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH)
      .toLowerCase();
    const companies = await searchCompanies(query);
    // Browser only: a response can carry a refreshed session cookie.
    return NextResponse.json(
      { companies },
      { status: 200, headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    reportError("[jobs/filters] failed", error);
    return NextResponse.json(
      { error: "Failed to fetch filters" },
      { status: 500 },
    );
  }
}
