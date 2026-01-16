"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { ICreateJobPostingFormData } from "@/lib/types";
// import { createClient } from "../../lib/supabase/server";
// import { revalidatePath } from "next/cache";

/**
 * SERVER ACTION: upsertJobPostingAction
 * Orchestrates the database logic across 'job_postings' and 'all_jobs' tables.
 */

const buildSalaryRange = (
  currency?: string,
  salary_min?: number,
  salary_max?: number
) => {
  if (currency && salary_min && salary_max) {
    return `${currency}${salary_min} - ${currency}${salary_max}`;
  } else return null;
};

const buildEquityRange = (equity_min?: number, equity_max?: number) => {
  if (equity_max && equity_min) {
    return `${equity_min}% - ${equity_max}%`;
  } else if (!equity_max && equity_min) {
    return `${equity_min}% +`;
  } else return null;
};

const buildExperience = (exp_min?: number, exp_max?: number) => {
  if (exp_max && exp_min) {
    return `${exp_min} - ${exp_max} Years`;
  } else if (!exp_max && exp_min) {
    return `${exp_min}+ Years`;
  } else return null;
};

export async function upsertJobPostingAction(params: {
  values: ICreateJobPostingFormData;
  companyId: string;
  existingPostingId?: string;
  existingJobId?: string | null;
}) {
  const { values, companyId, existingPostingId, existingJobId } = params;
  const supabase = createServiceRoleClient();

  const salary_range = buildSalaryRange(
    values.salary_currency,
    values.min_salary,
    values.max_salary
  );
  const equity_range = buildEquityRange(values.min_equity, values.max_equity);
  const experience = buildExperience(
    values.min_experience,
    values.max_experience
  );

  try {
    const payload = {
      company_id: companyId,
      ...values,
      salary_range,
      equity_range,
      experience,
      questions: values.questions?.filter((q: string) => q.trim() !== "") || [],
    };

    if (existingPostingId) {
      payload.id = existingPostingId;
    }

    // 1. Update the primary job_postings record
    const { data: new_posting, error: postingError } = await supabase
      .from("job_postings")
      .upsert(payload, { onConflict: "id" })
      .select("*, company_info(website, name)")
      .single();

    if (postingError || !new_posting) throw postingError;

    // 2. Sync changes to the public 'all_jobs' aggregate table
    if (existingJobId) {
      // Handle Updates for existing listings
      const { error: updateError } = await supabase
        .from("all_jobs")
        .update({
          job_name: values.title.trim(),
          job_type: values.job_type,
          salary_range,
          salary_min: values.min_salary,
          salary_max: values.max_salary,
          experience,
          experience_min: values.min_experience,
          experience_max: values.max_experience,
          equity_range,
          equity_min: values.min_equity,
          equity_max: values.max_equity,
          visa_requirement: values.visa_sponsorship,
          description: values.description.trim(),
          locations: values.location,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingJobId);

      if (updateError) throw new Error("Failed to update public job feed.");
    } else {
      // Handle activation for brand new listings
      const { error: activateError } = await supabase
        .from("job_postings")
        .update({ status: "active" })
        .eq("id", new_posting.id);

      if (activateError) throw activateError;

      if (!new_posting.job_id) {
        // Create the public entry for the first time
        const { data: insertedJob, error: insertError } = await supabase
          .from("all_jobs")
          .insert({
            locations: new_posting.location,
            job_type: new_posting.job_type,
            job_name: new_posting.title,
            description: new_posting.description,
            visa_requirement: new_posting.visa_sponsorship,
            salary_range: new_posting.salary_range,
            salary_min: new_posting.min_salary,
            salary_max: new_posting.max_salary,
            experience_min: new_posting.min_experience,
            experience_max: new_posting.max_experience,
            equity_range: new_posting.equity_range,
            equity_min: new_posting.min_equity,
            equity_max: new_posting.max_equity,
            experience: new_posting.experience,
            company_url: new_posting.company_info?.website,
            company_name: new_posting.company_info?.name,
            platform: "gethired",
          })
          .select("id")
          .single();

        if (insertError) throw insertError;

        // Map the new public job_id back to our internal posting
        await supabase
          .from("job_postings")
          .update({ job_id: insertedJob.id })
          .eq("id", new_posting.id);
      }
    }

    // Ensure the jobs feed is refreshed across the site
    // revalidatePath("/jobs");

    return { success: true, isUpdate: !!existingPostingId };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}
