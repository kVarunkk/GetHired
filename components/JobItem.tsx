"use client";

import Link from "next/link";
import { Badge } from "./ui/badge";
import { cn } from "@/utils/utils";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import JobFavoriteBtn from "./JobFavoriteBtn";
import JobApplyBtn from "./JobApplyBtn";
import React from "react";
import { AllJobWithRelations } from "@/utils/types";
import { platformsArray } from "@/utils/platforms";

const JobItem = React.memo(
  ({
    job,
    userId,
    isSuitable,
    isCompanyUser,
    isOnboardingComplete,
    isFavorite,
    appliedJob,
  }: {
    job: AllJobWithRelations;
    userId: string | null;
    isSuitable: boolean;
    isCompanyUser: boolean;
    isOnboardingComplete: boolean;
    isFavorite: boolean;
    appliedJob?: {
      all_jobs_id: string;
      status: string;
    };
  }) => {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 p-4 group  rounded-lg transition hover:bg-secondary",
        )}
      >
        <div className=" flex-col sm:flex-row sm:flex items-center justify-between gap-4">
          <div className="flex-1 flex flex-col gap-2 mb-6 sm:mb-0">
            <div className="flex flex-col ">
              <div>
                <Link
                  href={`/jobs/${job.id}`}
                  target="_blank"
                  className="inline hover:underline group-hover:underline underline sm:no-underline underline-offset-[4px]"
                  onClick={(e) => e.stopPropagation()}
                  prefetch={false}
                >
                  <h3 className="inline text-lg sm:text-xl font-semibold">
                    {job.job_name}
                  </h3>
                </Link>
                <JobFavoriteBtn
                  isCompanyUser={isCompanyUser}
                  userId={userId}
                  job_id={job.id}
                  isFavorite={isFavorite}
                />
              </div>
              {job.company_url ? (
                <Link
                  href={job.company_url || ""}
                  target="_blank"
                  className="text-muted-foreground hover:underline w-fit underline sm:no-underline underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                  prefetch={false}
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
            userId={userId}
            job={job}
            isOnboardingComplete={isOnboardingComplete}
            appliedJob={appliedJob}
            isJobIdPage={false}
            isDialogOpen={false}
          />
        </div>
        {job.status === "inactive" && (
          <div className="flex items-center gap-1 text-muted-foreground text-xs">
            <InfoCircledIcon />
            This Job Posting has been deactivated by {job.company_name}
          </div>
        )}
      </div>
    );
  },
);

function JobDetailBadges({
  job,
  isSuitable,
}: {
  job: AllJobWithRelations;
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

  const platform = platformsArray.find((_) => _.value === job.platform);

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
          href={platform?.platform_url || ""}
          target="_blank"
          rel="noopener noreferrer"
          prefetch={false}
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
