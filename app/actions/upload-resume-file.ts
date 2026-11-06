"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { resumeFromUpload } from "@/helpers/resumes/resume-from-upload";
import { createClient } from "@/lib/supabase/server";

const MISSING_DATA = { error: "Missing required upload data." };

/**
 * Parses an uploaded resume in the request and returns the saved resume
 * (RE-REQ-011). The file is never stored. `replaceResumeId` overwrites one of
 * the user's resumes instead of adding one (RE-REQ-021).
 */
export async function uploadResumeAction(
  formData: FormData,
): Promise<{ success?: boolean; resumeId?: string; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Authentication required." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return MISSING_DATA;

  const replace = formData.get("replaceResumeId");
  if (replace !== null && !z.string().uuid().safeParse(replace).success) return MISSING_DATA;

  try {
    const result = await resumeFromUpload(
      supabase,
      user,
      file,
      replace ? { replaceResumeId: replace as string } : {},
    );
    if (!result.ok) return { error: result.error };

    revalidatePath("/resume");
    return { success: true, resumeId: result.resumeId };
  } catch (err: unknown) {
    await eventCaptureServerException({
      error: err,
      distinctId: user.id,
      properties: { flow: "upload_resume_file" },
    });
    return { error: "We couldn't save this resume. Please try again." };
  }
}
