"use client";

import {
  AllJobWithRelations,
  AllProfileWithRelations,
  TCompanyInfo,
} from "@/utils/types";
import Link from "next/link";
import { startTransition, useMemo } from "react";
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
import { copyToClipboard, fetcher, PROFILE_API_KEY } from "@/utils/utils";
import useSWR, { mutate } from "swr";
import { createClient } from "@/lib/supabase/client";
import { triggerRelevanceUpdate } from "@/app/actions/relevant-jobs-update";
import ModifiedLink from "./ModifiedLink";
import FootComponent from "./FootComponent";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useRelevantJobPoller } from "@/hooks/useRelevantJobPoller";

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
  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });

  const router = useRouter();
  const searchParams = useSearchParams();
  const startProgress = useProgress();
  const isSuitable = searchParams.get("sortBy") === "relevance";
  const isSimilarSearch = !!(isSuitable && searchParams.get("jobId"));
  const isGenerated = data?.profile?.is_relevant_jobs_generated ?? false;
  const isFailed = data?.profile?.is_relevant_job_update_failed ?? false;

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

  useRelevantJobPoller({
    userId: user?.id ?? null,
    isGenerated,
    isSuitable,
    isSimilarSearch,
    currentPage: current_page,
    isFailed,
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

  const generateAIFeed = async () => {
    const supabase = createClient();
    await supabase
      .from("user_info")
      .update({
        is_relevant_job_update_failed: false,
      })
      .eq("user_id", data.profile.user_id);
    mutate(PROFILE_API_KEY);
    triggerRelevanceUpdate(data.profile.user_id);
  };

  const renderedList = useMemo(() => {
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
          />
        ));
    }

    if (current_page === "jobs") {
      return jobs
        .filter((job): job is AllJobWithRelations => "job_name" in job)
        .map((job) => (
          <JobItem
            isCompanyUser={isCompanyUser}
            key={job.id}
            job={job}
            user={user}
            isSuitable={isSuitable}
            isAppliedJobsTabActive={isAppliedJobsTabActive}
            isOnboardingComplete={isOnboardingComplete}
          />
        ));
    }

    return jobs
      .filter((job): job is TCompanyInfo => "company_size" in job)
      .map((company) => (
        <CompanyItem
          isCompanyUser={isCompanyUser}
          key={company.id}
          company={company}
          user={user}
          isSuitable={isSuitable}
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
                  : "companies"}
            </p>
            {current_page === "jobs" && isSuitable ? (
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
              <InfoTooltip content="Please complete your profile to use this feature" />

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
      ) : !isGenerated &&
        current_page === "jobs" &&
        isSuitable &&
        !isSimilarSearch ? (
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
                generateAIFeed();
              }}
            >
              Generate AI Feed
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center my-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="mt-4 text-muted-foreground animate-pulse text-sm text-center sm:w-3/4">
              AI is curating your personalized job feed. This is a one time
              process and might take some time. You will be notified via email
              once your feed is ready.
            </p>
          </div>
        )
      ) : (
        renderedList
      )}
      {/* 
      {jobs.length < totalCount && jobs.length !== 0 ? (
        !isGenerated &&
        current_page === "jobs" &&
        isSuitable &&
        !isSimilarSearch ? (
          ""
        ) : current_page === "jobs" && !user && page >= 2 ? (
          <FootComponent />
        ) : (
          <div
            ref={loaderRef}
            className="flex justify-center items-center p-4 pt-20"
          >
            <AppLoader size="md" />
          </div>
        )
      ) : (
        ""
      )} */}

      {hasMore && jobs.length !== 0 && !error && (
        <>
          {/* Case A: AI relevance feed is still generating.
      We don't show the loader because the background polling 
      in JobsComponent handles the transition.
    */}
          {!isGenerated &&
          current_page === "jobs" &&
          isSuitable &&
          !isSimilarSearch ? null /* Case B: Guest Wall.
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
