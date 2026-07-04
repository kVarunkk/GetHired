"use client";

import Link from "next/link";
import { Button } from "./ui/button";
import JobApplicationDialog from "./JobApplicationDialog";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { AllJobWithRelations } from "@/utils/types";
import { useState } from "react";
import PropagationStopper from "./StopPropagation";
import InfoTooltip from "./InfoTooltip";
import JobStatusDialog from "@/helpers/jobs/JobStatusDialog";
import { TJobIdPageData } from "@/utils/types/jobs.types";

export default function JobApplyBtn({
  isCompanyUser,
  userId,
  job,
  isOnboardingComplete,
  appliedJob,
  isJobIdPage,
  isDialogOpen,
}: {
  isCompanyUser: boolean;
  userId: string | null;
  job: AllJobWithRelations | TJobIdPageData;
  isOnboardingComplete: boolean;
  appliedJob?: {
    all_jobs_id: string;
    status: string;
  };
  isJobIdPage: boolean;
  isDialogOpen: boolean;
}) {
  const [showReturnDialog, setShowReturnDialog] = useState(false);

  return (
    <>
      {isCompanyUser ? null : userId ? (
        job.job_url ? (
          appliedJob?.status ? (
            <PropagationStopper>
              <div className="flex items-center gap-2">
                <Button className="capitalize" disabled>
                  {appliedJob.status}
                </Button>

                <InfoTooltip
                  content={
                    <p>
                      Your current application status is{" "}
                      <b className="capitalize">{appliedJob.status}</b>.
                      You&apos;ll have to manually track your application status
                      via the{" "}
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
                  setShowReturnDialog(true);
                }}
              >
                Apply Now <ArrowRight />
              </Button>
            </Link>
          )
        ) : isOnboardingComplete ? (
          !isJobIdPage && job.status === "active" ? (
            <Link
              onClick={(e) => e.stopPropagation()}
              href={"/jobs/" + job.id + "?apply=true"}
              target={"_blank"}
            >
              <Button>Easy Apply</Button>
            </Link>
          ) : (
            <JobApplicationDialog
              jobPost={job}
              userId={userId}
              appliedJob={appliedJob}
              isApplyDialogOpen={isDialogOpen}
            />
          )
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
          onClose={() => setShowReturnDialog(false)}
          userId={userId}
        />
      )}
    </>
  );
}
