"use client";

import {
  AllJobWithRelations,
  AllProfileWithRelations,
  TCompanyInfo,
} from "@/utils/types";
import Link from "next/link";
import { startTransition, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AppLoader from "./AppLoader";
import { User } from "@supabase/supabase-js";
import JobItem from "./JobItem";
import FindSuitableJobs from "./FindSuitableJobs";
import FilterComponentSheet from "./FilterComponentSheet";
import { Button } from "./ui/button";
import { ArrowLeft, Loader2, Search, Share2 } from "lucide-react";
import ProfileItem from "./ProfileItem";
import ScrollToTopButton from "./ScrollToTopButton";
import SortingComponent from "./SortingComponent";
import { useProgress } from "react-transition-progress";
import CompanyItem from "./CompanyItem";
import InfoTooltip from "./InfoTooltip";
import {
  copyToClipboard,
  fetcher,
  PROFILE_API_KEY,
  JOB_POSTING_API_KEY,
} from "@/utils/utils";
import useSWR, { mutate } from "swr";
import { createClient } from "@/lib/supabase/client";
import { triggerRelevanceUpdate } from "@/app/actions/relevant-jobs-update";
import ModifiedLink from "./ModifiedLink";
import FootComponent from "./FootComponent";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useRelevantJobPoller } from "@/hooks/useRelevantJobPoller";
import ProfileCompletionBanner from "./ProfileCompletionBanner";
import { triggerJobPostingRelevanceUpdate } from "@/app/actions/relevant-profiles-update";

export default function JobsComponent({
  initialJobs,
  user,
  isCompanyUser,
  current_page,
  companyId,
  isOnboardingComplete,
  isAllJobsTab,
  isAppliedJobsTabActive,
  totalCount,
  initialCursor,
  error,
  dynamicKey,
}: {
  initialJobs:
    | AllJobWithRelations[]
    | AllProfileWithRelations[]
    | TCompanyInfo[];
  user: User | null;
  isCompanyUser: boolean;
  current_page: "jobs" | "profiles" | "companies";
  companyId?: string;
  isOnboardingComplete: boolean;
  isAllJobsTab: boolean;
  isAppliedJobsTabActive: boolean;
  totalCount: number;
  initialCursor: string | null;
  error: string | null;
  dynamicKey: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startProgress = useProgress();
  const isSuitable = searchParams.get("sortBy") === "relevance";
  const jobId = searchParams.get("jobId");
  const isSimilarSearch = !!(isSuitable && jobId);
  const jobPostingId = searchParams.get("job_post");
  const isRelevantProfileSearch = !!(
    current_page === "profiles" &&
    isCompanyUser &&
    jobPostingId
  );

  const [aiGenBtnLoading, setAiGenBtnLoading] = useState(false);

  const { data: currentUserData } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });

  // giving 500 with jobpostingid as null and cant do conditional as getting error regarding number of hooks hydration mismatch
  const { data, isLoading } = useSWR(
    `${JOB_POSTING_API_KEY}?jobId=${jobPostingId}`,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      staleTime: 5 * 60 * 1000,
    },
  );

  const isGenerated = isRelevantProfileSearch
    ? data?.data?.matching_status === "completed"
    : currentUserData?.profile?.relevant_jobs_update_status === "completed";
  const isFailed = isRelevantProfileSearch
    ? data?.data?.matching_status === "failed"
    : currentUserData?.profile?.relevant_jobs_update_status === "failed";
  const isPending =
    isRelevantProfileSearch && data?.data?.matching_status === "pending";

  const {
    items: jobs,
    hasMore,
    loaderRef,
  } = useInfiniteScroll<
    AllJobWithRelations | TCompanyInfo | AllProfileWithRelations
  >({
    initialItems: initialJobs,
    initialCursor: initialCursor,
    fetchPage: async (cursor) => {
      const params = new URLSearchParams(searchParams.toString());

      if (cursor) params.set("cursor", cursor);

      params.set(
        "tab",
        isAllJobsTab ? "all" : isAppliedJobsTabActive ? "applied" : "saved",
      );

      const res = await fetch(
        `/api/${
          current_page === "profiles" && isCompanyUser
            ? "profiles"
            : current_page === "jobs"
              ? "jobs"
              : "companies"
        }?${params.toString()}`,
      );

      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json();

      return {
        data: json.data,
        nextCursor: json.nextCursor,
      };
    },
    resetDeps: [
      searchParams.toString(),
      current_page,
      isAllJobsTab,
      isAppliedJobsTabActive,
      isCompanyUser,
    ],
  });

  const { isRefreshing } = useRelevantJobPoller({
    loading: isLoading,
    userId: currentUserData?.profile?.user_id ?? null,
    isGenerated,
    isSuitable,
    isSimilarSearch,
    currentPage: current_page,
    isFailed,
    isRelevantProfileSearch,
    jobPostingId,
  });

  const navigateBack = async () => {
    startTransition(() => {
      startProgress();
      if (isSimilarSearch) {
        router.push("/jobs");
      } else {
        router.back();
      }
    });
  };

  const generateAIFeed = async (type: "job" | "profile") => {
    setAiGenBtnLoading(true);
    const supabase = createClient();
    if (type === "job") {
      await supabase
        .from("user_info")
        .update({
          relevant_jobs_update_status: "progress",
        })
        .eq("user_id", currentUserData.profile.user_id);

      await mutate(PROFILE_API_KEY);
      triggerRelevanceUpdate(currentUserData.profile.user_id);
    } else if (type === "profile" && jobPostingId) {
      const key = `${JOB_POSTING_API_KEY}?jobId=${jobPostingId}`;
      await supabase
        .from("job_postings")
        .update({
          matching_status: "progress",
          matching_error: null,
        })
        .eq("id", jobPostingId);
      await mutate(key);
      triggerJobPostingRelevanceUpdate(jobPostingId);
    }
    setAiGenBtnLoading(false);
  };

  const renderedList = useMemo(() => {
    const favoriteJobs: { job_id: string }[] =
      currentUserData?.profile?.user_favorites ?? [];
    const favoriteCompanies: { company_id: string }[] =
      currentUserData?.profile?.user_favorites_companies ?? [];
    const favoriteProfiles: { user_id: string }[] =
      currentUserData?.profile?.company_favorites ?? [];
    const appliedJobs: {
      all_jobs_id: string;
      status: string;
    }[] = currentUserData?.profile?.applications ?? [];

    if (jobs.length === 0) {
      return (
        <p className="text-muted-foreground mt-20 mx-auto text-center">
          No{" "}
          {isCompanyUser && current_page === "profiles"
            ? "profiles"
            : current_page === "jobs"
              ? "jobs"
              : "companies"}{" "}
          found for the selected Filter. <br />
          <ModifiedLink
            href={
              isCompanyUser && current_page === "profiles"
                ? "/company/profiles"
                : current_page === "jobs"
                  ? "/jobs"
                  : "/companies"
            }
            className="underline"
          >
            Clear Filters
          </ModifiedLink>
        </p>
      );
    }

    if (current_page === "profiles" && isCompanyUser) {
      return jobs
        .filter(
          (job): job is AllProfileWithRelations =>
            "user_id" in job && !("website" in job),
        )
        .map((profile) => (
          <ProfileItem
            key={profile.user_id}
            profile={profile}
            isSuitable={isSuitable}
            companyId={companyId}
            isFavorite={
              !!favoriteProfiles?.some((fav) => fav.user_id === profile.user_id)
            }
          />
        ));
    }

    if (current_page === "jobs") {
      const items = jobs.filter(
        (job): job is AllJobWithRelations => "job_name" in job,
      );

      const items1 = items
        .filter((_, i, arr) => i < arr.length - 20)
        .map((job) => (
          <JobItem
            isCompanyUser={isCompanyUser}
            key={job.id}
            job={job}
            userId={user?.id || null}
            isSuitable={isSuitable}
            isOnboardingComplete={isOnboardingComplete}
            isFavorite={!!favoriteJobs?.some((fav) => fav.job_id === job.id)}
            appliedJob={appliedJobs?.find((app) => app.all_jobs_id === job.id)}
          />
        ));
      const items2 = items
        .filter((_, i, arr) => i >= arr.length - 20)
        .map((job) => (
          <JobItem
            isCompanyUser={isCompanyUser}
            key={job.id}
            job={job}
            userId={user?.id || null}
            isSuitable={isSuitable}
            isOnboardingComplete={isOnboardingComplete}
            isFavorite={!!favoriteJobs?.some((fav) => fav.job_id === job.id)}
            appliedJob={appliedJobs?.find((app) => app.all_jobs_id === job.id)}
          />
        ));

      return [
        ...items1,
        user && !isOnboardingComplete && !isCompanyUser && (
          <ProfileCompletionBanner key={"profile-completion-banner"} />
        ),
        ...items2,
      ];
    }

    return jobs
      .filter((job): job is TCompanyInfo => "company_size" in job)
      .map((company) => (
        <CompanyItem
          isCompanyUser={isCompanyUser}
          key={company.id}
          company={company}
          userId={user?.id || null}
          isSuitable={isSuitable}
          isFavorite={
            !!favoriteCompanies?.some((fav) => fav.company_id === company.id)
          }
        />
      ));
  }, [
    jobs,
    current_page,
    isCompanyUser,
    isSuitable,
    isAppliedJobsTabActive,
    isOnboardingComplete,
    user,
    companyId,
    currentUserData,
  ]);

  return (
    <div className="flex flex-col gap-4 w-full pb-4">
      <div className="w-full flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2 ">
          {isSuitable && (
            <button
              className="text-muted-foreground hover:text-primary transition-colors p-4"
              onClick={navigateBack}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Showing {jobs.length} {isSuitable ? "suitable" : ""}
              {totalCount ? ` of ${totalCount}` : ""}{" "}
              {current_page === "profiles" && isCompanyUser
                ? "profiles"
                : current_page === "jobs"
                  ? "jobs"
                  : "companies"}{" "}
              {isSimilarSearch && current_page === "jobs" && "similar to"}{" "}
              {isSimilarSearch && current_page === "jobs" && (
                <Link
                  href={`/jobs/${jobId}`}
                  target="_blank"
                  className="underline text-blue-500"
                >
                  this job
                </Link>
              )}
            </p>
            {current_page === "jobs" && isSuitable && !isSimilarSearch ? (
              <InfoTooltip
                content={
                  <p>
                    Primary Resume is used to find jobs relevant to you.{" "}
                    <Link href={"/resume"} className="text-blue-500">
                      Change Primary Resume
                    </Link>
                  </p>
                }
              />
            ) : (
              ""
            )}
          </div>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto">
          {user &&
            isOnboardingComplete &&
            !isCompanyUser &&
            !(current_page === "profiles") &&
            !isSuitable && (
              <FindSuitableJobs
                user={user}
                currentPage={current_page}
                companyId={companyId}
              />
            )}
          {user &&
            isOnboardingComplete &&
            isCompanyUser &&
            current_page === "profiles" &&
            isAllJobsTab && (
              <FindSuitableJobs
                user={user}
                currentPage={current_page}
                companyId={companyId}
              />
            )}

          {!isOnboardingComplete && user && !isCompanyUser && (
            <div className="flex items-center gap-2">
              <Button
                asChild
                className="flex items-center gap-2 rounded-full text-sm"
              >
                <Link href={"/get-started"}>
                  <Search className="w-4 h-4" />
                  {current_page === "companies"
                    ? "Find Suitable Companies"
                    : "Find Suitable Jobs"}
                </Link>
              </Button>
            </div>
          )}

          {!user && (
            <Button
              asChild
              className="flex items-center gap-2 rounded-full text-sm"
            >
              <Link
                href={`/auth/sign-up?returnTo=/${
                  current_page === "companies" ? "companies" : "jobs"
                }`}
              >
                <Search className="w-4 h-4" />
                {current_page === "companies"
                  ? "Find Suitable Companies"
                  : "Find Suitable Jobs"}
              </Link>
            </Button>
          )}

          {searchParams.get("sortBy") !== "relevance" && (
            <SortingComponent
              isCompanyUser={isCompanyUser}
              currentPage={current_page}
            />
          )}

          {!user && (
            <Button
              variant={"ghost"}
              title="Share"
              onClick={() => {
                copyToClipboard(
                  window.location.href,
                  "Job Search URL copied to clipboard!",
                );
              }}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          )}

          <FilterComponentSheet
            dynamicKey={dynamicKey}
            currentPage={current_page}
            onboardingComplete={isOnboardingComplete}
          />
        </div>
      </div>

      {error ? (
        <div className="flex flex-col items-center justify-center my-20 gap-5">
          <p className=" text-muted-foreground text-sm text-center sm:w-1/2">
            {error}
          </p>
        </div>
      ) : (!data || isRefreshing) && user && isRelevantProfileSearch ? (
        <div className="flex items-center justify-center text-muted-foreground py-10">
          Loading...
        </div>
      ) : !isGenerated &&
        ((current_page === "jobs" && isSuitable && !isSimilarSearch) ||
          isRelevantProfileSearch) ? (
        isFailed ? (
          <div className="flex flex-col items-center justify-center my-20 gap-5">
            <p className=" text-muted-foreground text-sm text-center sm:w-1/2">
              There was some error generating your AI Smart Search Feed. Please
              click the button below to regenerate your feed. This is a one time
              process and might take some time. You will be notified via email
              once your feed is ready.
            </p>
            <Button
              onClick={() => {
                generateAIFeed(isRelevantProfileSearch ? "profile" : "job");
              }}
              disabled={aiGenBtnLoading}
            >
              <>
                {" "}
                Generate AI Feed
                {aiGenBtnLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
              </>
            </Button>
          </div>
        ) : isPending ? (
          <div className="flex flex-col items-center justify-center my-20 gap-5">
            <p className=" text-muted-foreground text-sm text-center sm:w-1/2">
              AI Smart Search Feed is only generated for active job postings.
              This job posting is currently inactive. Please click the button
              below to start the feed generation process. This is a one time
              process and might take some time. You will be notified via email
              once your feed is ready.
            </p>
            <Button
              onClick={() => {
                generateAIFeed("profile");
              }}
              disabled={aiGenBtnLoading}
            >
              <>
                Generate AI Feed
                {<Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              </>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center my-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="mt-4 text-muted-foreground animate-pulse text-sm text-center sm:w-3/4">
              AI is curating your personalized feed. This is a one time process
              and might take some time. You will be notified via email once your
              feed is ready.
            </p>
          </div>
        )
      ) : (
        renderedList
      )}

      {hasMore && jobs.length !== 0 && !error && (
        <>
          {/* Case A: AI relevance feed is still generating.
      We don't show the loader because the background polling 
      in JobsComponent handles the transition.
    */}
          {!isGenerated &&
          ((current_page === "jobs" && isSuitable && !isSimilarSearch) ||
            isRelevantProfileSearch) ? null /* Case B: Guest Wall.
      If not logged in and they've seen ~2 batches (40 items), 
      we show the FootComponent instead of the loaderRef. 
      Because loaderRef is not rendered, infinite scroll stops here.
    */ : current_page === "jobs" && !user && jobs.length >= 40 ? (
            <FootComponent />
          ) : (
            /* Case C: Standard Loader.
        Rendering the 'loaderRef' div triggers the Intersection Observer 
        to call fetchPage(nextCursor).
      */
            <div
              ref={loaderRef}
              className="flex justify-center items-center p-4 pt-20"
            >
              <AppLoader size="md" />
            </div>
          )}
        </>
      )}

      <ScrollToTopButton />
    </div>
  );
}
