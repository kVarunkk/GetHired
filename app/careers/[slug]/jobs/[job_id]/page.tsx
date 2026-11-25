import { shareImages, twitterShareImages } from "@/helpers/seo/share-image";
import type { Metadata } from "next";
import { notFound, permanentRedirect, unstable_rethrow } from "next/navigation";
import CareersShell from "@/components/careers/CareersShell";
import { BackLink } from "@/components/PageHeader";
import ErrorComponent from "@/components/Error";
import JobClientHydrator from "@/components/JobClientHydrator";
import JobNoLongerOpen from "@/components/jobs/JobNoLongerOpen";
import { ApplicationSourceProvider } from "@/components/jobs/ApplicationSourceContext";
import { getCareersPage, type CareersPage } from "@/helpers/careers/get-careers-page";
import { readRef, toSearchParams } from "@/helpers/careers/params";
import { careersPath } from "@/helpers/careers/slug";
import { careersApplyPath } from "@/helpers/jobs/apply-path";
import {
  getClosedJobSummary,
  getStaticJobDetails,
  type ClosedJobSummary,
} from "@/helpers/jobs/jobId/get-job-details";
import { buildJobPostingJsonLd, isLinkOnlyJob } from "@/helpers/jobs/jobId/jsonld";

const SITE_URL = "https://gethired.devhub.co.in";

type Params = Promise<{ slug: string; job_id: string }>;

type Loaded =
  | { kind: "redirect"; slug: string }
  | { kind: "job"; page: CareersPage; job: NonNullable<Awaited<ReturnType<typeof getStaticJobDetails>>> }
  | { kind: "closed"; page: CareersPage; job: ClosedJobSummary };

/**
 * The job, only when it belongs to the page's company (CP-DEC-001). A job
 * that was open and isn't any more is `closed` (JL-REQ-028).
 */
async function load(slug: string, jobId: string): Promise<Loaded | null> {
  const result = await getCareersPage(slug);
  if (!result) return null;
  if ("redirect" in result) return { kind: "redirect", slug: result.redirect };
  const job = await getStaticJobDetails(jobId);
  if (!job) {
    const closed = await getClosedJobSummary(jobId);
    if (!closed || closed.companyId !== result.page.id) return null;
    return { kind: "closed", page: result.page, job: closed };
  }
  const posting = job.job_postings?.[0];
  if (!posting || posting.company_id !== result.page.id) return null;
  return { kind: "job", page: result.page, job };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, job_id } = await params;
  const loaded = await load(slug, job_id).catch(() => null);
  if (!loaded || loaded.kind === "redirect") return { title: "Careers" };
  if (loaded.kind === "closed") {
    return { title: `${loaded.job.jobName} at ${loaded.page.name}`, robots: { index: false, follow: true } };
  }
  const title = `${loaded.job.job_name} at ${loaded.page.name}`;
  // CP-REQ-011: the job board's page stays canonical, so there's no duplicate content.
  const canonical = `${SITE_URL}/jobs/${job_id}`;
  return {
    title,
    ...(isLinkOnlyJob(loaded.job) ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical },
    openGraph: { type: "website", siteName: "GetHired", title, url: canonical, ...shareImages },
    twitter: { ...twitterShareImages, title },
  };
}

/**
 * A job inside the careers page (CP-REQ-007, CP-DEC-001): the company's frame
 * around the usual job details, and Apply records `careers_page` and the
 * `?ref=` (CP-REQ-013).
 */
export default async function CareersJobPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, job_id } = await params;
  const query = toSearchParams(await searchParams);
  try {
    const loaded = await load(slug, job_id);
    if (!loaded) notFound();
    if (loaded.kind === "redirect") permanentRedirect(`${careersPath(loaded.slug)}/jobs/${job_id}`);
    const ref = readRef(query);
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const backHref = `${careersPath(loaded.page.slug)}${refQuery}`;

    if (loaded.kind === "closed") {
      return (
        <CareersShell page={loaded.page} refQuery={refQuery}>
          <div className="flex flex-col gap-2">
            <BackLink href={backHref} label={`Back to ${loaded.page.name} careers`} />
            <JobNoLongerOpen
              jobId={loaded.job.id}
              jobName={loaded.job.jobName}
              companyName={loaded.page.name}
              browseHref={backHref}
              browseLabel={`See open jobs at ${loaded.page.name}`}
            />
          </div>
        </CareersShell>
      );
    }
    const { page, job } = loaded;

    const jobPath = `${careersPath(page.slug)}/jobs/${job_id}`;
    const returnTo = `${jobPath}${refQuery}`;

    const jsonLd = buildJobPostingJsonLd(job);

    return (
      <CareersShell page={page} refQuery={refQuery}>
        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
          />
        )}
        {/* The same back link and gap to the title as the apply page's PageHeader. */}
        <div className="flex flex-col gap-2">
          <BackLink href={backHref} label={`Back to ${page.name} careers`} />
          <div className="flex flex-col gap-10 [&>div:first-child]:mt-0">
            <ApplicationSourceProvider value={{ source: "careers_page", ref, returnTo, applyHref: careersApplyPath(page.slug, job_id, ref) }}>
              <JobClientHydrator job={job} />
            </ApplicationSourceProvider>
          </div>
        </div>
      </CareersShell>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
