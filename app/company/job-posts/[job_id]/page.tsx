import { createClient } from "@/lib/supabase/server";
import Error from "@/components/Error";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CreateJobPostingDialog from "@/components/CreateJobPostingDialog";
import DeleteJobPosting from "@/components/DeleteJobPosting";
import { Briefcase, DollarSign, Users, MapPin } from "lucide-react";
import { format } from "date-fns";
import BackButton from "@/components/BackButton";
import { JobStatusSwitch } from "@/components/JobPostingsTable";
import ApplicantsTable from "@/components/ApplicantsTable";
import JobDescriptionCard from "@/components/JobDetailsCard";
import FindSuitableProfilesForJobPost from "@/components/FindSuitableProfilesForJobPost";
import ShareJobPosting from "@/components/ShareJobPosting";
import { notFound, unstable_rethrow } from "next/navigation";
import { isUuid } from "@/helpers/agent/auth";
import { RECRUITER_CANDIDATE_COLUMNS } from "@/helpers/profiles/candidate-columns";
import AskAgentAboutJobPost from "@/components/agent/recruiter/AskAgentAboutJobPost";

export default async function JobPostPage({
  params,
}: {
  params: Promise<{ job_id: string }>;
}) {
  try {
    const { job_id } = await params;
    if (!isUuid(job_id)) notFound();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: job, error } = await supabase
      .from("job_postings")
      .select(
        `
          *,
          applications(*, user_info(${RECRUITER_CANDIDATE_COLUMNS}), job_postings(*), application_screenings(status, fit_score, recommendation)),
          company_info(name, website)
        ` as const,
      )
      .eq("id", job_id)
      .maybeSingle();

    if (error) throw error;
    if (!job) notFound();

    // Prepare data for the Edit dialog
    const existingValues = {
      id: job.id,
      title: job.title,
      description: job.description ?? "",
      location: job.location ?? [],
      job_type: job.job_type,
      salary_currency: job.salary_currency ?? "$",
      min_salary: job.min_salary ?? 0,
      max_salary: job.max_salary ?? 0,
      min_experience: job.min_experience ?? 0,
      max_experience: job.max_experience ?? 0,
      visa_sponsorship: job.visa_sponsorship ?? "Not Required",
      min_equity: job.min_equity ?? 0,
      max_equity: job.max_equity ?? 0,
      questions: job.questions ?? [],
    };

    return (
      <div className="flex flex-col w-full gap-8 p-4 mb-20">
        <div>
          <BackButton />
        </div>
        {/* --- Header Section --- */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere] sm:text-[28px]">
              {job.title}
            </h1>
            <p className="text-lg text-muted-foreground">
              at {job.company_info?.name}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Posted on {format(new Date(job.created_at), "PPP")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <JobStatusSwitch job={job} />
            <CreateJobPostingDialog
              key={existingValues?.id || "new"}
              companyId={job.company_id}
              existingValues={existingValues}
            />
            <DeleteJobPosting job_posting_id={job.id} is_job_posting_page />
            <ShareJobPosting job_id={job.job_id} />
            <FindSuitableProfilesForJobPost job_post_id={job_id} />
          </div>
        </div>

        <AskAgentAboutJobPost job={{ id: job.id, title: job.title }} />

        {/* --- Job Details Section --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Details Card */}
          <JobDescriptionCard
            job={job}
            page={"job-posts"}
            userId={user?.id || null}
          />

          {/* Key Metrics/Details Sidebar */}
          <div className="grid gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Location</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 text-2xl font-semibold">
                  {job.location && job.location.length > 0 ? (
                    job.location.map((loc, index) => (
                      <Badge key={index} variant="secondary" className="p-2">
                        {loc}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-muted-foreground text-base">
                      Not specified
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Salary</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">
                  {job.salary_range ? job.salary_range : "Not specified"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Experience
                </CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">
                  {job.experience ? job.experience : "Not specified"}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Applicants
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">
                  {job.applications?.length}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* --- Applicants Section --- */}
        <div className="mt-8">
          <h2 className="text-lg font-semibold tracking-tight mb-4">
            Applicants ({job.applications?.length})
          </h2>
          <ApplicantsTable
            data={job.applications || []}
            jobPostId={job.id}
            defaultSort="fit"
          />
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
