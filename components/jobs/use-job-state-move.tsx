"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { reviewJobApprovalAction } from "@/app/actions/review-job-approval";
import { setJobPostStateAction, type SetJobPostStateActionResult } from "@/app/actions/set-job-post-state";
import { useEntitlementError } from "@/hooks/useEntitlementError";
import type { JobMove, JobPostState } from "@/helpers/jobs/job-states";
import type { JobStateDialogValues } from "./CloseJobDialog";

const DONE: Record<JobMove["kind"], string> = {
  publish: "Job published.",
  submit: "Job submitted for approval.",
  approve: "Job approved and published.",
  request_changes: "Sent back with your note.",
  withdraw: "Job withdrawn. It's a draft again.",
  pause: "Job paused.",
  resume: "Job reopened.",
  reopen: "Job reopened.",
  close: "Job closed.",
  fill: "Job marked as filled.",
};

/**
 * Makes one job state move through `setJobPostStateAction` (an approver's
 * approve or request for changes through `reviewJobApprovalAction`) and reports it:
 * the upgrade dialog at the plan's limit, a toast otherwise, then a refresh.
 * Shared by `JobStateMenu` and the Overview's fill notice. Render `dialog`.
 */
export function useJobStateMove(jobPostId: string, onMoved?: (state: JobPostState) => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { handle: handleEntitlement, dialog } = useEntitlementError();

  const apply = async (move: Pick<JobMove, "to" | "kind">, values?: JobStateDialogValues): Promise<boolean> => {
    setBusy(true);
    try {
      const result: SetJobPostStateActionResult =
        move.kind === "approve" || move.kind === "request_changes"
          ? await reviewJobApprovalAction({ jobPostId, decision: move.kind, note: values?.note ?? null })
          : await setJobPostStateAction({
              jobPostId,
              to: move.to,
              reason: values?.reason ?? null,
              note: values?.note ?? null,
              cancelOpenInterviews: values?.cancelOpenInterviews ?? false,
            });
      if (!result.ok) {
        if (await handleEntitlement(result)) return false;
        toast.error(typeof result.error === "string" ? result.error : "Failed to update the job posting.");
        return false;
      }
      onMoved?.(result.state);
      const cancelled =
        result.interviewsCancelled && result.interviewsCancelled > 0
          ? ` ${result.interviewsCancelled} AI ${result.interviewsCancelled === 1 ? "interview" : "interviews"} cancelled.`
          : "";
      toast.success(`${DONE[move.kind]}${cancelled}`);
      if (result.interviewsError) toast.error(result.interviewsError);
      router.refresh();
      return true;
    } catch {
      toast.error("Failed to update the job posting.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { apply, busy, dialog };
}
