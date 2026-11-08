"use server";

import { createClient } from "@/lib/supabase/server";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { completeApplicantOnboarding } from "@/helpers/user/complete-onboarding";
import { importClaimResume } from "@/helpers/candidates/claim-prefill";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  describeProfileError,
  onboardingProfileSchema,
} from "@/helpers/user/onboarding-profile";

/**
 * The /get-started form's submit. The user always comes from the session
 * (SEC-009); `profileData` is validated and allowlisted by the shared helper,
 * which also marks onboarding complete. Step 6 has already parsed an uploaded
 * resume (RE-REQ-021), so this takes its `resumeId`.
 */
export async function submitOnboardingAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required." };

  const resumeId = formData.get("resumeId") as string | null;
  // BIT-105: the resume a claimed company has on file, imported on submit.
  const claimToken = !resumeId ? (formData.get("claimToken") as string | null) : null;
  if (!resumeId && !claimToken) return { error: "Please upload your resume." };

  // Validate before importing, so a bad profile charges nothing.
  const profileData: unknown = JSON.parse(formData.get("profileData") as string);
  const check = onboardingProfileSchema.safeParse(profileData);
  if (!check.success) return { error: describeProfileError(check.error) };

  try {
    let finalResumeId = resumeId;

    if (claimToken) {
      const imported = await importClaimResume(supabase, createServiceRoleClient(), user, claimToken);
      if (!imported.ok) return { error: imported.error };
      finalResumeId = imported.resumeId;
    }

    const result = await completeApplicantOnboarding(user, profileData, {
      resumeId: finalResumeId!,
      shouldParse: false,
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
