"use client";

import { Loader2, Trash } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { DialogTrigger } from "@radix-ui/react-dialog";
import toast from "react-hot-toast";
import { deleteJobPostingAction } from "@/app/actions/delete-job-posting";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteJobPosting({
  job_posting_id,
  is_job_posting_page = false,
}: {
  job_posting_id: string;
  is_job_posting_page?: boolean;
}) {
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
  return (
    <Dialog>
      <DialogTrigger title="Delete Job Post" asChild>
        <Button variant={"ghost"} className="text-muted-foreground">
          <Trash className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Job Posting</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this job posting? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant={"outline"}>Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleDelete}
            disabled={loading}
            variant={"destructive"}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
