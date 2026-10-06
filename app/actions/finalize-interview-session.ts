"use server";

import { createClient } from "@/lib/supabase/server";

type SessionFinalization = {
  analysisId: string | null;
  sessionId: string;
  status: "completed" | "ineligible";
};

export async function finalizeInterviewSessionAction(
  interviewId: string,
  sessionId: string,
): Promise<{ success: true; result: SessionFinalization } | { success: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Authentication required." };
  }

  const { data: session, error: sessionError } = await supabase
    .from("interview_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("interview_id", interviewId)
    .single();

  if (sessionError || !session) {
    return { success: false, error: "Interview session not found." };
  }

  const { data, error } = await supabase.rpc(
    "finalize_interview_analysis_session",
    { p_session_id: session.id },
  );

  if (error) {
    console.error("[INTERVIEW_ANALYSIS_FINALIZE_ERROR]:", error);
    return { success: false, error: "Unable to finalize interview session." };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { success: false, error: "Invalid session finalization response." };
  }

  const result = data as Record<string, unknown>;
  if (
    result.session_id !== sessionId ||
    (result.status !== "completed" && result.status !== "ineligible") ||
    (result.analysis_id !== null && typeof result.analysis_id !== "string")
  ) {
    return { success: false, error: "Invalid session finalization response." };
  }

  return {
    success: true,
    result: {
      sessionId: result.session_id,
      status: result.status,
      analysisId: result.analysis_id,
    },
  };
}
