import type { Metadata } from "next";
import { notFound, permanentRedirect, unstable_rethrow } from "next/navigation";
import CareersHeader from "@/components/careers/CareersHeader";
import CareersJobs from "@/components/careers/CareersJobs";
import CareersSections from "@/components/careers/CareersSections";
import CareersShell from "@/components/careers/CareersShell";
import ErrorComponent from "@/components/Error";
import { getCareersJobs, getCareersPage } from "@/helpers/careers/get-careers-page";
import { parseCareersFilters, searchCompanyJobs, toSearchView } from "@/helpers/careers/search-company-jobs";
import { careersMetadata, careersOrganizationJsonLd } from "@/helpers/careers/seo";
import { careersPath } from "@/helpers/careers/slug";
import { readRef, toSearchParams } from "@/helpers/careers/params";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await getCareersPage(slug).catch(() => null);
  if (!result || !("page" in result)) return { title: "Careers" };
  const jobs = await getCareersJobs(result.page).catch(() => []);
  return careersMetadata(result.page, { openRoles: jobs.length });
}

/**
 * A company's public careers page (CP-REQ-003..010): the header, its
 * sections and its open roles. Public and cached (CP-CON-001); unpublished
 * pages are 404s, old slugs redirect (CP-REQ-002).
 */
export default async function CareersPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}) {
  const { slug } = await params;
  const query = toSearchParams(await searchParams);
  try {
    const result = await getCareersPage(slug);
    if (!result) notFound();
    if ("redirect" in result) {
      const qs = query.toString();
      permanentRedirect(`${careersPath(result.redirect)}${qs ? `?${qs}` : ""}`);
    }
    const { page } = result;
    if (page.slug !== slug) permanentRedirect(careersPath(page.slug));

    const jobs = await getCareersJobs(page);
    const filters = parseCareersFilters(query);
    const view = toSearchView(searchCompanyJobs(jobs, filters));

    return (
      <CareersShell page={page}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(careersOrganizationJsonLd(page)).replace(/</g, "\\u003c") }}
        />
        <CareersHeader page={page} />
        <CareersSections sections={page.sections} about={page.description} />
        <CareersJobs
          slug={page.slug}
          initial={view}
          filters={filters}
          jobBasePath={`${careersPath(page.slug)}/jobs`}
          refTag={readRef(query)}
        />
      </CareersShell>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
