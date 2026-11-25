import "server-only";
import { JOB_ALERT_COPY, type JobAlertFailure, type JobAlertsContext } from "@/helpers/job-alerts/alerts";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The job alert actions' context: the session's applicant and the service
 * role (the derived columns are server-written; every query filters
 * `user_id`). Not a server action itself.
 */
export async function requireAlertSession(): Promise<
  { ok: true; ctx: JobAlertsContext } | JobAlertFailure
> {
  const user = await getUserFromRequest();
  if (!user) return { ok: false, reason: "bad_input", error: JOB_ALERT_COPY.signIn };
  if (user.app_metadata?.type !== "applicant") {
    return { ok: false, reason: "bad_input", error: JOB_ALERT_COPY.applicantsOnly };
  }
  return { ok: true, ctx: { userId: user.id, supabase: createServiceRoleClient() } };
}
