"use client";

import Link from "next/link";
// import { Link as ModifiedLink } from "react-transition-progress/next";
import { Badge } from "./ui/badge";
import { IJob } from "@/lib/types";
import { User } from "@supabase/supabase-js";
import { cn } from "@/lib/utils";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import JobFavoriteBtn from "./JobFavoriteBtn";
import JobApplyBtn from "./JobApplyBtn";
import ModifiedLink from "./ModifiedLink";
import React from "react";

const JobItem = React.memo(
  ({
    job,
    user,
    isSuitable,
    isCompanyUser,
    isAppliedJobsTabActive,
    isOnboardingComplete,
  }: {
    job: IJob;
    user: User | null;
    isSuitable: boolean;
    isCompanyUser: boolean;
    isAppliedJobsTabActive: boolean;
    isOnboardingComplete: boolean;
  }) => {
    return (
      <>
        <ModifiedLink
          href={`/jobs/${job.id}`}
          target="_blank"
          className="text-start"
        >
          <div
            className={cn(
              "flex flex-col gap-3 p-4 group  rounded-lg transition hover:bg-secondary ",
            )}
          >
            <div className="flex-col sm:flex-row sm:flex items-center justify-between gap-4">
              <div className="flex flex-col gap-2 mb-6 sm:mb-0">
                <div className="flex flex-col ">
                  <div className="">
                    <Link
                      href={`/jobs/${job.id}`}
                      target="_blank"
                      className="inline hover:underline underline sm:no-underline underline-offset-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <h3 className="inline text-lg sm:text-xl font-semibold">
                        {job.job_name}
                      </h3>
                    </Link>
                    <JobFavoriteBtn
                      isCompanyUser={isCompanyUser}
                      user={user}
                      userFavorites={job.user_favorites}
                      job_id={job.id}
                    />
                  </div>
                  {job.company_url ? (
                    <Link
                      href={job.company_url || ""}
                      target="_blank"
                      className="text-muted-foreground hover:underline w-fit underline sm:no-underline underline-offset-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {job.company_name}
                    </Link>
                  ) : (
                    <p className="text-muted-foreground"> {job.company_name}</p>
                  )}
                </div>
                <JobDetailBadges job={job} isSuitable={isSuitable} />
              </div>
              <JobApplyBtn
                isCompanyUser={isCompanyUser}
                user={user}
                job={job}
                isOnboardingComplete={isOnboardingComplete}
                isAppliedJobsTabActive={isAppliedJobsTabActive}
              />
            </div>
            {job.status === "inactive" && (
              <div className="flex items-center gap-1 text-muted-foreground text-xs">
                <InfoCircledIcon />
                This Job Posting has been deactivated by {job.company_name}
              </div>
            )}
          </div>
        </ModifiedLink>
      </>
    );
  },
);

function JobDetailBadges({
  job,
  isSuitable,
}: {
  job: IJob;
  isSuitable: boolean;
}) {
  const jobDetails = [
    {
      id: "job_type",
      value: job.job_type,
      label: "Job Type",
    },
    {
      id: "salary_range",
      value: job.salary_range,
      label: "Salary Range",
    },
    {
      id: "experience",
      value: job.experience,
      label: "Experience",
    },
    {
      id: "visa_requirement",
      value: job.visa_requirement,
      label: "Visa Requirement",
    },
    {
      id: "locations",
      value: job.locations.join(", "),
      label: "Locations",
    },
    {
      id: "equity_range",
      value: job.equity_range,
      label: "Equity Range",
    },
  ];

  let platform_url;

  switch (job.platform) {
    case "ycombinator":
      platform_url = "https://www.workatastartup.com/companies";
      break;
    case "uplers":
      platform_url = "https://ats.uplers.com/talent/all-opportunities";
      break;
    case "remoteok":
      platform_url = "https://remoteok.com";
      break;
    case "wellfound":
      platform_url = "https://wellfound.com";
      break;
    case "gethired":
      platform_url = "https://gethired.devhub.co.in";
      break;
    case "weworkremotely":
      platform_url = "https://weworkremotely.com";
      break;
    case "greenhouse":
      platform_url = "https://my.greenhouse.io";
      break;
    case "glassdoor":
      platform_url = "https://www.glassdoor.co.in";
      break;
    case "jobleads":
      platform_url = "https://www.jobleads.com";
      break;
    case "workingnomads":
      platform_url = "https://www.workingnomads.com";
      break;
    default:
      platform_url = "";
      break;
  }
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {jobDetails
        .filter((each) => each.value)
        .map((detail) => (
          <Badge
            title={detail.label}
            variant={"outline"}
            key={detail.id}
            className={cn(
              "text-xs sm:text-sm font-medium group-hover:border-secondary-foreground",
            )}
          >
            {detail.value}
          </Badge>
        ))}
      {job.platform && (
        <Link
          onClick={(e) => e.stopPropagation()}
          href={platform_url || ""}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Badge
            variant={"secondary"}
            className={cn(
              "text-xs sm:text-sm font-medium hover:!text-secondary-foreground group-hover:border-secondary-foreground hover:underline",
              "underline underline-offset-2 sm:no-underline",
            )}
          >
            {job.platform}
          </Badge>
        </Link>
      )}
      {isSuitable && (
        <Badge
          className={cn(
            "text-xs sm:text-sm font-medium bg-green-200 text-green-700 !border-green-200 hover:bg-green-100 group-hover:border-secondary-foreground",
          )}
        >
          Job Match
        </Badge>
      )}
    </div>
  );
}
JobItem.displayName = "JobItem";
export default JobItem;
