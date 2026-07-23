"use server";

import { after } from "next/server";
import { createClient } from "../../lib/supabase/server";
import { parseResume } from "@/helpers/resume/parse-resume";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";

export async function retryResumeParsingAction(resumeId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  try {
    const { error: resetError } = await supabase
      .from("resumes")
      .update({
        parsing_failed: false,
        content: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumeId)
      .eq("user_id", user.id);

    if (resetError) throw resetError;

    after(async () => {
      try {
        await parseResume(user.id, resumeId);
      } catch (err) {
        await eventCaptureServerException({
          error: err,
          distinctId: user.id,
          properties: { flow: "retry_resume_parsing_after_block" },
        });
      }
    });

    return { success: true };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while retrying resume parsing.";
    await eventCaptureServerException({
      error: err,
      distinctId: user.id,
      properties: { flow: "retry_resume_parsing" },
    });

    return {
      error,
    };
  }
}
