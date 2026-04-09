"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";
import toast from "react-hot-toast";
import { IJobPost } from "@/utils/types";
import { TCompanyIdPageData } from "@/utils/types/jobs.types";

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

      if (!job.job_id) {
        // If there's no job_id, this is the first time it's being made active.
        // Insert it into the 'all_jobs' table.
        const { data: insertedData, error: insertError } = await supabase
          .from("all_jobs")
          .insert({
            locations: job.location,
            job_type: job.job_type,
            job_name: job.title,
            description: job.description,
            visa_requirement: job.visa_sponsorship,
            salary_range: job.salary_range,
            salary_min: job.min_salary,
            salary_max: job.max_salary,
            experience_min: job.min_experience ?? undefined,
            experience_max: job.max_experience,
            equity_range: job.equity_range,
            equity_min: job.min_equity,
            equity_max: job.max_equity,
            experience: job.experience,
            company_url: job.company_info?.website,
            company_name: job.company_info?.name,
            platform: "gethired",
          })
          .select("id")
          .single();

        if (insertError) throw insertError;

        // Update the job_postings table with the new job_id
        await supabase
          .from("job_postings")
          .update({ job_id: insertedData.id })
          .eq("id", job.id);

        // router.refresh();
      } else {
        // The job_id already exists, just update the status in 'all_jobs'
        const { error: updateAllJobsError } = await supabase
          .from("all_jobs")
          .update({ status: value ? "active" : "inactive" })
          .eq("id", job.job_id);

        if (updateAllJobsError) throw updateAllJobsError;
        // router.refresh();
      }
      toast.success(
        `Job Posting ${value ? "activated" : "deactivated"} succesfully`,
      );
    } catch {
      // console.error("Failed to update job posting status:", error);
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
