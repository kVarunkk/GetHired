"use server";

import { createClient } from "@/lib/supabase/server";

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Authentication required." as const };
  }

  return { supabase };
}

export async function heartbeatInterviewSessionAction(
  interviewId: string,
  sessionId: string,
) {
  if (!interviewId || !sessionId) {
    return {
      status: "error" as const,
      error: "Interview session ID is required.",
    };
  }

  const auth = await getAuthenticatedClient();
  if ("error" in auth) {
    return { status: "error" as const, error: auth.error };
  }

  const { data, error } = await auth.supabase.rpc(
    "heartbeat_interview_session",
    {
      p_interview_id: interviewId,
      p_session_id: sessionId,
    },
  );

  if (error) {
    console.error("[INTERVIEW_SESSION_HEARTBEAT_ERROR]:", error);
    return { status: "error" as const, error: "Session heartbeat failed." };
  }

  return data
    ? { status: "active" as const }
    : { status: "lost" as const, error: "Session lock was lost." };
}

export async function releaseInterviewSessionAction(
  interviewId: string,
  sessionId: string,
) {
  if (!interviewId || !sessionId) {
    return { success: false as const, error: "Interview session ID is required." };
  }

  const auth = await getAuthenticatedClient();
  if ("error" in auth) return { success: false as const, error: auth.error };

  const { data, error } = await auth.supabase.rpc(
    "release_interview_session",
    {
      p_interview_id: interviewId,
      p_session_id: sessionId,
    },
  );

  if (error) {
    console.error("[INTERVIEW_SESSION_RELEASE_ERROR]:", error);
    return { success: false as const, error: "Session lock release failed." };
  }

  return { success: data, error: data ? null : "Session lock was not owned." };
}
