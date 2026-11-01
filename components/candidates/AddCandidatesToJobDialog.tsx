"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { addCandidatesToJobAction } from "@/app/actions/candidates/add-candidates-to-job";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { describeAddToJob } from "@/helpers/candidates/copy";

/**
 * Adds company candidates to a job (BI-REQ-005), in its first Applied stage.
 * `jobs` are the ones the member can import into. Nobody is emailed.
 */
export default function AddCandidatesToJobDialog({
  open,
  onOpenChange,
  candidateIds,
  jobs,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateIds: string[];
  jobs: { id: string; title: string }[];
  onAdded?: () => void;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      const result = await addCandidatesToJobAction({ jobPostId: jobId, candidateIds });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(describeAddToJob(result.counts));
      onOpenChange(false);
      onAdded?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to a job</DialogTitle>
          <DialogDescription>
            {candidateIds.length === 1 ? "They go" : `All ${candidateIds.length} go`} into the job&apos;s first
            stage. No one will be emailed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="add-to-job">Job</Label>
          <Select value={jobId ?? undefined} onValueChange={setJobId}>
            <SelectTrigger id="add-to-job" aria-label="Job">
              <SelectValue placeholder="Choose a job" />
            </SelectTrigger>
            <SelectContent>
              {jobs.map((job) => (
                <SelectItem key={job.id} value={job.id}>
                  {job.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!jobId || busy} onClick={() => void add()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add to job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
