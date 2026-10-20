import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

export const APPLICATION_SCREENING_QUEUE = "application_screening_queue";

/** The same shape the `applications_enqueue_screening` trigger sends. */
export type ApplicationScreeningMessage = { application_id: string };

/**
 * Sends one screening message per application, in a single `send_batch`, so
 * a job with hundreds of applicants is one round trip. Throws if the send
 * fails.
 */
export async function sendScreeningMessages(
  admin: SupabaseClient<Database>,
  applicationIds: string[],
): Promise<void> {
  if (applicationIds.length === 0) return;
  const messages: ApplicationScreeningMessage[] = applicationIds.map((id) => ({ application_id: id }));
  const { error } = await admin.schema("pgmq_public").rpc("send_batch", {
    queue_name: APPLICATION_SCREENING_QUEUE,
    messages,
    sleep_seconds: 0,
  });
  if (error) throw new Error(`Couldn't queue screenings: ${error.message}`);
}
