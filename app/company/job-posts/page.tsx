import { createClient } from "@/lib/supabase/server";
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
    const { data: companyInfo, error: companyInfoError } = await supabase
      .from("company_info")
      .select("id, name")
      .eq("user_id", user.id)
      .single();

    if (companyInfoError || !companyInfo) {
      throw new Error("Company profile not found");
    }

    // Fetch all job postings for the company, along with a count of applications
    const { data: jobPosts, error: jobPostsError } = await supabase
      .from("job_postings")
      .select(
        `
          *,
          applications(count),
          company_info(name, website)
        `
      )
      .eq("company_id", companyInfo.id)
      .order("created_at", { ascending: false });

    if (jobPostsError) {
      // console.error("Error fetching job postings:", jobPostsError);
      throw jobPostsError;
    }

    return (
      <div className="flex flex-col w-full gap-8  p-4">
        <div>
          <BackButton />
        </div>
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <h1 className="text-3xl font-medium">Your Job Postings</h1>
          <CreateJobPostingDialog company_id={companyInfo.id} />
        </div>
        <JobPostingsTable data={jobPosts || []} />
      </div>
    );
  } catch {
    // console.error("Error in CompanyJobPostsPage:", err);
    return <ErrorComponent />;
  }
}
