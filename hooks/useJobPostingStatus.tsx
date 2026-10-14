"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { IJobPost } from "@/utils/types";
import { TCompanyIdPageData } from "@/utils/types/jobs.types";
import { triggerJobPostingRelevanceUpdate } from "@/app/actions/relevant-profiles-update";
import { setJobPostingStatusAction } from "@/app/actions/set-job-posting-status";
import { useEntitlementError } from "@/hooks/useEntitlementError";

export const useJobPostingStatus = (
  initialStatus: "active" | "inactive",
  job: IJobPost | TCompanyIdPageData,
) => {
  const [checkedState, setCheckedState] = useState(initialStatus === "active");
  const { handle: handleEntitlement, dialog: upgradeDialog } = useEntitlementError();

  const handleUpdateStatus = async (value: boolean) => {
    setCheckedState(value);

    try {
      // Checks ownership and, when activating, the plan's active post limit.
      const result = await setJobPostingStatusAction({
        jobPostingId: job.id,
        status: value ? "active" : "inactive",
      });

      if (!result.ok) {
        setCheckedState(!value);
        if (await handleEntitlement(result)) return;
        toast.error(
          typeof result.error === "string"
            ? result.error
            : "Some error occured while updating the status of Job Posting",
        );
        return;
      }

      // if the job posting is activated, trigger profile relevance update
      // The action marks the posting in progress after checking ownership.
      if (value) {
        await triggerJobPostingRelevanceUpdate(job.id);
      }

      toast.success(
        `Job Posting ${value ? "activated" : "deactivated"} succesfully`,
      );
    } catch {
      setCheckedState(!value);
      toast.error(
        "Some error occured while updating the status of Job Posting",
      );
    }
  };

  return {
    checkedState,
    handleUpdateStatus,
    upgradeDialog,
  };
};
