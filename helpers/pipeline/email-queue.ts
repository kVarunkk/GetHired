import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const PIPELINE_EMAIL_QUEUE = "pipeline_email_queue";
/** Reads before the worker gives up on a message. */
export const PIPELINE_EMAIL_MAX_READS = 5;
/**
 * QF-REQ-012: stage emails wait this long in the queue, so a mistaken move
 * that's undone in time never emails (the worker drops a stale message).
 */
export const PIPELINE_EMAIL_UNDO_SECONDS = 120;

/**
 * One stage-move email, rendered at move time. The recipient isn't in it:
 * the worker loads the address from the database when it sends.
 */
export type PipelineEmailMessage = {
  applicationId: string;
  companyId: string;
  candidateUserId: string | null;
  actorUserId: string;
  actorName: string | null;
  templateId: string;
  subject: string;
  body: string;
  companyName: string;
  companyEmail: string | null;
  logoUrl: string | null;
  /**
   * QF-REQ-010/011: where the move put the application, as the DB recorded it.
   * The worker sends only while both still match. Optional only for messages
   * queued before this shipped (QF-REQ-013).
   */
  toStageId?: string;
  stageEnteredAt?: string;
};

/**
 * Queues the messages in one `send_batch` for /api/worker/pipeline-emails,
 * each delayed by `PIPELINE_EMAIL_UNDO_SECONDS`.
 * The service role sends, since pgmq_public isn't open to members. Throws if
 * the send fails.
 */
export async function enqueuePipelineEmails(messages: PipelineEmailMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const { error } = await createServiceRoleClient()
    .schema("pgmq_public")
    .rpc("send_batch", { queue_name: PIPELINE_EMAIL_QUEUE, messages, sleep_seconds: PIPELINE_EMAIL_UNDO_SECONDS });
  if (error) throw new Error(`Couldn't queue the emails: ${error.message}`);
}
