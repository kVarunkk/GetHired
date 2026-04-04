"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/utils/types";
import { uploadResumeAction } from "./upload-resume-file";

export async function createResumeReviewAction(formData: FormData) {
  const supabase = await createClient();
  const reviewName =
    (formData.get("name") as string) ||
    `Review ${new Date().toLocaleDateString()}`;
  const existingResumeId = formData.get("existingResumeId") as string | null;
  const file = formData.get("file") as File | null;
  const jobId = formData.get("jobId") as string | null;

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Authentication required." };
  }

  const userId = user.id;

  try {
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

    if ((profile.ai_credits || 0) < TAICredits.AI_CV_REVIEW) {
      return {
        error: `Insufficient AI credits (${TAICredits.AI_CV_REVIEW} required).`,
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
