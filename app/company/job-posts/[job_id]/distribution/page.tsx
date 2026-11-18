import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import { AskAgentAboutDistribution } from "@/components/agent/recruiter/AskAgentAboutDistribution";
import ChannelStatsTable from "@/components/distribution/ChannelStatsTable";
import DistributionTable from "@/components/distribution/DistributionTable";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { summarizeChannelStats } from "@/helpers/distribution/channel-stats";
import { loadJobDistribution } from "@/helpers/distribution/load-job-distribution";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Distribution",
};

/**
 * Where a job is published and why it isn't live somewhere (MP-REQ-001), for
 * distribution.view on the job. A section of the job's layout. With
 * `agent.use`, the agent box sits under the header (MPT-041).
 */
export default async function JobDistributionPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || !can(company, "distribution.view", job_id)) notFound();

    // Scoped to the session company: another company's job is a 404.
    const distribution = await loadJobDistribution(supabase, company.id, job_id);
    if (!distribution) notFound();
    const { job, channels, rows } = distribution;

    const applications = await supabase
      .from("applications")
      .select("source, source_detail, pipeline_stages(kind)")
      .eq("job_post_id", job.id)
      .is("merged_into_application_id", null);
    if (applications.error) throw applications.error;

    const stats = summarizeChannelStats(
      (applications.data ?? []).map((a) => ({
        source: a.source,
        source_detail: a.source_detail,
        stage_kind: a.pipeline_stages?.kind ?? null,
      })),
    );
    const names = Object.fromEntries(channels.map((c) => [c.key, c.name]));

    return (
      <div className="flex w-full flex-col gap-6">
        <SectionHeader
          title="Distribution"
          description="Where this job is published beyond GetHired, and why it isn't live somewhere."
        />
        {can(company, "agent.use") && (
          <AskAgentAboutDistribution
            job={{ id: job.id, title: job.title }}
            canManage={can(company, "distribution.manage", job.id)}
          />
        )}
        <DistributionTable
          rows={rows}
          jobId={job.id}
          canManage={can(company, "distribution.manage", job.id)}
          canManageAll={can(company, "distribution.manage", null)}
        />
        <h2 className="text-sm font-semibold">Applications by source</h2>
        <ChannelStatsTable stats={stats} names={names} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
