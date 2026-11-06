"use server";

import { createClient } from "@/lib/supabase/server";
import { createResumeReview } from "@/helpers/resume-review/create-resume-review";
import { uploadResumeAction } from "./upload-resume-file";

export async function createResumeReviewAction(
  formData: FormData,
): ReturnType<typeof createResumeReview> {
  const supabase = await createClient();
  const file = formData.get("file") as File | null;

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "Authentication required." };
  }

  return createResumeReview(supabase, user, {
    name: formData.get("name") as string | null,
    resumeId: formData.get("existingResumeId") as string | null,
    jobId: formData.get("jobId") as string | null,
    upload: file && file.size > 0 ? () => uploadResumeAction(formData) : undefined,
  });
}
