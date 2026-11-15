import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { reportError } from "@/helpers/posthog/report-error";
import { eventInputOf, loadEventDetails } from "@/helpers/calendar/events";
import { isCalendarError, type CalendarProvider } from "@/helpers/calendar/provider";
import { withCalendarAuth } from "@/helpers/calendar/tokens";

type Admin = SupabaseClient<Database>;

export const CALENDAR_OPS_QUEUE = "interview_calendar_ops";
/** The read that gives up and reports (IV-REQ-023a). */
export const CALENDAR_OPS_MAX_READS = 5;
/** Long enough for a batch of Google calls; a failed message comes back after it. */
const VISIBILITY_TIMEOUT = 120;
const BATCH_SIZE = 20;

/** Sent by `queue_interview_calendar_op`. */
export type CalendarOpMessage = {
  op: "delete" | "update";
  interview_id: string;
  company_id: string;
  organizer_user_id: string | null;
  provider_event_id: string;
};

type QueueMessage = { msg_id: number; read_ct: number; message: CalendarOpMessage };

export type CalendarOpsResult = { done: number; dropped: number; retrying: number; gaveUp: string[] };

/**
 * IVT-047: runs the Google event changes that were queued (a delete that
 * failed on cancel; later, phase 4's stage-move cancellations). The
 * interview is read again at run time: an update for an interview that's no
 * longer scheduled, an event that's already gone, or an organizer who
 * disconnected is dropped. A failure stays in the queue until
 * `CALENDAR_OPS_MAX_READS`, then gives up.
 */
export async function processCalendarOps(admin: Admin, provider: CalendarProvider): Promise<CalendarOpsResult> {
  const queue = admin.schema("pgmq_public");
  const { data, error } = await queue.rpc("read", {
    queue_name: CALENDAR_OPS_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) throw new Error(`Couldn't read the calendar ops queue: ${error.message}`);
  const result: CalendarOpsResult = { done: 0, dropped: 0, retrying: 0, gaveUp: [] };

  const archive = async (msgId: number) => {
    const { error: archiveError } = await queue.rpc("archive", { queue_name: CALENDAR_OPS_QUEUE, message_id: msgId });
    if (archiveError) reportError(`[calendar ops] couldn't archive ${msgId}`, archiveError.message);
  };

  for (const { msg_id, read_ct, message } of (data ?? []) as QueueMessage[]) {
    try {
      const outcome = await runOp(admin, provider, message);
      result[outcome] += 1;
      await archive(msg_id);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      if (read_ct >= CALENDAR_OPS_MAX_READS) {
        result.gaveUp.push(`${message.op} ${message.interview_id}: ${why}`);
        await archive(msg_id);
      } else {
        result.retrying += 1;
      }
    }
  }
  return result;
}

async function runOp(admin: Admin, provider: CalendarProvider, message: CalendarOpMessage): Promise<"done" | "dropped"> {
  const details = await loadEventDetails(admin, message.interview_id);
  const connectionId = details?.organizer_connection_id;
  if (!details || !connectionId) return "dropped";
  if (message.op === "update" && (details.status !== "scheduled" || !details.provider_event_id)) return "dropped";

  try {
    await withCalendarAuth(admin, connectionId, async (token) => {
      if (message.op === "delete") return provider.deleteEvent(token, message.provider_event_id);
      const input = eventInputOf(details);
      return provider.updateEvent(token, details.provider_event_id!, {
        start: input.start,
        end: input.end,
        timeZone: input.timeZone,
        attendees: input.attendees,
      });
    });
    return "done";
  } catch (err) {
    // Gone already (404/410): nothing left to change. A dead grant can't be retried.
    if (isCalendarError(err, "not_found") || isCalendarError(err, "invalid_grant")) return "dropped";
    throw err;
  }
}
