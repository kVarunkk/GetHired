import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import Error from "@/components/Error";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, DollarSign, Users, MapPin } from "lucide-react";
import Link from "next/link";
import JobDescriptionCard from "@/components/JobDetailsCard";
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

    // RP-REQ-010: a job the viewer's role doesn't cover is a 404 (the row
    // itself is public, so RLS can't hide it). The layout checks it too.
    const company = user ? await getMyCompany(supabase, user) : null;
    if (!company || job.company_id !== company.id || !can(company, "jobs.view", job.id)) notFound();

    // The layout shows the header and the job's controls.
    return (
      <div className="mb-20 flex flex-col gap-6">
        {can(company, "agent.use") && (
          <AskAgentAboutJobPost
            job={{ id: job.id, title: job.title }}
            canMatch={can(company, "matching.run", job.id)}
            canViewApplicants={can(company, "applicants.view", job.id)}
            canViewInterviews={can(company, "interviews.view", job.id)}
            canManageInterviews={can(company, "interviews.manage", job.id) && can(company, "jobs.edit", job.id)}
          />
        )}

        {/* --- Job Details Section --- */}
        {/* The app sidebar and the job nav leave too little room for three columns below xl. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Details Card */}
          <JobDescriptionCard
            job={job}
            page={"job-posts"}
            userId={user?.id || null}
          />

          {/* Key Metrics/Details Sidebar */}
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-1">
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

            <Link
              href={`/company/job-posts/${job.id}/applications`}
              className="rounded-xl transition-colors hover:bg-muted/60"
            >
              <Card className="h-full bg-transparent">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Applications
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tracking-tight">
                    {job.applications?.length}
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </div>
    );
  } catch (err) {
    unstable_rethrow(err);
    return <Error />;
  }
}
