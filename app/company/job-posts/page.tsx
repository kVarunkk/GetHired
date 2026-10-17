import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { jobControls, scopeToJobs } from "@/helpers/companies/job-scope";
import ErrorComponent from "@/components/Error";
import CreateJobPostingDialog from "@/components/CreateJobPostingDialog";
import JobPostingsTable from "@/components/JobPostingsTable";
import BackButton from "@/components/BackButton";

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
          company_info(name, website)
        `,
        )
        .eq("company_id", companyInfo.id),
      companyInfo,
    ).order("created_at", { ascending: false });

    if (jobPostsError) {
      // console.error("Error fetching job postings:", jobPostsError);
      throw jobPostsError;
    }

    return (
      <div className="flex flex-col w-full gap-8  p-4 mb-20">
        <div>
          <BackButton />
        </div>
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <h1 className="text-3xl font-medium">Your Job Postings</h1>
          <CreateJobPostingDialog
            companyId={companyInfo.id}
            disabled={!canCreateJobs}
          />
        </div>
        <JobPostingsTable
          data={jobPosts || []}
          publishable={(jobPosts ?? []).filter((j) => jobControls(companyInfo, j.id).publish).map((j) => j.id)}
        />
      </div>
    );
  } catch {
    // console.error("Error in CompanyJobPostsPage:", err);
    return <ErrorComponent />;
  }
}
