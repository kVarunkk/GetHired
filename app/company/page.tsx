import { createClient } from "@/lib/supabase/server";
import ErrorComponent from "@/components/Error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import CreateJobPostingDialog from "@/components/CreateJobPostingDialog";
import { Button } from "@/components/ui/button";
import { IApplication, IJobPosting } from "@/lib/types";
import CompanyJobPostingCard from "@/components/CompanyJobPostingCard";
import ApplicationStatusBadge from "@/components/ApplicationStatusBadge";

export default async function CompanyPage() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) throw error;
    if (!user) throw new Error("User not found");

    // Fetch company info
    const { data: companyInfo, error: companyInfoError } = await supabase
      .from("company_info")
      .select("id, name")
      .eq("user_id", user.id)
      .single();

    if (companyInfoError || !companyInfo) {
      throw new Error("Company profile not found");
    }

    // --- Fetch all data in parallel to avoid a request waterfall ---
    const [metricsRes, jobsRes, applicantsRes] = await Promise.all([
      supabase.rpc("get_company_metrics", { company_id: companyInfo.id }),
      supabase
        .from("job_postings")
        .select(
          `
          id,
          title,
          company_id,
          description,
          location,
          job_type,
          salary_currency,
          min_salary,
          max_salary,
          min_experience,
          max_experience,
          visa_sponsorship,
          min_equity,
          max_equity,
          questions,
          status,
          job_id,
          applications(id),
          company_info(name, website)
        `
        )
        .eq("company_id", companyInfo.id)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("applications")
        .select(
          `
          id,
          status,
          created_at,
          user_info(*),
          job_postings(id, title)
        `
        )
        .eq("job_postings.company_id", companyInfo.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const { data: metricsData, error: metricsError } = metricsRes;
    const { data: jobsData, error: jobsError } = jobsRes;
    const { data: applicantsData, error: applicantsError } = applicantsRes;

    if (metricsError || jobsError || applicantsError) {
      throw new Error("Failed to fetch dashboard data.");
    }

    const metrics = metricsData?.[0] || {};
    const jobPosts: IJobPosting[] =
      (jobsData as unknown as IJobPosting[]) || [];
    const recentApplicants =
      (applicantsData as unknown as IApplication[]) || [];

    return (
      <div className="flex flex-col w-full gap-5 p-4 mb-20">
        <div className="flex items-center justify-between flex-wrap gap-5">
          <h2 className="text-3xl font-medium text-start">
            How are you doing today, {companyInfo.name}?
          </h2>
          <CreateJobPostingDialog company_id={companyInfo.id} />
        </div>

        {/* --- Metrics Section --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="flex flex-col items-center p-6 text-center shadow-none">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-4xl font-extrabold">
                {metrics.total_jobs || 0}
              </CardTitle>
              <p className="text-muted-foreground font-medium">Job Posts</p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center shadow-none">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-4xl font-extrabold">
                {metrics.total_applicants || 0}
              </CardTitle>
              <p className="text-muted-foreground font-semibold">
                Total Applicants
              </p>
            </CardContent>
          </Card>

          <Card className="flex flex-col items-center p-6 text-center shadow-none">
            <CardHeader className="p-0"></CardHeader>
            <CardContent className="p-0 space-y-2">
              <CardTitle className="text-4xl font-extrabold">
                {metrics.new_applicants_today || 0}
              </CardTitle>
              <p className="text-muted-foreground font-semibold">
                New Applicants Today
              </p>
            </CardContent>
          </Card>
        </div>

        {/* --- Active Job Posts Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-medium">Your Job Posts</h3>
            <Link href={"/company/job-posts"}>
              <Button variant={"ghost"}>View all</Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {jobPosts.length > 0 ? (
              jobPosts.map((job) => (
                <CompanyJobPostingCard key={job.id} job={job} />
              ))
            ) : (
              <p className="text-muted-foreground">
                You have no active job posts.
              </p>
            )}
          </div>
        </div>

        {/* --- Recent Applicants Section --- */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-medium">Recent Applicants</h3>
            <Link href={"/company/applicants"}>
              <Button variant={"ghost"}>View all</Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentApplicants.length > 0 ? (
              recentApplicants.map((applicant) => (
                <Card className="p-4 shadow-none" key={applicant.id}>
                  <CardHeader className="p-0 mb-2 ">
                    <CardTitle className="text-lg font-semibold">
                      <Link
                        href={`/company/applicants/${applicant.id}`}
                        className="underline underline-offset-4 sm:no-underline hover:underline"
                      >
                        {applicant.user_info?.full_name || "New Applicant"}
                      </Link>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 flex flex-col gap-2">
                    <ApplicationStatusBadge status={applicant.status} />
                    <div className="flex items-center justify-between w-full">
                      <div className="text-muted-foreground text-sm">
                        Applied for{" "}
                        <Link
                          href={`/company/job-posts/${applicant.job_postings?.id}`}
                          className="underline underline-offset-4 sm:no-underline font-semibold hover:underline"
                        >
                          {applicant.job_postings?.title}
                        </Link>
                      </div>
                      <div className="text-muted-foreground text-sm">
                        {formatDistanceToNow(new Date(applicant.created_at), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <p className="text-muted-foreground">No recent applications.</p>
            )}
          </div>
        </div>
      </div>
    );
  } catch {
    // console.error("Error in CompanyPage:", err);
    return <ErrorComponent />;
  }
}
