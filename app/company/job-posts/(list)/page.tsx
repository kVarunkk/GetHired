import { reportError } from "@/helpers/posthog/report-error";
import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can, canAny } from "@/helpers/companies/permissions";
import { jobControls, scopeToJobs } from "@/helpers/companies/job-scope";
import ErrorComponent from "@/components/Error";
import { CreateJobPostButton } from "@/components/jobs/JobPostButtons";
import JobPostingsTable from "@/components/JobPostingsTable";
import { countJobHires } from "@/helpers/jobs/job-hires";
import PageHeader from "@/components/PageHeader";
import { AskAgentAboutJobPosts } from "@/components/agent/recruiter/AskAgentOnMainPages";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Job Posts",
  description:
    "Your company's job posts, their status and applicants.",
};

export default async function CompanyJobPostsPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    // Fetch company info to get the company_id
    const companyInfo = await getMyCompany(supabase, user);

    if (!companyInfo) {
      throw new Error("Company profile not found");
    }
    const canCreateJobs = can(companyInfo, "jobs.create");

    // Fetch all job postings for the company, along with a count of applications
    // RP-REQ-010: only the jobs the viewer's role covers.
    const { data: jobPosts, error: jobPostsError } = await scopeToJobs(
      supabase
        .from("job_postings")
        .select(
          `
          *,
          applications(count),
          company_info(name, website, job_approval_required)
        `,
        )
        .eq("company_id", companyInfo.id),
      companyInfo,
    ).order("created_at", { ascending: false });

    if (jobPostsError) {
      // console.error("Error fetching job postings:", jobPostsError);
      throw jobPostsError;
    }
    const posts = jobPosts ?? [];
    // An archived post is restored from its page, not published or approved from the list.
    const unarchived = posts.filter((j) => !j.archived_at);
    // JL-REQ-012: "Hired 1 / 3" per job.
    const hires = await countJobHires(supabase, posts.map((j) => j.id)).catch(() => new Map<string, number>());

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title="Job posts"
          description="Your company's job posts, their status and applicants."
          actions={<CreateJobPostButton disabled={!canCreateJobs} />}
        />
        {can(companyInfo, "agent.use") && (
          <AskAgentAboutJobPosts
            canCreate={canCreateJobs}
            canViewApplicants={canAny(companyInfo, "applicants.view")}
            canPublish={canAny(companyInfo, "jobs.publish")}
            canMatch={canAny(companyInfo, "matching.run")}
          />
        )}
        <JobPostingsTable
          data={posts}
          publishable={unarchived.filter((j) => jobControls(companyInfo, j.id).publish).map((j) => j.id)}
          approvable={unarchived.filter((j) => jobControls(companyInfo, j.id).approve).map((j) => j.id)}
          approvalRequired={!!posts[0]?.company_info?.job_approval_required}
          hires={Object.fromEntries(hires)}
        />
      </div>
    );
  } catch (error) {
    reportError("[company/job-posts] page failed", error);
    return <ErrorComponent />;
  }
}
