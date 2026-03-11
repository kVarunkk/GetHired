"use client";

import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { Button } from "./ui/button";
import JobApplicationDialog from "./JobApplicationDialog";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { IJob, TApplicationStatus } from "@/utils/types";
import { useCallback, useState } from "react";
import PropagationStopper from "./StopPropagation";
import InfoTooltip from "./InfoTooltip";
import JobStatusDialog from "@/helpers/jobs/JobStatusDialog";

export default function JobApplyBtn({
  isCompanyUser,
  user,
  job,
  isOnboardingComplete,
  isAppliedJobsTabActive = false,
}: {
  isCompanyUser: boolean;
  user: User | null;
  job: IJob;
  isOnboardingComplete: boolean;
  isAppliedJobsTabActive?: boolean;
}) {
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const handleJobApplicationStatus = () => {
    setShowReturnDialog(true);
  };
  const [appStatus, setAppStatus] = useState(job.applications?.[0]?.status);

  const handleCloseDialog = useCallback(
    (applicationStatus?: TApplicationStatus) => {
      if (applicationStatus) setAppStatus(applicationStatus);
      setShowReturnDialog(false);
    },
    [],
  );

  return (
    <>
      {isCompanyUser ? null : user ? (
        job.job_url ? (
          appStatus ? (
            <PropagationStopper>
              <div className="flex items-center gap-2">
                <InfoTooltip
                  content={
                    <p>
                      Your current application status is{" "}
                      <b className="capitalize">{appStatus}</b>. You&apos;ll
                      have to manually track your application status via the{" "}
                      <Link
                        onClick={(e) => e.stopPropagation()}
                        className="underline text-blue-500"
                        href={job.job_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Job Posting
                      </Link>
                      . You can update your status by clicking on{" "}
                      <MoreHorizontal className="h-4 w-4 inline-block mx-1" />{" "}
                      button.
                    </p>
                  }
                />
                <Button className="capitalize" disabled>
                  {appStatus}
                </Button>
              </div>
            </PropagationStopper>
          ) : (
            <Link
              onClick={(e) => {
                e.stopPropagation();
              }}
              href={job.job_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  handleJobApplicationStatus();
                }}
              >
                Apply Now <ArrowRight />
              </Button>
            </Link>
          )
        ) : isOnboardingComplete ? (
          <JobApplicationDialog
            jobPost={job}
            user={user}
            isAppliedJobsTabActive={isAppliedJobsTabActive}
          />
        ) : (
          <Link onClick={(e) => e.stopPropagation()} href={"/get-started"}>
            <Button>Complete Onboarding to Apply</Button>
          </Link>
        )
      ) : (
        <Link
          onClick={(e) => e.stopPropagation()}
          href={"/auth/sign-up?returnTo=/jobs/" + job.id}
          rel="noopener noreferrer"
        >
          <Button>
            Apply Now <ArrowRight />
          </Button>
        </Link>
      )}

      {showReturnDialog && (
        <JobStatusDialog
          job={job}
          showDialog={showReturnDialog}
          onClose={handleCloseDialog}
          userId={user?.id}
        />
      )}
    </>
  );
}
