import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { unstable_cache } from "next/cache";
import { allJobsSelectString } from "@/helpers/jobs/filterQueryBuilder";
import JobClientHydrator from "@/components/JobClientHydrator";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Metadata } from "next";

const getStaticJobDetails = (jobId: string) =>
  unstable_cache(
    async (id: string) => {
      const supabase = createServiceRoleClient();
      const selectString = `
        ${allJobsSelectString},
        description,
        job_postings(*, company_info(*))
      `;

      const { data, error } = await supabase
        .from("all_jobs")
        .select(selectString)
        .eq("id", id)
        .single();

      if (error || !data) return null;
      return data;
    },
    [`job-detail-${jobId}`],
    { revalidate: 60 * 60 * 24 * 7, tags: [`job-${jobId}`] },
  )(jobId);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ job_id: string }>;
}): Promise<Metadata> {
  try {
    const { job_id } = await params;
    const data = await getStaticJobDetails(job_id);
    if (!data) throw new Error("Job not found");

    return {
      title: `${data?.job_name} at ${data?.company_name}`,
      description: `Apply for the ${data?.job_name} position at ${data?.company_name}.`,
      keywords: [
        data?.job_name || "",
        data?.company_name || "",
        data?.locations.join(", "),
        "job",
        "career",
        "employment",
      ],
    };
  } catch {
    return {
      title: "Job Details",
      description: "Detailed view of the job posting.",
    };
  }
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

  return (
    <div className="flex flex-col gap-4 w-full p-4 mb-20">
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
