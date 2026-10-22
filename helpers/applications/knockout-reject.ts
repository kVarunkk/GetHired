import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

// AF-REQ-003 / AF-DEC-002: a knockout rule set to reject moves the application
// to the company's Rejected stage right away, with no email. The rejection
// email goes out later from the knockouts worker, so it doesn't look automated.

export const KNOCKOUT_EMAIL_DELAY_MS = 24 * 60 * 60 * 1000;
/** Who the activity timeline shows for the move. Never a person or a role. */
export const KNOCKOUT_ACTOR_NAME = "Application requirements";

/**
 * Moves one new application to the company's first active `rejected` stage
 * with the service role (the pipeline trigger lets it through). Returns false
 * when the company has no such stage or the write fails; the caller then
 * only flags the application.
 */
export async function rejectForKnockout(
  service: SupabaseClient<Database>,
  { applicationId, companyId, candidateUserId }: { applicationId: string; companyId: string; candidateUserId: string },
): Promise<boolean> {
  const { data: stage } = await service
    .from("pipeline_stages")
    .select("id, kind")
    .eq("company_id", companyId)
    .eq("kind", "rejected")
    .eq("archived", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return false;

  const { data: current } = await service
    .from("applications")
    .select("stage_id, pipeline_stages(kind)")
    .eq("id", applicationId)
    .maybeSingle();

  const { error } = await service
    .from("applications")
    .update({ stage_id: stage.id, updated_at: new Date().toISOString() })
    .eq("id", applicationId);
  if (error) {
    reportError("[knockout] couldn't move the application to rejected", error.message);
    return false;
  }

  const { error: eventError } = await service.from("application_events").insert({
    company_id: companyId,
    application_id: applicationId,
    candidate_user_id: candidateUserId,
    actor_user_id: null,
    actor_name: KNOCKOUT_ACTOR_NAME,
    type: "stage_changed",
    payload: {
      from_stage_id: current?.stage_id ?? null,
      to_stage_id: stage.id,
      from_kind: current?.pipeline_stages?.kind ?? null,
      to_kind: "rejected",
      reason: "knockout",
    },
  });
  if (eventError) reportError("[knockout] couldn't log the move", eventError.message);
  return true;
}
