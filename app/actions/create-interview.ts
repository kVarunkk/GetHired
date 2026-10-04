"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/utils/types";
import { randomUUID } from "crypto";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

export async function createInterviewAction(
  interviewName: string | null,
  resumeId: string,
  jobId: string,
) {
  const supabase = await createClient();
  const normalizedInterviewName =
    interviewName || `AI Interview ${randomUUID().slice(0, 8)}`;

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

    const {data: jobsData} = await supabase
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
