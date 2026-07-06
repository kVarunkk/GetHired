"use client";

import useSWR from "swr";
import Link from "next/link";
import { format } from "date-fns";
import {
  ExternalLink,
  Sparkle,
  MapPin,
  DollarSign,
  Briefcase,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetcher, PROFILE_API_KEY } from "@/utils/utils";
import JobFavoriteBtn from "./JobFavoriteBtn";
import JobsFeedback from "./JobFeedback";
import JobApplyBtn from "./JobApplyBtn";
import JobPageDropdown from "./JobPageDropdown";
import ProfileCompletionBanner from "./ProfileCompletionBanner";
import JobDescriptionCard from "./JobDetailsCard";
import AskAIDialog from "./AskAIDialog";
import InfoTooltip from "./InfoTooltip";
import { TAICredits } from "@/utils/types";
import CreateReviewForJob from "./CreateReviewForJob";
import { Skeleton } from "./ui/skeleton";
import ModifiedLink from "./ModifiedLink";
import { useSearchParams } from "next/navigation";
import { TJobIdPageData } from "@/utils/types/jobs.types";

export default function JobClientHydrator({ job }: { job: TJobIdPageData }) {
  const searchParams = useSearchParams();
  const shouldApplyDialogOpen = searchParams.get("apply") === "true";

  const { data: currentUserData, isLoading } = useSWR(
    PROFILE_API_KEY,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      staleTime: 5 * 60 * 1000,
    },
  );

  const userId: string | null = currentUserData?.profile?.user_id ?? null;
  const isCompanyUser = currentUserData?.role === "company";
  const onboardingComplete = currentUserData?.profile?.filled ?? false;

  const isFavorited = !!currentUserData?.profile?.user_favorites?.some(
    (fav: { job_id: string }) => fav.job_id === job.id,
  );
  const activeApplication = currentUserData?.profile?.applications?.find(
    (app: { all_jobs_id: string; status: string }) =>
      app.all_jobs_id === job.id,
  );
  const applicationStatus = activeApplication ? activeApplication.status : null;

  const initialVote =
    currentUserData?.profile?.job_feedback?.find(
      (fb: { job_id: string }) => fb.job_id === job.id,
    )?.vote_type ?? null;

  return (
    <>
      {/* --- Header Section --- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-4">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white max-w-[400px]">
              {job.job_name}
            </h1>
            {isLoading ? (
              <Skeleton className="h-5 w-5" />
            ) : (
              <JobFavoriteBtn
                isCompanyUser={isCompanyUser}
                userId={userId}
                job_id={job.id}
                isFavorite={isFavorited}
              />
            )}
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
            Posted on {format(new Date(job.created_at || ""), "PPP")}
          </p>

          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            !isCompanyUser && (
              <JobsFeedback jobId={job.id} initialVote={initialVote} />
            )
          )}
        </div>

        {isLoading ? (
          <Skeleton className="h-10 w-24" />
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <JobApplyBtn
              isCompanyUser={isCompanyUser}
              userId={userId}
              job={job}
              isOnboardingComplete={onboardingComplete}
              appliedJob={activeApplication}
              isJobIdPage={true}
              isDialogOpen={shouldApplyDialogOpen}
            />

            <JobPageDropdown
              userId={userId}
              jobId={job.id}
              isCompanyUser={isCompanyUser}
              applicationStatus={applicationStatus}
              isPlatformJob={!job.job_url}
            />
          </div>
        )}
      </div>

      {/* --- Features Section --- */}
      <div className="flex items-center gap-5 justify-between mt-2 flex-wrap">
        {job.job_url ? (
          isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : userId ? (
            <Button variant={"link"} asChild>
              <Link target="_blank" href={job.job_url}>
                Original Job
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button variant={"link"} asChild>
              <Link href={"/auth/sign-up?returnTo=/jobs/" + job.id}>
                Original Job
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          )
        ) : (
          ""
        )}
        {!isCompanyUser && (
          <div className="flex items-center flex-wrap gap-3">
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : userId ? (
              <AskAIDialog
                jobId={job.id}
                isOnboardingComplete={onboardingComplete}
              />
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + job.id}>
                  <Sparkle className="h-4 w-4" />
                  Ask AI
                </Link>
              </Button>
            )}

            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : userId ? (
              <div className="flex items-center">
                <Button variant={"outline"} asChild>
                  <ModifiedLink
                    // target="_blank"
                    href={`/jobs?sortBy=relevance&jobId=${job.id}`}
                  >
                    <Sparkle className="h-4 w-4" />
                    Find Similar Jobs
                  </ModifiedLink>
                </Button>
                <InfoTooltip
                  content={
                    <p>
                      This feature uses {TAICredits.AI_SEARCH_ASK_AI_RESUME} AI
                      credits per use.{" "}
                      <Link
                        href={"/dashboard/buy-credits"}
                        className="text-blue-500"
                      >
                        Recharge Credits
                      </Link>
                    </p>
                  }
                />
              </div>
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + job.id}>
                  <Sparkle className="h-4 w-4" />
                  Find Similar Jobs
                </Link>
              </Button>
            )}
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : userId ? (
              <div className="flex items-center">
                <CreateReviewForJob userId={userId} jobId={job.id} />
                <InfoTooltip
                  content={
                    <p>
                      This feature uses {TAICredits.AI_CV_REVIEW} AI credits per
                      use.{" "}
                      <Link
                        href={"/dashboard/buy-credits"}
                        className="text-blue-500"
                      >
                        Recharge Credits
                      </Link>
                    </p>
                  }
                />
              </div>
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + job.id}>
                  <Sparkle className="h-4 w-4" />
                  Tailor CV for this Job
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* --- Details Cards Section --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <JobDescriptionCard
          job={job}
          userId={userId}
          isCompanyUser={isCompanyUser}
          page="all-jobs"
          inactive={isLoading}
        />

        <div className="grid gap-4">
          <Card className="shadow-sm border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Location</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 text-2xl font-bold">
                {job.locations?.length > 0 ? (
                  [...new Set(job.locations)]
                    .filter((loc): loc is string => !!loc)
                    .map((loc: string) => (
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
                {job.salary_range || "Not specified"}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Experience</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {job.experience || "Not specified"}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {userId && !onboardingComplete && !isCompanyUser && (
        <ProfileCompletionBanner />
      )}
    </>
  );
}
