"use server";

import { createClient } from "@/lib/supabase/server";
import { createInterview } from "@/helpers/interview/create-interview";

export async function createInterviewAction(
  interviewName: string | null,
  resumeId: string,
  jobId: string,
) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Authentication required." };
  }

  return createInterview(supabase, user, { name: interviewName, resumeId, jobId });
}
