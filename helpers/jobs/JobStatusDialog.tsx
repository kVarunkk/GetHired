"use client";

import Link from "next/link";
import { ExternalLink, Info, Loader2, Sparkle } from "lucide-react";
import { AllJobWithRelations, TApplicationStatus } from "@/utils/types";
import { useState } from "react";
import { revalidateCache } from "@/app/actions/revalidate";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";
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
import { Button } from "@/components/ui/button";
import { TJobIdPageData } from "@/utils/types/jobs.types";

export default function JobStatusDialog({
  job,
  showDialog,
  onClose,
  userId,
}: {
  job: AllJobWithRelations | TJobIdPageData;
  showDialog: boolean;
  onClose: (applicationStatus?: TApplicationStatus) => void;
  userId?: string;
}) {
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
        ),
      );
    } catch {
      toast.error(
        "Some error occured while updating the application status. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog open={showDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Did you apply for the role of {job.job_name} at {job.company_name}?
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
            feature on the{" "}
            <Link
              className="text-blue-500 hover:underline underline-offset-4 inline-flex items-center"
              href={"/jobs/" + job.id}
              target="_blank"
            >
              job page <ExternalLink size={12} />
            </Link>{" "}
            to get assistance with your application once you close this dialog.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-md bg-secondary p-3 border border-border">
          <Info className="h-4 w-4 shrink-0" />
          <p className="text-sm">
            View and download suitable resume for application{" "}
            <Link
              className="text-blue-500 hover:underline underline-offset-4 inline-flex items-center"
              href={"/resume"}
              target="_blank"
            >
              here <ExternalLink size={12} />
            </Link>
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
  );
}
