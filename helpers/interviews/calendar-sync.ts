import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { loadEventDetails } from "@/helpers/calendar/events";
import { isCalendarError, type CalendarProvider } from "@/helpers/calendar/provider";
import { withCalendarAuth } from "@/helpers/calendar/tokens";

type Admin = SupabaseClient<Database>;

/** Upcoming booked interviews looked at per run. */
export const SYNC_BATCH = 200;

export type CalendarSyncSummary = {
  completed: number;
  checked: number;
  moved: number;
  cancelled: number;
  responses: number;
  /** Organizer disconnected, or their grant just died: nothing to read. */
  skipped: number;
  expired: number;
  failures: string[];
};

const RESPONSES = new Set(["needs_action", "accepted", "declined", "tentative"]);

/**
 * IVT-046 (IV-REQ-024/025), every 15 minutes with the service role:
 * - completes `scheduled` interviews 15 minutes after they end;
 * - reads each upcoming booked interview's Google event with its organizer's
 *   token: moved there → moved here (`meeting_rescheduled`, source
 *   `calendar`), deleted there → cancelled here, and the panel's answers;
 * - cancels self-scheduling links past their expiry (phase 3 rows).
 * One interview's failure doesn't stop the batch. The RPCs ignore a change
 * that's already applied, so a second run is a no-op.
 */
export async function syncCalendarInterviews(
  admin: Admin,
  provider: CalendarProvider,
  now = new Date(),
): Promise<CalendarSyncSummary> {
  const summary: CalendarSyncSummary = {
    completed: 0,
    checked: 0,
    moved: 0,
    cancelled: 0,
    responses: 0,
    skipped: 0,
    expired: 0,
    failures: [],
  };

  const done = await admin.rpc("complete_due_interviews", { p_limit: SYNC_BATCH });
  if (done.error) summary.failures.push(`complete_due_interviews: ${done.error.message}`);
  else summary.completed = done.data?.length ?? 0;

  const { data: rows, error } = await admin
    .from("scheduled_interviews")
    .select("id")
    .eq("status", "scheduled")
    .not("provider_event_id", "is", null)
    .gt("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(SYNC_BATCH);
  if (error) summary.failures.push(`listing interviews: ${error.message}`);

  for (const { id } of rows ?? []) {
    summary.checked += 1;
    try {
      await syncOne(admin, provider, id, summary);
    } catch (err) {
      if (isCalendarError(err, "invalid_grant")) {
        // tokens.ts marked the connection and emailed the organizer.
        summary.skipped += 1;
      } else {
        summary.failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const expired = await admin.rpc("expire_interview_links", { p_limit: SYNC_BATCH });
  if (expired.error) summary.failures.push(`expire_interview_links: ${expired.error.message}`);
  else summary.expired = expired.data?.length ?? 0;

  return summary;
}

async function syncOne(admin: Admin, provider: CalendarProvider, id: string, summary: CalendarSyncSummary) {
  const details = await loadEventDetails(admin, id);
  if (!details || details.status !== "scheduled" || !details.provider_event_id) return;
  const connectionId = details.organizer_connection_id;
  if (!connectionId) {
    summary.skipped += 1;
    return;
  }
  const eventId = details.provider_event_id;
  const event = await withCalendarAuth(admin, connectionId, (token) => provider.getEvent(token, eventId));

  if (!event) {
    const { data, error } = await admin.rpc("cancel_interview_as_system", { p_id: id, p_reason: "calendar" });
    if (error) throw new Error(`cancel: ${error.message}`);
    if ((data as { applied?: boolean } | null)?.applied) summary.cancelled += 1;
    return;
  }

  const sameTime =
    details.starts_at && details.ends_at
      ? Date.parse(details.starts_at) === Date.parse(event.start) && Date.parse(details.ends_at) === Date.parse(event.end)
      : false;
  if (!sameTime) {
    const { data, error } = await admin.rpc("move_interview_from_calendar", {
      p_id: id,
      p_starts_at: new Date(event.start).toISOString(),
      p_ends_at: new Date(event.end).toISOString(),
    });
    if (error) throw new Error(`move: ${error.message}`);
    if ((data as { applied?: boolean } | null)?.applied) summary.moved += 1;
  }

  const answers = new Map(event.attendees.map((a) => [a.email.toLowerCase(), a.response]));
  for (const member of details.panel) {
    const answer = member.email ? answers.get(member.email.toLowerCase()) : undefined;
    if (!answer || !RESPONSES.has(answer) || answer === member.response) continue;
    const { error } = await admin
      .from("scheduled_interview_panel")
      .update({ response: answer })
      .eq("interview_id", id)
      .eq("user_id", member.user_id);
    if (error) throw new Error(`panel response: ${error.message}`);
    summary.responses += 1;
  }
}
