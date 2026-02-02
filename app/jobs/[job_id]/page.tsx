import Error from "@/components/Error";
import { createClient } from "@/lib/supabase/server";
import { IJob, TAICredits } from "@/lib/types";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  Briefcase,
  DollarSign,
  ExternalLink,
  MapPin,
  Sparkle,
} from "lucide-react";
import JobDescriptionCard from "@/components/JobDetailsCard";
import { Badge } from "@/components/ui/badge";
import JobFavoriteBtn from "@/components/JobFavoriteBtn";
import JobApplyBtn from "@/components/JobApplyBtn";
import { allJobsSelectString } from "@/lib/filterQueryBuilder";
import { Metadata } from "next";
import JobPageDropdown from "@/components/JobPageDropdown";
import JobsFeedback from "@/components/JobFeedback";
import Link from "next/link";
import AskAIDialog from "@/components/AskAIDialog";
import { Button } from "@/components/ui/button";
import InfoTooltip from "@/components/InfoTooltip";
import NotFound from "../NotFound";
import CreateReviewForJob from "@/components/CreateReviewForJob";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ job_id: string }>;
}): Promise<Metadata> {
  try {
    const supabase = await createClient();
    const { job_id } = await params;
    const selectString = `
           ${allJobsSelectString},
            description,
            user_favorites(*),
            job_postings(*, company_info(*), applications(*)),
            applications(*)
        `;

    const { data, error } = await supabase
      .from("all_jobs")
      .select(selectString)
      .eq("id", job_id)
      .single();

    if (error) throw error;

    return {
      title: `${data?.job_name} at ${data?.company_name}`,
      description: `Apply for the ${data?.job_name} position at ${data?.company_name}.`,
      keywords: [
        data?.job_name,
        data?.company_name,
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
  try {
    const { job_id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    let isCompanyUser = false;
    let onboardingComplete = false;
    if (user && user.app_metadata) {
      isCompanyUser = user.app_metadata.type === "company";
      onboardingComplete = user.app_metadata.onboarding_complete;
    }
    const selectString = `
           ${allJobsSelectString},
            description,
            user_favorites(*),
            job_postings(*, company_info(*), applications(*)),
            applications(*),
            job_feedback(vote_type)
        `;

    const { data, error } = await supabase
      .from("all_jobs")
      .select(selectString)
      .eq("id", job_id);

    const job = data?.[0] as IJob;

    if (error) throw error;

    if (!job) {
      return <NotFound />;
    }

    return (
      <div className="flex flex-col gap-4 w-full p-4">
        <div>
          <Link
            href="/jobs"
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
        {/* --- Header Section --- */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-4">
          <div>
            <div className="flex items-center gap-1">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white max-w-[400px]">
                {job.job_name}
              </h1>
              <JobFavoriteBtn
                isCompanyUser={isCompanyUser}
                user={user}
                userFavorites={job.user_favorites}
                job_id={job.id}
              />
            </div>
            <p className="text-lg text-muted-foreground">
              at{" "}
              {job.company_url ? (
                <Link
                  target="_blank"
                  href={job.company_url}
                  className="hover:underline"
                >
                  {job.company_name}
                </Link>
              ) : (
                job.company_name
              )}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Posted on {format(new Date(job.created_at), "PPP")}
            </p>
            {user && !isCompanyUser && (
              <JobsFeedback
                jobId={job_id}
                initialVote={
                  job.job_feedback!.length > 0
                    ? job.job_feedback![0].vote_type
                    : null
                }
              />
            )}
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <JobApplyBtn
              isCompanyUser={isCompanyUser}
              user={user}
              job={job}
              isOnboardingComplete={onboardingComplete}
            />

            <JobPageDropdown
              user={user}
              jobId={job_id}
              isCompanyUser={isCompanyUser}
              applicationStatus={
                job.applications && job.applications.length > 0
                  ? job.applications[0].status
                  : null
              }
              isPlatformJob={!job.job_url}
            />
          </div>
        </div>

        {/* Features Section */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {job.job_url ? (
            user ? (
              <Button variant={"outline"} asChild>
                <Link target="_blank" href={job.job_url}>
                  Original Job
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + job_id}>
                  Original Job
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            )
          ) : (
            ""
          )}
          {isCompanyUser ? (
            ""
          ) : user ? (
            <AskAIDialog
              jobId={job_id}
              isOnboardingComplete={onboardingComplete}
            />
          ) : (
            <Button variant={"outline"} asChild>
              <Link href={"/auth/sign-up?returnTo=/jobs/" + job_id}>
                <Sparkle className="h-4 w-4" />
                Ask AI
              </Link>
            </Button>
          )}

          {isCompanyUser ? (
            ""
          ) : user ? (
            <div className="flex items-center">
              <Button variant={"outline"} asChild>
                <Link
                  target="_blank"
                  href={`/jobs?sortBy=relevance&jobId=${job_id}`}
                >
                  <Sparkle className="h-4 w-4" />
                  Find Similar Jobs
                </Link>
              </Button>
              <InfoTooltip
                content={
                  <p>
                    This feature uses {TAICredits.AI_SEARCH_OR_ASK_AI} AI
                    credits per use.{" "}
                    <Link href={"/dashboard"} className="text-blue-500">
                      Recharge Credits
                    </Link>
                  </p>
                }
              />
            </div>
          ) : (
            <Button variant={"outline"} asChild>
              <Link href={"/auth/sign-up?returnTo=/jobs/" + job_id}>
                <Sparkle className="h-4 w-4" />
                Find Similar Jobs
              </Link>
            </Button>
          )}
          {isCompanyUser ? (
            ""
          ) : user ? (
            <div className="flex items-center">
              <CreateReviewForJob userId={user.id} jobId={job_id} />
              <InfoTooltip
                content={
                  <p>
                    This feature uses {TAICredits.AI_CV_REVIEW} AI credits per
                    use.{" "}
                    <Link href={"/dashboard"} className="text-blue-500">
                      Recharge Credits
                    </Link>
                  </p>
                }
              />
            </div>
          ) : (
            <Button variant={"outline"} asChild>
              <Link href={"/auth/sign-up?returnTo=/jobs/" + job_id}>
                <Sparkle className="h-4 w-4" />
                Create CV Review
              </Link>
            </Button>
          )}
        </div>

        {/* Details Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Details Card */}
          <JobDescriptionCard
            job={job}
            user={user}
            isCompanyUser={isCompanyUser}
          />

          {/* Key Metrics/Details Sidebar */}
          <div className="grid gap-4">
            <Card className="shadow-sm border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Location</CardTitle>
                <MapPin className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 text-2xl font-bold">
                  {job.locations && job.locations.length > 0 ? (
                    job.locations.map((loc) => (
                      <Badge key={loc} variant="secondary" className="p-2">
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

            <Card className="shadow-sm border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Salary</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {job.salary_range ? job.salary_range : "Not specified"}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Experience
                </CardTitle>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {job.experience ? job.experience : "Not specified"}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  } catch {
    return <Error />;
  }
}
