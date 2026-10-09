import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { unstable_cache } from "next/cache";
import { allJobsSelectString } from "@/helpers/jobs/filterQueryBuilder";
import JobClientHydrator from "@/components/JobClientHydrator";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Metadata } from "next";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { buildJobPostingJsonLd } from "@/helpers/jobs/jobId/jsonld";

export const revalidate = 86400;
export const dynamic = "force-static";

const getStaticJobDetails = (jobId: string): Promise<TJobIdPageData | null> =>
  unstable_cache(
    async (id: string) => {
      const supabase = createServiceRoleClient();
      const selectString = `
        ${allJobsSelectString},
        normalized_locations,
        description,
        job_postings(*, company_info(*))
      `;

      const { data, error } = await supabase
        .from("all_jobs")
        .select(selectString)
        .eq("id", id)
        .eq("status", "active")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch job ${id}: ${error.message}`);
      }
      if (!data) return null;
      return {
        ...data,
        job_url: null,
        company_url: null,
      };
    },
    [`job-detail-${jobId}`],
    { revalidate: 86400, tags: [`job-${jobId}`] },
  )(jobId);

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
      <Link
        href="/jobs"
        className="text-muted-foreground hover:text-primary transition-colors w-fit p-2 pl-0"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>

      <JobClientHydrator job={job} />
    </div>
  );
}
