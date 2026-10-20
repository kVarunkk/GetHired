"use client";

import { useSignUpToApplyHref } from "./jobs/ApplicationSourceContext";
import Link from "next/link";
import { Button } from "./ui/button";
import JobApplicationDialog from "./JobApplicationDialog";
import { ArrowRight, MoreHorizontal } from "lucide-react";
import { AllJobWithRelations, PostHogEvent } from "@/utils/types";
import { useState } from "react";
import PropagationStopper from "./StopPropagation";
import InfoTooltip from "./InfoTooltip";
import JobStatusDialog from "@/helpers/jobs/JobStatusDialog";
import { TJobIdPageData } from "@/utils/types/jobs.types";
import { Skeleton } from "./ui/skeleton";
import { deductApplicationCreditsAction } from "@/app/actions/deduct-application-credits";
import { PROFILE_API_KEY } from "@/utils/utils";
import { mutate } from "swr";

export default function JobApplyBtn({
  isCompanyUser,
  userId,
  job,
  isOnboardingComplete,
  appliedJob,
  isJobIdPage,
  isDialogOpen,
  isLoading,
  hasCredits,
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
  isLoading: boolean;
  hasCredits: boolean;
}) {
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  // Apply is the main action on the job page (brand); in a list every row has one, so it stays default there.
  const signUpHref = useSignUpToApplyHref(job.id);
  const applyVariant = isJobIdPage ? "brand" : "default";

  return (
    <>
      {isCompanyUser ? null : userId ? (
        isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : !job.is_platform_job ? (
          appliedJob?.status ? (
            hasCredits && job.job_url ? (
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
                        You&apos;ll have to manually track your application
                        status via the{" "}
                        <Link
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium underline underline-offset-4"
                          href={job.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Original Job Posting
                        </Link>
                        . You can update your status by clicking on{" "}
                        <MoreHorizontal className="h-4 w-4 inline-block mx-1" />{" "}
                        button{" "}
                        {!isJobIdPage && (
                          <Link
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium underline underline-offset-4"
                            href={`/jobs/${job.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            here.
                          </Link>
                        )}
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
                href={"/dashboard/buy-credits"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button>
                  Recharge to Track <ArrowRight />
                </Button>
              </Link>
            )
          ) : hasCredits && job.job_url ? (
            <Link
              onClick={(e) => {
                e.stopPropagation();
              }}
              href={job.job_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                variant={applyVariant}
                onClick={async (e) => {
                  e.stopPropagation();
                  setShowReturnDialog(true);

                  const result = await deductApplicationCreditsAction(
                    job.id,
                    PostHogEvent.ApplicationClicked,
                  );

                  if (result.success) {
                    await mutate(PROFILE_API_KEY);
                  }
                }}
              >
                Apply Now <ArrowRight />
              </Button>
            </Link>
          ) : (
            <Link
              onClick={(e) => {
                e.stopPropagation();
              }}
              href={"/dashboard/buy-credits"}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant={applyVariant}>
                Recharge to Apply <ArrowRight />
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
              <Button variant={applyVariant}>Easy Apply</Button>
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
            <Button variant={applyVariant}>Complete Onboarding to Apply</Button>
          </Link>
        )
      ) : (
        <Link
          onClick={(e) => e.stopPropagation()}
          href={signUpHref}
          rel="noopener noreferrer"
        >
          <Button variant={applyVariant}>
            Apply Now <ArrowRight />
          </Button>
        </Link>
      )}

      {showReturnDialog && (
        <JobStatusDialog
          job={job}
          showDialog={showReturnDialog}
          onClose={() => setShowReturnDialog(false)}
        />
      )}
    </>
  );
}
