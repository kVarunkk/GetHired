import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { TAICredits } from "@/utils/types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

/**
 * Creates a practice interview for a job. Shared by `createInterviewAction`,
 * the agent and MCP; `user` must come from the session or tool context.
 * Nothing is charged here: each session charges when it starts.
 */
export async function createInterview(
  supabase: SupabaseClient<Database>,
  user: { id: string },
  { name, resumeId, jobId }: { name: string | null; resumeId: string; jobId: string },
): Promise<
  { success: true; interviewId: string; error?: undefined } | { success?: undefined; error: string }
> {
  const normalizedInterviewName = name || `AI Interview ${randomUUID().slice(0, 8)}`;
  const userId = user.id;

  try {
    const { data: profile } = await supabase
      .from("user_info")
      .select("filled, ai_credits")
      .eq("user_id", userId)
      .single();

    if (!profile) {
      return {
        error:
          "User profile not found. Please complete your profile to create an interview.",
      };
    }

    if (!profile.filled) {
      return {
        error:
          "User profile is incomplete. Please complete onboarding to use this feature.",
      };
    }

    if ((profile.ai_credits || 0) < TAICredits.AI_INTERVIEW) {
      return {
        error: `Insufficient AI credits (${TAICredits.AI_INTERVIEW} required).`,
      };
    }

    const { data: jobsData } = await supabase
      .from("all_jobs")
      .select("id")
      .eq("id", jobId)
      .single();

    if (!jobsData) {
      return {
        error: "Job not found. Please provide a valid job URL.",
      };
    }

    const { data: interviewData, error: interviewError } = await supabase
      .from("interviews")
      .insert({
        user_id: userId,
        resume_id: resumeId,
        name: normalizedInterviewName,
        job_id: jobId ?? null,
      })
      .select("id")
      .single();

    if (interviewError) throw interviewError;

    revalidatePath("/interviews");

    return { success: true, interviewId: interviewData.id };
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while creating interview.";
    await eventCaptureServerException({
      error: err,
      distinctId: userId,
      properties: { flow: "create_interview" },
    });
    return {
      error,
    };
  }
}
