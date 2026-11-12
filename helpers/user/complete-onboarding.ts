import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { updateUserEmbedding } from "@/helpers/user/update-user-embedding";
import { RELEVANCE_TIMEOUT_MS } from "@/helpers/jobs/relevance-jobs-queue";
import { describeProfileError, onboardingProfileSchema } from "./onboarding-profile";

type Result = { ok: true } | { ok: false; error: string };

const REASONS: Record<string, string> = {
  resume_not_found: "Resume not found.",
  profile_not_found: "Profile not found.",
};

/**
 * Completes applicant onboarding, shared by the /get-started form and the
 * agent's completeOnboarding tool (REQ-019). `user` must come from the
 * session or tool context, never from input. Validation and ownership
 * failures are returned; database errors are thrown. `app_metadata` is set
 * after the commit: if that fails the profile is saved and queued, and a
 * retry only has to set the flag again.
 */
export async function completeApplicantOnboarding(
  user: { id: string; email?: string | null },
  input: unknown,
  { resumeId, shouldParse }: { resumeId: string; shouldParse: boolean },
): Promise<Result> {
  const parsed = onboardingProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: describeProfileError(parsed.error) };

  // One transaction (complete_applicant_onboarding): the resume must be the
  // user's (SEC-010), then the profile, the primary resume and the
  // onboarding_pipeline message are written together or not at all. The
  // function is service-role only, so the user id here is the session's.
  const { data, error } = await createServiceRoleClient().rpc("complete_applicant_onboarding", {
    p_user_id: user.id,
    p_resume_id: resumeId,
    p_profile: parsed.data,
    p_email: user.email ?? "",
    p_should_parse: shouldParse,
    p_stale_seconds: RELEVANCE_TIMEOUT_MS / 1000,
  });
  if (error) throw error;
  const outcome = data as { ok: boolean; queued?: boolean; reason?: string } | null;
  if (!outcome?.ok) {
    return { ok: false, error: REASONS[outcome?.reason ?? ""] ?? "We couldn't save your profile. Please try again." };
  }
  // A resubmit while a run is still going queues nothing now: that run queues
  // a follow-up when it ends. Embed here so search sees the profile meanwhile.
  if (outcome.queued === false) await updateUserEmbedding(user.id);

  // Only the flag: the account type is set at sign-up and never changed here.
  const { error: metadataError } = await setUserAppMetadata(user.id, {
    onboarding_complete: true,
  });
  if (metadataError) return { ok: false, error: metadataError };

  return { ok: true };
}
