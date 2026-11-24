import "server-only";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PostHogEvent } from "@/utils/types";
import { verifyAlertPauseToken } from "./pause-token";

export type PauseFromEmailResult = { ok: true; alreadyPaused: boolean } | { ok: false };

/** The alert a pause link names, for the confirmation page. Null for a bad token or a deleted alert. */
export async function loadAlertForPause(token: string): Promise<{ id: string; name: string; on: boolean } | null> {
  const alertId = verifyAlertPauseToken(token);
  if (!alertId) return null;
  const { data } = await createServiceRoleClient()
    .from("bookmarks")
    .select("id, name, is_alert_on")
    .eq("id", alertId)
    .maybeSingle();
  return data ? { id: data.id, name: data.name, on: data.is_alert_on } : null;
}

/**
 * JA-REQ-036: pauses the alert a signed link names, without a login. The
 * token is the only authority, so this goes through the service role and
 * only ever sets `is_alert_on = false` on that one alert. Idempotent.
 */
export async function pauseAlertFromEmail(token: string, via: "page" | "one_click"): Promise<PauseFromEmailResult> {
  const alertId = verifyAlertPauseToken(token);
  if (!alertId) return { ok: false };

  const supabase = createServiceRoleClient();
  const { data: paused, error } = await supabase
    .from("bookmarks")
    .update({ is_alert_on: false })
    .eq("id", alertId)
    .eq("is_alert_on", true)
    .select("id, user_id");
  if (error) throw new Error(`Failed to pause the alert: ${error.message}`);

  if (paused && paused.length > 0) {
    await eventCaptureServer({
      event: PostHogEvent.JobAlertPausedFromEmail,
      distinctId: paused[0].user_id ?? alertId,
      properties: { alert_id: alertId, via },
    });
    return { ok: true, alreadyPaused: false };
  }

  const { data: exists } = await supabase.from("bookmarks").select("id").eq("id", alertId).maybeSingle();
  return exists ? { ok: true, alreadyPaused: true } : { ok: false };
}
