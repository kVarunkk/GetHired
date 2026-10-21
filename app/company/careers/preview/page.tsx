import { notFound, unstable_rethrow } from "next/navigation";
import CareersHeader from "@/components/careers/CareersHeader";
import CareersJobs from "@/components/careers/CareersJobs";
import CareersSections from "@/components/careers/CareersSections";
import CareersShell from "@/components/careers/CareersShell";
import Error from "@/components/Error";
import { getMyCareersPreview } from "@/helpers/careers/get-careers-page";
import { toSearchParams } from "@/helpers/careers/params";
import { parseCareersFilters, searchCompanyJobs, toSearchView } from "@/helpers/careers/search-company-jobs";
import { careersPath } from "@/helpers/careers/slug";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Careers Page Preview",
};

export const dynamic = "force-dynamic";

/**
 * CP-REQ-008 / CP-CON-001: the session company's careers page as visitors
 * will see it, published or not. Members only (the middleware keeps
 * /company/* for company accounts), never cached.
 */
export default async function CareersPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    const supabase = await createClient();
    const preview = await getMyCareersPreview(supabase);
    if (!preview) notFound();
    const { page } = preview;
    const filters = parseCareersFilters(toSearchParams(await searchParams));
    const view = toSearchView(searchCompanyJobs(preview.jobs, filters));

    return (
      <CareersShell
        page={page}
        banner={
          !page.published && (
            <div role="status" className="border-b bg-muted/40 px-4 py-2 text-center text-sm">
              Preview, not published. Only your team can see this page.
            </div>
          )
        }
      >
        <CareersHeader page={page} />
        <CareersSections sections={page.sections} about={page.description} />
        <CareersJobs
          slug={page.slug}
          initial={view}
          filters={filters}
          jobBasePath={`${careersPath(page.slug)}/jobs`}
          preview
        />
      </CareersShell>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
