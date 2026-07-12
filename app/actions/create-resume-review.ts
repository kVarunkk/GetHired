"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/utils/types";
import { uploadResumeAction } from "./upload-resume-file";
import { randomUUID } from "crypto";

export async function createResumeReviewAction(formData: FormData) {
  const supabase = await createClient();
  const reviewName =
    (formData.get("name") as string) || `Review ${randomUUID().slice(0, 8)}`;
  const existingResumeId = formData.get("existingResumeId") as string | null;
  const file = formData.get("file") as File | null;
  const jobId = formData.get("jobId") as string | null;
  let jobDescription = null;

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Authentication required." };
  }

  const userId = user.id;

  try {
    if (jobId) {
      const { data: jobData } = await supabase
        .from("all_jobs")
        .select("description")
        .eq("id", jobId)
        .single();

      if (!jobData?.description) {
        return { error: "Job description not found for the provided job." };
      }

      jobDescription = jobData.description;
    }

    const { data: profile } = await supabase
      .from("user_info")
      .select("ai_credits")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      return {
        error:
          "User profile not found. Please complete your profile to create a CV review.",
      };
    }

    if ((profile.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME) {
      return {
        error: `Insufficient AI credits (${TAICredits.AI_SEARCH_ASK_AI_RESUME} required).`,
      };
    }

    let finalResumeId = existingResumeId;

    if (!finalResumeId && file && file.size > 0) {
      const result = await uploadResumeAction(formData);
      if (result.success && result.resumeId) {
        finalResumeId = result.resumeId;
      }
      if (result.error) throw result.error;
    }

    const { data: reviewEntry, error: reviewError } = await supabase
      .from("resume_reviews")
      .insert({
        user_id: userId,
        resume_id: finalResumeId ?? null,
        status: "draft",
        name: reviewName,
        job_id: jobId ?? null,
        target_jd: jobDescription,
      })
      .select("id")
      .single();

    if (reviewError) throw reviewError;

    revalidatePath("/resume-review");

    return { success: true, reviewId: reviewEntry.id };
  } catch (err: unknown) {
    console.error("[CREATE_REVIEW_ACTION_ERROR]:", err);
    return {
      error:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
