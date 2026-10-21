import { notFound, unstable_rethrow } from "next/navigation";
import Error from "@/components/Error";
import SectionHeader from "@/components/SectionHeader";
import HiringTeamPanel from "@/components/jobs/HiringTeamPanel";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { listJobHiringTeam } from "@/helpers/team/list-job-hiring-team";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hiring Team",
};

/**
 * RP-REQ-011: a job's hiring team, for jobs.assign on this job only. A section
 * of the job's layout.
 */
export default async function JobHiringTeamPage({ params }: { params: Promise<{ job_id: string }> }) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || !can(company, "jobs.assign", job_id)) notFound();

    // Scoped to the session company: another company's job is a 404.
    const { data: job, error } = await supabase
      .from("job_postings")
      .select("id, title")
      .eq("id", job_id)
      .eq("company_id", company.id)
      .maybeSingle();
    if (error) throw error;
    if (!job) notFound();

    // Null when the DB says the caller lacks jobs.assign on the job.
    const members = await listJobHiringTeam(supabase, job.id);
    if (!members) notFound();

    return (
      <div className="mb-20 flex w-full flex-col gap-6">
        <SectionHeader
          title="Hiring team"
          description="Members whose role is limited to assigned jobs can only see and work on this job if they're here. Owners and roles with access to all jobs see it anyway."
        />
        <HiringTeamPanel jobPostId={job.id} members={members} />
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
