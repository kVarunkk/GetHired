import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { TAICredits } from "@/utils/types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

type CreateResumeReviewInput = {
  name?: string | null;
  /** The user's existing resume to review. */
  resumeId?: string | null;
  jobId?: string | null;
  /**
   * Uploads a new resume when there's no `resumeId`, after the job and credit
   * checks pass. Only the web form has a file; the agent and MCP never do.
   */
  upload?: () => Promise<{ success?: boolean; resumeId?: string; error?: unknown }>;
};

/**
 * Creates a draft resume review. Shared by `createResumeReviewAction`, the
 * agent and MCP; `user` must come from the session or tool context. It checks
 * the user has enough credits but doesn't charge them: the analysis does.
 */
export async function createResumeReview(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { name, resumeId, jobId, upload }: CreateResumeReviewInput,
): Promise<
  { success: true; reviewId: string; error?: undefined } | { success?: undefined; error: string }
> {
  const reviewName = name || `Review ${randomUUID().slice(0, 8)}`;
  let jobDescription = null;
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

    let finalResumeId = resumeId;

    if (!finalResumeId && upload) {
      const result = await upload();
      if (result.success && result.resumeId) {
        finalResumeId = result.resumeId;
      }
      // RE-REQ-017: the parse runs in the request, so the user sees why it failed.
      if (result.error) return { error: String(result.error) };
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
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while creating resume review.";
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "create_resume_review" },
    });
    return {
      error,
    };
  }
}
