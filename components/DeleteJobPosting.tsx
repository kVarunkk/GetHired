"use client";

import { Loader2, Trash } from "lucide-react";
import { Button, buttonVariants } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import toast from "react-hot-toast";
import { deleteJobPostingAction } from "@/app/actions/delete-job-posting";
import { useRouter } from "next/navigation";
import { useState } from "react";
import RoleLocked from "./team/RoleLocked";
import { forbiddenMessage } from "@/helpers/companies/permissions";

export default function DeleteJobPosting({
  job_posting_id,
  is_job_posting_page = false,
  disabled = false,
}: {
  job_posting_id: string;
  is_job_posting_page?: boolean;
  /** Without jobs.delete on this job (RP-REQ-016). */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const handleDelete = async () => {
    setLoading(true);
    try {
      const result = await deleteJobPostingAction({
        jobPostingId: job_posting_id,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Job posting deleted successfully.");
      setOpen(false);

      if (is_job_posting_page) {
        router.push("/company");
      } else {
        router.refresh();
      }
    } catch {
      toast.error("Failed to delete job posting.");
    } finally {
      setLoading(false);
    }
  };
  const trigger = (
    <Button
      variant="destructive-ghost"
      aria-label="Delete Job Post"
      disabled={disabled}
    >
      <Trash className="h-4 w-4" />
    </Button>
  );

  if (disabled) {
    return <RoleLocked reason={forbiddenMessage("jobs.delete")}>{trigger}</RoleLocked>;
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !loading && setOpen(next)}>
      <AlertDialogTrigger title="Delete Job Post" asChild>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Job Posting</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this job posting? This action cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={loading}
            onClick={(e) => {
              // Stay open until the delete is done, and on failure.
              e.preventDefault();
              void handleDelete();
            }}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
