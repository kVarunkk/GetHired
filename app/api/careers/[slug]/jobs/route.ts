import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { getCareersJobs, getCareersPage } from "@/helpers/careers/get-careers-page";
import { parseCareersFilters, searchCompanyJobs, toSearchView } from "@/helpers/careers/search-company-jobs";

/**
 * GET /api/careers/[slug]/jobs (CP-GUD-002): a published careers page's
 * active jobs, filtered like the page. Public; public columns only
 * (CP-SEC-001). Unpublished and unknown pages are 404s.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const result = await getCareersPage(slug);
    if (!result || !("page" in result)) {
      return NextResponse.json({ error: "Careers page not found." }, { status: 404 });
    }
    const jobs = await getCareersJobs(result.page);
    return NextResponse.json(toSearchView(searchCompanyJobs(jobs, parseCareersFilters(request.nextUrl.searchParams))));
  } catch (err) {
    reportError("[careers] jobs route failed", err);
    return NextResponse.json({ error: "Couldn't load the jobs." }, { status: 500 });
  }
}
