import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  refreshProfileAfterChange,
  type ProfileRefreshOutcome,
} from "@/helpers/user/queue-profile-refresh";

export type SetPrimaryResumeResult =
  | { success: true; refresh: ProfileRefreshOutcome | "unchanged"; error?: undefined }
  | { success: false; error: string };

/**
 * Makes `resumeId` the user's primary resume, in one statement
 * (set_primary_resume), then refreshes their embedding and matches, which read
 * the primary resume. Shared by `setPrimaryResumeAction`, the agent and MCP.
 * `user` must come from the session or tool context, never from input.
 */
export async function setPrimaryResume(
  user: { id: string },
  resumeId: string,
): Promise<SetPrimaryResumeResult> {
  try {
    const { data, error } = await createServiceRoleClient().rpc("set_primary_resume", {
      p_user_id: user.id,
      p_resume_id: resumeId,
    });
    if (error) throw error;

    const outcome = data as { ok: boolean; changed?: boolean; reason?: string } | null;
    if (!outcome?.ok) {
      return {
        success: false,
        error: outcome?.reason === "resume_not_found" ? "Resume not found." : "Could not update the resume.",
      };
    }
    // Already the primary: nothing the matches read has changed.
    if (!outcome.changed) return { success: true, refresh: "unchanged" };

    return { success: true, refresh: await refreshProfileAfterChange(user.id) };
  } catch (err) {
    await eventCaptureServerException({
      error: err,
      distinctId: user.id,
      properties: {
        flow: "set_primary_resume",
        resume_id: resumeId,
      },
    });
    return { success: false, error: "Could not update the primary resume. Please try again." };
  }
}
