"use server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  buildEquityRange,
  buildExperience,
  deploymentUrl,
  INTERNAL_API_SECRET,
} from "@/utils/serverUtils";
import { ICreateJobPostingFormData } from "@/utils/types";
import { triggerJobPostingRelevanceUpdate } from "./relevant-profiles-update";
import { revalidateTag } from "next/cache";
import { buildSalaryRange } from "@/utils/buildSalaryRange";

/**
 * SERVER ACTION: upsertJobPostingAction
 * Orchestrates the database logic across 'job_postings' and 'all_jobs' tables.
 */

// status for new job posting is INACTIVE

export async function upsertJobPostingAction(params: {
  values: ICreateJobPostingFormData;
  companyId: string;
  existingPostingId?: string;
  existingJobId?: string | null;
}) {
  const baseUrl = deploymentUrl();

  const { values, companyId, existingPostingId, existingJobId } = params;
  const supabase = createServiceRoleClient();

  const salary_range = buildSalaryRange(
    values.min_salary,
    values.max_salary,
    values.salary_currency,
  );
  const equity_range = buildEquityRange(values.min_equity, values.max_equity);
  const experience = buildExperience(
    values.min_experience,
    values.max_experience,
  );

  let embedding = null;

  try {
    const { data: companyData, error: companyError } = await supabase
      .from("company_info")
      .select("job_posts_created, company_tiers(allowed_job_posts)")
      .eq("id", companyId)
      .single();

    if (!companyData || companyError)
      throw new Error(companyError.message || "Error fetching company data.");

    if (
      companyData?.company_tiers?.allowed_job_posts !== null &&
      companyData?.job_posts_created >=
        (companyData?.company_tiers?.allowed_job_posts || 0)
    ) {
      throw new Error(
        "You are not allowed to create more than " +
          companyData?.company_tiers?.allowed_job_posts +
          " job posts in your current plan. Please contact support for an upgrade.",
      );
    }

    const payload = {
      company_id: companyId,
      ...values,
      salary_range,
      equity_range,
      experience,
      questions: values.questions?.filter((q: string) => q.trim() !== "") || [],
      updated_at: new Date().toISOString(),
    };

    if (existingPostingId) {
      payload.id = existingPostingId;
    }

    // 1. Update the primary job_postings record
    const { data: new_posting, error: postingError } = await supabase
      .from("job_postings")
      .upsert(payload, { onConflict: "id" })
      .select("*, company_info(website, name, id)")
      .single();

    if (postingError || !new_posting) throw postingError;

    // record already exists in the job_postings table
    if (existingPostingId) {
      // updates embedding of job_postings record
      const embeddingResult = await fetch(
        `${baseUrl}/api/update-embedding/gemini/job`,
        {
          method: "POST",
          headers: {
            "X-Internal-Secret": INTERNAL_API_SECRET,
          },
          body: JSON.stringify({
            id: existingPostingId,
            job_name: values.title.trim(),
            locations: values.location,
            description: values.description,
            job_type: values.job_type,
            salary_range,
            table: "job_postings",
          }),
        },
      );

      if (!embeddingResult.ok) {
        const errorData = await embeddingResult.json();
        return {
          success: false,
          error: errorData.error,
        };
      }

      embedding = (await embeddingResult.json()).data;
    }

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
          embedding_new: embedding,
        })
        .eq("id", existingJobId);

      if (updateError) throw new Error("Failed to update public job feed.");

      revalidateTag(`job-${existingJobId}`);
    } else {
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
            experience_min: new_posting.min_experience ?? undefined,
            experience_max: new_posting.max_experience,
            equity_range: new_posting.equity_range,
            equity_min: new_posting.min_equity,
            equity_max: new_posting.max_equity,
            experience: new_posting.experience,
            company_url: "/companies/" + new_posting.company_info?.id,
            company_name: new_posting.company_info?.name,
            platform: "gethired",
            status: "inactive",
          })
          .select("id")
          .single();

        if (insertError) throw insertError;

        // Map the new public job_id back to our internal posting
        await supabase
          .from("job_postings")
          .update({ job_id: insertedJob.id })
          .eq("id", new_posting.id);

        await supabase.from("company_info").update({
          job_posts_created: (companyData?.job_posts_created || 0) + 1,
        });
      }
    }

    // if the job posting is updated and the status is active then trigger profile relevance update
    if (new_posting.status === "active") {
      await supabase
        .from("job_postings")
        .update({
          matching_status: "progress",
          matching_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", new_posting.id);
      triggerJobPostingRelevanceUpdate(new_posting.id);
    }

    return { success: true, isUpdate: !!existingPostingId };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error occurred while processing job post.",
    };
  }
}
