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
import { useRouter, useSearchParams } from "next/navigation";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { useMemo } from "react";

export default function JobClientHydrator({ job }: { job: TJobIdPageData }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shouldApplyDialogOpen = searchParams.get("apply") === "true";

  const { data: currentUserData, isLoading } = useSWR(
    PROFILE_API_KEY,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5 * 60 * 1000,
    },
  );

  const userId: string | null = currentUserData?.profile?.user_id ?? null;

  const hasCredits = (currentUserData?.profile?.ai_credits ?? 0) > 0;

  const { data: jobUrlsData, isLoading: isUrlsLoading } = useSWR(
    currentUserData !== undefined && hasCredits
      ? `/api/jobs/${job.id}/urls`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 5 * 60 * 1000,
    },
  );

  const jobData = useMemo(
    () => ({
      ...job,
      job_url: jobUrlsData?.job_url ?? null,
      company_url: jobUrlsData?.company_url ?? null,
    }),
    [job, jobUrlsData],
  );

  const isCompanyUser = currentUserData?.role === "company";
  const onboardingComplete = currentUserData?.profile?.filled ?? false;

  const isFavorited = !!currentUserData?.profile?.user_favorites?.some(
    (fav: { job_id: string }) => fav.job_id === jobData.id,
  );
  const activeApplication = currentUserData?.profile?.applications?.find(
    (app: { all_jobs_id: string; status: string }) =>
      app.all_jobs_id === jobData.id,
  );
  const applicationStatus = activeApplication ? activeApplication.status : null;

  const initialVote =
    currentUserData?.profile?.job_feedback?.find(
      (fb: { job_id: string }) => fb.job_id === jobData.id,
    )?.vote_type ?? null;

  return (
    <>
      {/* --- Header Section --- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-4">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white max-w-[400px]">
              {jobData.job_name}
            </h1>
            {isLoading ? (
              <Skeleton className="h-5 w-5" />
            ) : (
              <JobFavoriteBtn
                isCompanyUser={isCompanyUser}
                userId={userId}
                job_id={jobData.id}
                isFavorite={isFavorited}
              />
            )}
          </div>
          <p className="text-lg text-muted-foreground">
            at{" "}
            {jobData.company_url ? (
              <Link
                target="_blank"
                href={jobData.company_url}
                className="hover:underline"
              >
                {jobData.company_name}
              </Link>
            ) : (
              jobData.company_name
            )}
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Posted on {format(new Date(jobData.created_at || ""), "PPP")}
          </p>

          {isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            !isCompanyUser && (
              <JobsFeedback jobId={jobData.id} initialVote={initialVote} />
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
              job={jobData}
              isOnboardingComplete={onboardingComplete}
              appliedJob={activeApplication}
              isJobIdPage={true}
              isDialogOpen={shouldApplyDialogOpen}
              isLoading={isUrlsLoading}
              hasCredits={hasCredits}
            />

            <JobPageDropdown
              userId={userId}
              jobId={jobData.id}
              isCompanyUser={isCompanyUser}
              applicationStatus={applicationStatus}
              isPlatformJob={jobData.is_platform_job}
            />
          </div>
        )}
      </div>

      {/* --- Features Section --- */}
      <div className="flex items-center gap-5 justify-between mt-2 flex-wrap">
        {jobData.job_url ? (
          isUrlsLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : userId ? (
            <Button variant={"link"} asChild>
              <Link target="_blank" href={jobData.job_url}>
                Original Job
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <Button variant={"link"} asChild>
              <Link href={"/auth/sign-up?returnTo=/jobs/" + jobData.id}>
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
                jobId={jobData.id}
                isOnboardingComplete={onboardingComplete}
              />
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + jobData.id}>
                  <Sparkle className="h-4 w-4" />
                  Ask AI
                </Link>
              </Button>
            )}

            {isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : userId ? (
              <Button
                variant="outline"
                onClick={() => {
                  const jobUrl = new URL(
                    `/jobs/${jobData.id}`,
                    window.location.origin,
                  ).toString();
                  const params = new URLSearchParams({
                    create: "true",
                    jobUrl,
                  });
                  router.push(`/interview?${params.toString()}`);
                }}
              >
                <Sparkle className="h-4 w-4" />
                AI Interview
              </Button>
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + jobData.id}>
                  <Sparkle className="h-4 w-4" />
                  AI Interview
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
                    href={`/jobs?sortBy=relevance&jobId=${jobData.id}`}
                  >
                    <Sparkle className="h-4 w-4" />
                    Find Similar Jobs
                  </ModifiedLink>
                </Button>
              </div>
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + jobData.id}>
                  <Sparkle className="h-4 w-4" />
                  Find Similar Jobs
                </Link>
              </Button>
            )}
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : userId ? (
              <div className="flex items-center">
                <CreateReviewForJob userId={userId} jobId={jobData.id} />
              </div>
            ) : (
              <Button variant={"outline"} asChild>
                <Link href={"/auth/sign-up?returnTo=/jobs/" + jobData.id}>
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
          job={jobData}
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
                {jobData.locations?.length > 0 ? (
                  [...new Set(jobData.locations)]
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
                {jobData.salary_range || "Not specified"}
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
                {jobData.experience || "Not specified"}
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
