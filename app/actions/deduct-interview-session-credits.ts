"use server";

import { createClient } from "@/lib/supabase/server";

export async function deductInterviewSessionCreditsAction(
  interviewId: string,
  sessionId: string,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      success: false as const,
      error: "Authentication required. Please sign in and try again.",
    };
  }

  if (
    typeof interviewId !== "string" ||
    !interviewId ||
    typeof sessionId !== "string" ||
    !sessionId
  ) {
    return {
      success: false as const,
      error: "Missing interview or voice session identifier.",
    };
  }

  const { data, error } = await supabase.rpc(
    "deduct_interview_session_credits",
    {
      p_interview_id: interviewId,
      p_session_id: sessionId,
    },
  );

  if (error) {
    // console.error("[INTERVIEW_CREDIT_DEDUCTION_ERROR]:", error);
    return {
      success: false as const,
      error: error.message.includes("Insufficient AI credits")
        ? "Insufficient AI credits to start this interview."
        : "Unable to confirm interview credits. Please try again.",
    };
  }

  return {
    success: true as const,
    alreadyCharged: data === "already_charged",
  };
}
