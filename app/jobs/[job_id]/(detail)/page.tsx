import { shareImages, twitterShareImages } from "@/helpers/seo/share-image";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/PageHeader";
import JobClientHydrator from "@/components/JobClientHydrator";
import JobSourceProvider from "@/components/jobs/JobSourceProvider";
import JobAlertClickTracker from "@/components/job-alerts/JobAlertClickTracker";
import { Metadata } from "next";
import { buildJobPostingJsonLd, isLinkOnlyJob } from "@/helpers/jobs/jobId/jsonld";
import { getClosedJobSummary, getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import JobNoLongerOpen from "@/components/jobs/JobNoLongerOpen";

export const revalidate = 86400;
export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ job_id: string }>;
}): Promise<Metadata> {
  const { job_id } = await params;
  const data = await getStaticJobDetails(job_id);
  if (!data) {
    // JL-REQ-028: a job that was open keeps a page, out of search results.
    const closed = await getClosedJobSummary(job_id);
    if (!closed) notFound();
    return {
      title: `${closed.jobName} at ${closed.companyName}`,
      robots: { index: false, follow: true },
    };
  }

  const title = `${data.job_name} at ${data.company_name}`;
  const descriptionSource =
    data.description ||
    data.ai_summary ||
    `Apply for ${data.job_name} at ${data.company_name}.`;
  const description = descriptionSource
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 157)
    .trimEnd();
  const canonical = `https://gethired.devhub.co.in/jobs/${job_id}`;

  return {
    title,
    description,
    // JL-REQ-025: a link-only job is reachable by its link, not by search.
    ...(isLinkOnlyJob(data) ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical,
    },
    openGraph: {
      type: "website",
      siteName: "GetHired",
      title,
      description,
      url: canonical,
      ...shareImages,
    },
    twitter: {
      ...twitterShareImages,
      title,
      description,
    },
  };
}

export default async function JobPage({
  params,
}: {
  params: Promise<{ job_id: string }>;
}) {
  const { job_id } = await params;
  const job = await getStaticJobDetails(job_id);

  if (!job) {
    // JL-REQ-028: paused, closed and filled read the same, with no JSON-LD.
    const closed = await getClosedJobSummary(job_id);
    if (!closed) notFound();
    return (
      <div className="flex flex-col gap-4 w-full p-4 mb-20">
        <BackLink href="/jobs" label="Back to jobs" />
        <JobNoLongerOpen
          jobId={closed.id}
          jobName={closed.jobName}
          companyName={closed.companyName}
          browseHref="/jobs"
          browseLabel="Browse open jobs"
        />
      </div>
    );
  }

  const jsonLd = buildJobPostingJsonLd(job);

  return (
    <div className="flex flex-col gap-4 w-full p-4 mb-20">
      {jsonLd ? (
        <script
          type="application/ld+json"
          // Escape "<" so job text like "</script>" can't end the tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      ) : null}
      <BackLink href="/jobs" label="Back to jobs" />

      <JobAlertClickTracker page="job" />
      <JobSourceProvider jobId={job.id}>
        <JobClientHydrator job={job} />
      </JobSourceProvider>
    </div>
  );
}
