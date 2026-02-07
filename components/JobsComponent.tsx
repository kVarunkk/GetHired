"use client";

import { ICompanyInfo, IFormData, IJob, TAICredits } from "@/lib/types";
import Link from "next/link";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
// import { Link as ModifiedLink } from "react-transition-progress/next";
import CompanyItem from "./CompanyItem";
import InfoTooltip from "./InfoTooltip";
import { copyToClipboard, fetcher, PROFILE_API_KEY } from "@/lib/utils";
import toast from "react-hot-toast";
import useSWR, { mutate } from "swr";
import { createClient } from "@/lib/supabase/client";
import { revalidateCache } from "@/app/actions/revalidate";
import { triggerRelevanceUpdate } from "@/app/actions/relevant-jobs-update";
import ModifiedLink from "./ModifiedLink";
import FootComponent from "./FootComponent";

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
}: {
  initialJobs: IJob[] | IFormData[];
  user: User | null;
  isCompanyUser: boolean;
  current_page: "jobs" | "profiles" | "companies";
  companyId?: string;
  isOnboardingComplete: boolean;
  isAllJobsTab: boolean;
  isAppliedJobsTabActive: boolean;
  totalCount: number;
}) {
  const [jobs, setJobs] = useState<IJob[] | IFormData[] | ICompanyInfo[]>([]);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const { data } = useSWR(PROFILE_API_KEY, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    staleTime: 5 * 60 * 1000,
  });
  const [isGenerated, setIsGenerated] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const router = useRouter();
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const isSuitable = searchParams.get("sortBy") === "relevance";
  const isSimilarSearch = isSuitable && searchParams.get("jobId");
  const startProgress = useProgress();
  useEffect(() => {
    setJobs(initialJobs);
    setPage(1);
    toast.dismiss();
  }, [initialJobs]);

  const loadMoreJobs = useCallback(async () => {
    if (
      isLoading ||
      jobs.length >= totalCount ||
      (page >= 2 && !user && current_page === "jobs")
    )
      return;
    setIsLoading(true);

    const nextPage = page + 1;

    const params = new URLSearchParams(searchParams.toString());
    params.set("page", nextPage.toString());
    params.set(
      "tab",
      isAllJobsTab ? "all" : isAppliedJobsTabActive ? "applied" : "saved",
    );
    params.set("limit", "20");

    try {
      const res = await fetch(
        `/api/${
          current_page === "profiles" && isCompanyUser
            ? "profiles"
            : current_page === "jobs"
              ? "jobs"
              : "companies"
        }?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Some error occured");

      const result = await res.json();

      const { data } = result;

      if (data.length > 0) {
        setPage(nextPage);
        setJobs((prevJobs) => [...prevJobs, ...data]);
      }
    } catch {
      // console.error("Failed to fetch more jobs:", error);
    } finally {
      setIsLoading(false);
    }
  }, [
    isLoading,
    jobs.length,
    page,
    searchParams,
    isCompanyUser,
    current_page,
    isAllJobsTab,
    isAppliedJobsTabActive,
    totalCount,
    user,
  ]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];
        if (firstEntry.isIntersecting && !isLoading) {
          loadMoreJobs();
        }
      },
      { threshold: 0.3 },
    );

    const currentLoader = loaderRef.current;
    if (currentLoader) {
      observer.observe(currentLoader);
    }

    return () => {
      if (currentLoader) {
        observer.unobserve(currentLoader);
      }
    };
  }, [isLoading, jobs, loadMoreJobs]);

  useEffect(() => {
    if (
      data &&
      data.profile &&
      current_page === "jobs" &&
      isSuitable &&
      !isSimilarSearch
    ) {
      setIsGenerated(data.profile.is_relevant_jobs_generated);
      setIsFailed(data.profile.is_relevant_job_update_failed);
    }
  }, [data, current_page, isSuitable, isSimilarSearch]);

  useEffect(() => {
    // If already generated, do nothing
    if (
      isGenerated ||
      current_page !== "jobs" ||
      !isSuitable ||
      isSimilarSearch ||
      isFailed
    )
      return;

    // Polling logic
    const interval = setInterval(async () => {
      if (!user) return;
      const supabase = createClient();
      const { data } = await supabase
        .from("user_info")
        .select("is_relevant_jobs_generated")
        .eq("user_id", user.id)
        .single();

      if (data?.is_relevant_jobs_generated) {
        await mutate(PROFILE_API_KEY);
        await revalidateCache("jobs-feed");
        // setIsGenerated(true);
        clearInterval(interval);
        router.refresh(); // Refresh server components to fetch new jobs
      }
    }, 2000); // Check every 2 seconds

    return () => clearInterval(interval);
  }, [
    isGenerated,
    user,
    router,
    current_page,
    isSuitable,
    isSimilarSearch,
    isFailed,
  ]);

  useEffect(() => {
    (async () => {
      if (isGenerated && isSuitable) {
        const supabase = createClient();
        await supabase
          .from("user_info")
          .update({
            ai_credits:
              data.profile.ai_credits - TAICredits.AI_SEARCH_OR_ASK_AI,
          })
          .eq("user_id", data.profile.user_id);
        await mutate(PROFILE_API_KEY);
      }
    })();
  }, [isGenerated, isSuitable]);

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
    setIsFailed(false);
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
                setPage={setPage}
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
                setPage={setPage}
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
              setPage={setPage}
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
            // isCompanyUser={isCompanyUser}
            currentPage={current_page}
            onboardingComplete={isOnboardingComplete}
          />
        </div>
      </div>

      {!isGenerated &&
      current_page === "jobs" &&
      isSuitable &&
      !isSimilarSearch ? (
        isFailed ? (
          <div className="flex flex-col items-center justify-center my-20">
            <p className=" text-muted-foreground text-sm text-center sm:w-3/4">
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
      ) : jobs.length > 0 ? (
        current_page === "profiles" && isCompanyUser ? (
          (jobs as IFormData[]).map((job) => (
            <ProfileItem
              key={job.user_id}
              profile={job}
              isSuitable={isSuitable}
              companyId={companyId}
            />
          ))
        ) : current_page === "jobs" ? (
          (jobs as IJob[]).map((job) => (
            <JobItem
              isCompanyUser={isCompanyUser}
              key={job.id}
              job={job}
              user={user}
              isSuitable={isSuitable}
              isAppliedJobsTabActive={isAppliedJobsTabActive}
              isOnboardingComplete={isOnboardingComplete}
            />
          ))
        ) : (
          (jobs as ICompanyInfo[]).map((job) => (
            <CompanyItem
              isCompanyUser={isCompanyUser}
              key={job.id}
              company={job}
              user={user}
              isSuitable={isSuitable}
            />
          ))
        )
      ) : (
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
      )}

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
      )}

      <ScrollToTopButton />
    </div>
  );
}
