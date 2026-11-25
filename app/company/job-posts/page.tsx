import { reportError } from "@/helpers/posthog/report-error";
import { createClient } from "@/lib/supabase/server";
import { getMyCareersLink } from "@/helpers/careers/my-careers-link";
import CareersLinkBar from "@/components/careers/CareersLinkBar";
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
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { archivedJobPostsPath, JOB_POSTS_PATH } from "@/helpers/jobs/paths";

export const metadata: Metadata = {
  title: "Job Posts",
  description:
    "Your company's job posts, their status and applicants.",
};

export default async function CompanyJobPostsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Archived posts (removed, but with applications) are listed only here.
  const archived = (await searchParams)?.archived === "1";
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
    // CP-REQ-014: the careers page link above the list.
    const careersLink = await getMyCareersLink(supabase, companyInfo.id).catch(() => null);

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
        .eq("company_id", companyInfo.id)
        .filter("archived_at", archived ? "not.is" : "is", null),
      companyInfo,
    ).order("created_at", { ascending: false });

    if (jobPostsError) {
      // console.error("Error fetching job postings:", jobPostsError);
      throw jobPostsError;
    }
    const posts = jobPosts ?? [];
    // JL-REQ-012: "Hired 1 / 3" per job.
    const hires = await countJobHires(supabase, posts.map((j) => j.id)).catch(() => new Map<string, number>());

    return (
      <div className="flex flex-col w-full gap-6 p-4 mb-20">
        <PageHeader
          title={archived ? "Archived job posts" : "Job posts"}
          description={
            archived
              ? "Job posts you removed that have applications. They're closed, and candidates keep their history. Open one to restore it."
              : "Your company's job posts, their status and applicants."
          }
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={archived ? JOB_POSTS_PATH : archivedJobPostsPath}>{archived ? "All job posts" : "Archived"}</Link>
              </Button>
              {!archived && <CreateJobPostButton disabled={!canCreateJobs} />}
            </>
          }
        />
        {!archived && can(companyInfo, "agent.use") && (
          <AskAgentAboutJobPosts
            canCreate={canCreateJobs}
            canViewApplicants={canAny(companyInfo, "applicants.view")}
            canPublish={canAny(companyInfo, "jobs.publish")}
            canMatch={canAny(companyInfo, "matching.run")}
          />
        )}
        {!archived && careersLink && <CareersLinkBar slug={careersLink.slug} published={careersLink.published} />}
        <JobPostingsTable
          data={posts}
          // An archived post is restored from its page, not published or approved from the list.
          publishable={archived ? [] : posts.filter((j) => jobControls(companyInfo, j.id).publish).map((j) => j.id)}
          approvable={archived ? [] : posts.filter((j) => jobControls(companyInfo, j.id).approve).map((j) => j.id)}
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
