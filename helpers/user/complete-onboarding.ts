import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/utils/types/database.types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { setUserAppMetadata } from "@/helpers/user/set-app-metadata";
import { describeProfileError, onboardingProfileSchema } from "./onboarding-profile";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Completes applicant onboarding, shared by the /get-started form and the
 * agent's completeOnboarding tool (REQ-019). `user` must come from the
 * session or tool context, never from input. Validation and ownership
 * failures are returned; database errors are thrown.
 */
export async function completeApplicantOnboarding(
  supabase: SupabaseClient<Database>,
  user: { id: string; email?: string | null },
  input: unknown,
  { resumeId, shouldParse }: { resumeId: string; shouldParse: boolean },
): Promise<Result> {
  const parsed = onboardingProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: describeProfileError(parsed.error) };

  // SEC-010: only the user's own resume can become primary and be processed.
  const { data: resume, error: resumeError } = await supabase
    .from("resumes")
    .select("id")
    .eq("id", resumeId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (resumeError) throw resumeError;
  if (!resume) return { ok: false, error: "Resume not found." };

  // Sign-up creates the row, so this is an update: never an insert.
  const { data: updated, error: profileError } = await supabase
    .from("user_info")
    .update({
      ...parsed.data,
      ...(user.email ? { email: user.email } : {}),
      filled: true,
      // The pipeline is queued, not run yet: show matches as being generated
      // (and stop the jobs page offering a second, parallel generation).
      relevant_jobs_update_status: "progress",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select("user_id");
  if (profileError) throw profileError;
  if (!updated || updated.length === 0) return { ok: false, error: "Profile not found." };

  const { error: unsetError } = await supabase
    .from("resumes")
    .update({ is_primary: false })
    .eq("user_id", user.id);
  if (unsetError) throw unsetError;

  const { error: primaryError } = await supabase
    .from("resumes")
    .update({ is_primary: true })
    .eq("id", resumeId)
    .eq("user_id", user.id);
  if (primaryError) throw primaryError;

  const { error: queueError } = await createServiceRoleClient()
    .schema("pgmq_public")
    .rpc("send", {
      queue_name: "onboarding_pipeline",
      message: { userId: user.id, resumeId, shouldParse },
    });
  if (queueError) {
    // Nothing will process the profile: roll back to "not onboarded" so the
    // form or the agent can simply retry (completeOnboarding refuses filled
    // profiles), instead of leaving it stuck at "progress".
    await supabase
      .from("user_info")
      .update({ filled: false, relevant_jobs_update_status: "pending" })
      .eq("user_id", user.id);
    throw queueError;
  }

  // Only the flag: the account type is set at sign-up and never changed here.
  const { error: metadataError } = await setUserAppMetadata(user.id, {
    onboarding_complete: true,
  });
  if (metadataError) return { ok: false, error: metadataError };

  return { ok: true };
}
