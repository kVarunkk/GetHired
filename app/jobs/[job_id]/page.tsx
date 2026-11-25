import { shareImages, twitterShareImages } from "@/helpers/seo/share-image";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/PageHeader";
import JobClientHydrator from "@/components/JobClientHydrator";
import JobSourceProvider from "@/components/jobs/JobSourceProvider";
import JobAlertClickTracker from "@/components/job-alerts/JobAlertClickTracker";
import ClosedJobView from "@/components/jobs/ClosedJobView";
import { Metadata } from "next";
import { buildJobPostingJsonLd } from "@/helpers/jobs/jobId/jsonld";
import { getJobPageDetails, isJobClosed } from "@/helpers/jobs/jobId/get-job-details";

export const revalidate = 86400;
export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ job_id: string }>;
}): Promise<Metadata> {
  const { job_id } = await params;
  const data = await getJobPageDetails(job_id);
  if (!data) notFound();
  const closed = isJobClosed(data);

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
    alternates: {
      canonical,
    },
    // A closed job keeps its page for the people who applied, but leaves search.
    ...(closed ? { robots: { index: false, follow: true } } : {}),
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
  const job = await getJobPageDetails(job_id);

  if (!job) {
    notFound();
  }

  if (isJobClosed(job)) {
    return (
      <div className="flex flex-col gap-4 w-full p-4 mb-20">
        <BackLink href="/jobs" label="Back to jobs" />
        <ClosedJobView job={job} browseHref="/jobs" />
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
