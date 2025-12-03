"use client";

import { User } from "@supabase/supabase-js";
import Link from "next/link";
import { Button } from "./ui/button";
import JobApplicationDialog from "./JobApplicationDialog";
import {
  ArrowRight,
  Info,
  Loader2,
  MoreHorizontal,
  Sparkle,
} from "lucide-react";
import { IJob } from "@/lib/types";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TApplicationStatus } from "./ApplicationStatusBadge";
import PropagationStopper from "./StopPropagation";
import { revalidateCache } from "@/app/actions/revalidate";
import InfoTooltip from "./InfoTooltip";
import { useRouter } from "next/navigation";

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
    []
  );

  return (
    <>
      {isCompanyUser ? (
        ""
      ) : user ? (
        job.job_url ? (
          appStatus ? (
            <PropagationStopper>
              <div className="flex items-center gap-2">
                <InfoTooltip
                  content={
                    <p>
                      Your current application status is <b>{appStatus}</b>.
                      You&apos;ll have to manually track your application status
                      via the{" "}
                      <Link
                        onClick={(e) => e.stopPropagation()}
                        className="underline text-blue-600"
                        href={job.job_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Job Posting
                      </Link>
                      .
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
            // dialogStateCallback={dialogStateCallback}
            jobPost={job}
            user={user}
            isAppliedJobsTabActive={isAppliedJobsTabActive}
          />
        ) : (
          <Link
            onClick={(e) => e.stopPropagation()}
            href={"/get-started?edit=true"}
          >
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

function JobStatusDialog({
  job,
  showDialog,
  onClose,
  userId,
}: {
  job: IJob;
  showDialog: boolean;
  onClose: (applicationStatus?: TApplicationStatus) => void;
  userId?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const updateJobApplicationStatus = async () => {
    try {
      setLoading(true);
      const supabase = createClient();
      const { error } = await supabase.from("applications").insert({
        applicant_user_id: userId,
        status: "submitted",
        all_jobs_id: job.id,
      });
      if (error) throw error;

      await revalidateCache("jobs-feed");

      onClose(TApplicationStatus.SUBMITTED);
      toast.success(
        job.job_name && job.company_name ? (
          <p>
            Succesfully applied to{" "}
            <span className="font-medium">{job.job_name}</span> at{" "}
            <span className="font-medium">{job.company_name} </span>
          </p>
        ) : (
          <p>Succesfully applied to the job</p>
        )
      );
    } catch {
      // console.error(e);
      toast.error(
        "Some error occured while updating the application status. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PropagationStopper className="absolute inset-0">
      <AlertDialog
        open={showDialog}
        // onOpenChange={() => {
        //   onClose();
        // }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Did you apply for the role of {job.job_name} at {job.company_name}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This helps us track your application status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-3 rounded-md bg-secondary p-3 border border-border">
            <Info className="h-4 w-4 shrink-0" />
            <p className="text-sm">
              Use the{" "}
              <span className="font-bold inline-flex  gap-1">
                <Sparkle className="h-4 w-4" /> Ask AI
              </span>{" "}
              feature by clicking
              <MoreHorizontal className="h-4 w-4 inline-block mx-1" />{" "}
              {window.location.pathname === "/jobs" && (
                <span
                  // href={"/jobs/" + job.id}
                  // target="_blank"
                  onClick={() => router.push("/jobs/" + job.id)}
                  className="text-blue-400 underline"
                >
                  <button>on this page</button>
                </span>
              )}{" "}
              to get assistance with your application once you close this
              dialog.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button
                variant={"secondary"}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                disabled={loading}
              >
                No
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  updateJobApplicationStatus();
                }}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Yes
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PropagationStopper>
  );
}
