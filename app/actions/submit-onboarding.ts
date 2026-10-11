"use server";

import { createClient } from "@/lib/supabase/server";
import { TAICredits } from "@/utils/types";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { completeApplicantOnboarding } from "@/helpers/user/complete-onboarding";
import {
  describeProfileError,
  onboardingProfileSchema,
} from "@/helpers/user/onboarding-profile";

/**
 * The /get-started form's submit. The user always comes from the session
 * (SEC-009); `profileData` is validated and allowlisted by the shared helper,
 * which also marks onboarding complete.
 */
export async function submitOnboardingAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const resumeId = formData.get("resumeId") as string | null;
  const resumeFile = formData.get("resumeFile") as File | null;
  const hasFile = !!resumeFile && resumeFile.size > 0;
  if (!hasFile && !resumeId) return { error: "Please upload your resume." };

  // Validate before uploading, so a bad profile leaves no orphaned file.
  const profileData: unknown = JSON.parse(formData.get("profileData") as string);
  const check = onboardingProfileSchema.safeParse(profileData);
  if (!check.success) return { error: describeProfileError(check.error) };

  const { data: profile } = await supabase
    .from("user_info")
    .select("ai_credits")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    return {
      error:
        "User profile not found. Please complete your profile to upload a resume.",
    };
  }

  if ((profile.ai_credits || 0) < TAICredits.AI_SEARCH_ASK_AI_RESUME && hasFile) {
    return {
      error: `Insufficient AI credits for resume upload. Please top up to continue.`,
    };
  }

  try {
    let finalResumeId = resumeId;

    if (hasFile) {
      const fileName = `resumes/${user.id}/${Date.now()}-${resumeFile.name.replace(/\s+/g, "_")}`;
      const arrayBuffer = await resumeFile.arrayBuffer();
      const { error: storageError } = await supabase.storage
        .from("resumes")
        .upload(fileName, Buffer.from(arrayBuffer), {
          contentType: "application/pdf",
        });
      if (storageError) throw storageError;

      // The helper makes it the primary resume.
      const { data: newResume, error: resError } = await supabase
        .from("resumes")
        .insert({
          user_id: user.id,
          name: resumeFile.name,
          resume_path: fileName,
          is_primary: false,
          content: null,
        })
        .select("id")
        .single();
      if (resError) throw resError;
      finalResumeId = newResume.id;
    }

    const result = await completeApplicantOnboarding(supabase, user, profileData, {
      resumeId: finalResumeId!,
      shouldParse: hasFile,
    });
    if (!result.ok) return { error: result.error };

    return { success: true };
  } catch (err: unknown) {
    const error =
      err instanceof Error
        ? err.message
        : "An unexpected error occurred while saving profile information.";
    await eventCaptureServerException({
      error: err,
      distinctId: user.id,
      properties: { flow: "submit_onboarding" },
    });
    return { error };
  }
}
