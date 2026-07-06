"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";
import toast from "react-hot-toast";
import { IJobPost } from "@/utils/types";
import { TCompanyIdPageData } from "@/utils/types/jobs.types";
import { triggerJobPostingRelevanceUpdate } from "@/app/actions/relevant-profiles-update";
import { revalidateCacheAction } from "@/app/actions/revalidate";

export const useJobPostingStatus = (
  initialStatus: "active" | "inactive",
  job: IJobPost | TCompanyIdPageData,
) => {
  const [checkedState, setCheckedState] = useState(initialStatus === "active");
  const supabase = createClient();
  const handleUpdateStatus = async (value: boolean) => {
    setCheckedState(value);

    try {
      // 1. Update the status in the main job_postings table
      const { error: updateError } = await supabase
        .from("job_postings")
        .update({ status: value ? "active" : "inactive" })
        .eq("id", job.id);

      if (updateError) throw updateError;

      if (job.job_id) {
        const { error: updateAllJobsError } = await supabase
          .from("all_jobs")
          .update({ status: value ? "active" : "inactive" })
          .eq("id", job.job_id);

        if (updateAllJobsError) throw updateAllJobsError;

        await revalidateCacheAction(`job-${job.job_id}`);
      }

      // if the job posting is activated, trigger profile relevance update
      if (value) {
        await supabase
          .from("job_postings")
          .update({
            matching_status: "progress",
            matching_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);

        triggerJobPostingRelevanceUpdate(job.id);
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
  };
};
