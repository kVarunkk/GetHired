import { reportError } from "@/helpers/posthog/report-error";
import { createPublicClient } from "@/lib/supabase/public";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Every company with a job, for the jobs page's company filter. The same for
 * everyone, and get_unique_companies reads every job (it hit the statement
 * timeout on each page load), so it's cached for an hour. A failed load
 * throws, which unstable_cache doesn't store.
 */
const getCompanies = unstable_cache(
  async () => {
    const { data, error } = await createPublicClient().rpc("get_unique_companies");
    if (error) throw error;
    return data ?? [];
  },
  ["jobs-filter-companies"],
  { revalidate: 3600 },
);

export async function GET() {
  try {
    const companies = await getCompanies();
    return NextResponse.json({ companies }, { status: 200 });
  } catch (error) {
    reportError("[jobs/filters] failed", error);
    return NextResponse.json(
      { error: "Failed to fetch filters" },
      { status: 500 },
    );
  }
}
