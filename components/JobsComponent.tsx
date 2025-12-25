"use client";

import { ICompanyInfo, IFormData, IJob } from "@/lib/types";
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
import { ArrowLeft, Search, Share2 } from "lucide-react";
import ProfileItem from "./ProfileItem";
import ScrollToTopButton from "./ScrollToTopButton";
import SortingComponent from "./SortingComponent";
import { useProgress } from "react-transition-progress";
import { Link as ModifiedLink } from "react-transition-progress/next";
import CompanyItem from "./CompanyItem";
import InfoTooltip from "./InfoTooltip";
import { copyToClipboard } from "@/lib/utils";
import toast from "react-hot-toast";

export default function JobsComponent({
  initialJobs,
  // totalJobs,
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
  // totalJobs: number;
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
  const router = useRouter();
  const loaderRef = useRef<HTMLDivElement | null>(null);
  const searchParams = useSearchParams();
  const isSuitable = searchParams.get("sortBy") === "relevance";
  const startProgress = useProgress();
  useEffect(() => {
    setJobs(initialJobs);
    setPage(1);
    toast.dismiss();
  }, [initialJobs]);

  const loadMoreJobs = useCallback(async () => {
    if (isLoading || jobs.length >= totalCount) return;
    setIsLoading(true);

    const nextPage = page + 1;

    const params = new URLSearchParams(searchParams.toString());
    params.set("page", nextPage.toString());
    params.set(
      "tab",
      isAllJobsTab ? "all" : isAppliedJobsTabActive ? "applied" : "saved"
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
        }?${params.toString()}`
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
  ]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];
        if (firstEntry.isIntersecting && !isLoading) {
          loadMoreJobs();
        }
      },
      { threshold: 1.0 }
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

  const navigateBack = async () => {
    const params = new URLSearchParams(searchParams.toString());
    const sortBy = params.get("sortBy");
    const jobPost = params.get("job_post");
    const jobId = params.get("jobId");

    if (sortBy === "relevance") {
      params.delete("sortBy");
    }

    if (jobPost) {
      params.delete("job_post");
    }

    if (jobId) {
      params.delete("jobId");
    }

    startTransition(() => {
      startProgress();
      router.push(
        `/${
          current_page === "profiles" && isCompanyUser
            ? "company/profiles"
            : current_page === "jobs"
              ? "jobs"
              : "companies"
        }?${params.toString()}`
      );
    });
  };

  return (
    <div className="flex flex-col gap-4 w-full">
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
                  "Jobs posted in the past 1 month, sorted by relevance."
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
            !(current_page === "profiles") && (
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
              <Link href={"/get-started"}>
                <Button className="flex items-center gap-2 rounded-full text-sm">
                  <Search className="w-4 h-4" />
                  {current_page === "companies"
                    ? "Find Suitable Companies"
                    : "Find Suitable Jobs"}
                </Button>
              </Link>
            </div>
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
                  "Job Search URL copied to clipboard!"
                );
              }}
            >
              <Share2 className="h-4 w-4" />
            </Button>
          )}

          <FilterComponentSheet
            isCompanyUser={isCompanyUser}
            currentPage={current_page}
            onboardingComplete={isOnboardingComplete}
          />
        </div>
      </div>

      {jobs.length > 0 ? (
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

      {jobs.length < totalCount && jobs.length !== 0 && (
        <div
          ref={loaderRef}
          className="flex justify-center items-center p-4 pt-20"
        >
          <AppLoader size="md" />
        </div>
      )}

      <ScrollToTopButton />
    </div>
  );
}
