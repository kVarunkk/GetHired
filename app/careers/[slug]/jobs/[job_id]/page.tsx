import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, unstable_rethrow } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import CareersShell from "@/components/careers/CareersShell";
import ErrorComponent from "@/components/Error";
import JobClientHydrator from "@/components/JobClientHydrator";
import { ApplicationSourceProvider } from "@/components/jobs/ApplicationSourceContext";
import { getCareersPage, type CareersPage } from "@/helpers/careers/get-careers-page";
import { readRef, toSearchParams } from "@/helpers/careers/params";
import { careersPath } from "@/helpers/careers/slug";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import { buildJobPostingJsonLd } from "@/helpers/jobs/jobId/jsonld";

const SITE_URL = "https://gethired.devhub.co.in";

type Params = Promise<{ slug: string; job_id: string }>;

type Loaded =
  | { kind: "redirect"; slug: string }
  | { kind: "job"; page: CareersPage; job: NonNullable<Awaited<ReturnType<typeof getStaticJobDetails>>> };

/** The job, only when it belongs to the page's company (CP-DEC-001). */
async function load(slug: string, jobId: string): Promise<Loaded | null> {
  const result = await getCareersPage(slug);
  if (!result) return null;
  if ("redirect" in result) return { kind: "redirect", slug: result.redirect };
  const job = await getStaticJobDetails(jobId);
  const posting = job?.job_postings?.[0];
  if (!job || !posting || posting.company_id !== result.page.id) return null;
  return { kind: "job", page: result.page, job };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, job_id } = await params;
  const loaded = await load(slug, job_id).catch(() => null);
  if (!loaded || loaded.kind === "redirect") return { title: "Careers" };
  const title = `${loaded.job.job_name} at ${loaded.page.name}`;
  // CP-REQ-011: the job board's page stays canonical, so there's no duplicate content.
  const canonical = `${SITE_URL}/jobs/${job_id}`;
  return {
    title,
    alternates: { canonical },
    openGraph: { type: "website", siteName: "GetHired", title, url: canonical },
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
    const { page, job } = loaded;

    const ref = readRef(query);
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const jobPath = `${careersPath(page.slug)}/jobs/${job_id}`;
    const returnTo = `${jobPath}?apply=true${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`;
    const jsonLd = buildJobPostingJsonLd(job);

    return (
      <CareersShell page={page}>
        {jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
          />
        )}
        <Link
          href={`${careersPath(page.slug)}${refQuery}`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {page.name} careers
        </Link>
        <ApplicationSourceProvider value={{ source: "careers_page", ref, returnTo }}>
          <JobClientHydrator job={job} />
        </ApplicationSourceProvider>
      </CareersShell>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <ErrorComponent />;
  }
}
