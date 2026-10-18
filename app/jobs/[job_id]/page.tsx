import { notFound } from "next/navigation";
import { BackLink } from "@/components/PageHeader";
import JobClientHydrator from "@/components/JobClientHydrator";
import { Metadata } from "next";
import { buildJobPostingJsonLd } from "@/helpers/jobs/jobId/jsonld";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";

export const revalidate = 86400;
export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ job_id: string }>;
}): Promise<Metadata> {
  const { job_id } = await params;
  const data = await getStaticJobDetails(job_id);
  if (!data) notFound();

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
    openGraph: {
      type: "website",
      siteName: "GetHired",
      title,
      description,
      url: canonical,
    },
    twitter: {
      card: "summary",
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
    notFound();
  }

  const jsonLd = buildJobPostingJsonLd(job);

  return (
    <div className="flex flex-col gap-4 w-full p-4 mb-20">
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
      <BackLink href="/jobs" label="Back to jobs" />

      <JobClientHydrator job={job} />
    </div>
  );
}
