import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export type FitThresholdInviteResult = { invited: true; id: string } | { invited: false; reason: string };

/**
 * SI-REQ-010: after an MT screening completes, invite the applicant when the
 * job's interview is on with the fit-threshold rule and the score reaches
 * it. System work: no actor, so the interview_minutes hold isn't capped per
 * member. The RPC queues the invite email. A re-screen never invites twice (one interview per application).
 * Never throws: a failed invite mustn't fail the screening. When the
 * allowance is out nobody is invited; the job page derives its banner from
 * screened-above-the-bar applications without an interview.
 */
export async function inviteAboveFitThreshold(
  admin: SupabaseClient<Database>,
  { applicationId, jobPostId, fitScore }: { applicationId: string; jobPostId: string; fitScore: number },
): Promise<FitThresholdInviteResult> {
  try {
    const { data: config } = await admin
      .from("job_interview_configs")
      .select("enabled, invite_rule, fit_threshold")
      .eq("job_post_id", jobPostId)
      .maybeSingle();
    if (!config?.enabled || config.invite_rule !== "fit_threshold" || config.fit_threshold === null) {
      return { invited: false, reason: "disabled" };
    }
    if (fitScore < config.fit_threshold) return { invited: false, reason: "below_threshold" };

    const { data, error } = await admin.rpc("create_screening_invite", {
      p_application_id: applicationId,
      p_via: "fit_threshold",
    });
    const result = data as { ok: boolean; id?: string; reason?: string } | null;
    if (error || !result) {
      reportError("[screening] fit-threshold invite failed", applicationId, error?.message);
      return { invited: false, reason: "failed" };
    }
    if (!result.ok || !result.id) {
      const reason = result.reason ?? "failed";
      if (reason === "insufficient_credits" || reason === "member_limit") {
        console.warn("[screening] fit-threshold invite skipped: no interview minutes", applicationId);
      }
      return { invited: false, reason };
    }

    return { invited: true, id: result.id };
  } catch (err) {
    reportError("[screening] fit-threshold invite threw", applicationId, err);
    return { invited: false, reason: "failed" };
  }
}
