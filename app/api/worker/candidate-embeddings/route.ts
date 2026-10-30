import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { embedMany } from "ai";
import { google } from "@ai-sdk/google";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  CANDIDATE_EMBEDDING_MAX_READS,
  CANDIDATE_EMBEDDING_QUEUE,
  type CandidateEmbeddingMessage,
} from "@/helpers/candidates/embedding-queue";
import {
  candidateEmbeddingText,
  EMBEDDED_CANDIDATE_COLUMNS,
  type EmbeddedCandidate,
} from "@/helpers/candidates/embedding-text";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { INTERNAL_API_SECRET } from "@/utils/formatters";

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  message: Partial<CandidateEmbeddingMessage> | null;
};
type CandidateRow = EmbeddedCandidate & {
  id: string;
  embedding_stale: boolean;
  embedding_updated_at: string | null;
};

/** Long enough for one embedMany call and the writes. */
const VISIBILITY_TIMEOUT = 60;
const BATCH_SIZE = 50;
const SELECT = ["id", "embedding_stale", "embedding_updated_at", ...EMBEDDED_CANDIDATE_COLUMNS].join(", ");

/**
 * Embeds company candidates queued by the company_candidates trigger
 * (CP-REQ-042), every minute. A message is skipped when its row is gone or
 * was embedded after the message was sent; a row with too little to match on
 * gets its embedding cleared. The rest go through one embedMany call. Each
 * write records when the row was read, so an edit made while the batch runs
 * still gets its own pass. A failed batch stays in the queue and is retried
 * until `CANDIDATE_EMBEDDING_MAX_READS`. No allowance is consumed (CP-REQ-044).
 */
export async function GET(request: NextRequest) {
  if (!INTERNAL_API_SECRET || request.headers.get("X-Internal-Secret") !== INTERNAL_API_SECRET) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const queue = admin.schema("pgmq_public");

  const { data, error } = await queue.rpc("read", {
    queue_name: CANDIDATE_EMBEDDING_QUEUE,
    sleep_seconds: VISIBILITY_TIMEOUT,
    n: BATCH_SIZE,
  });
  if (error) {
    reportError("[candidate embeddings worker] couldn't read the queue", error.message);
    return NextResponse.json({ message: "Couldn't read the queue." }, { status: 500 });
  }
  const messages = (data ?? []) as QueueMessage[];
  if (messages.length === 0) return NextResponse.json({ embedded: 0, cleared: 0, skipped: 0, failed: 0 });

  const done = async (msgIds: number[]) => {
    for (const msgId of msgIds) {
      const { error: deleteError } = await queue.rpc("delete", {
        queue_name: CANDIDATE_EMBEDDING_QUEUE,
        message_id: msgId,
      });
      if (deleteError) reportError(`[candidate embeddings worker] couldn't delete ${msgId}`, deleteError.message);
    }
  };

  const readAt = new Date().toISOString();
  const ids = [...new Set(messages.flatMap((m) => (m.message?.candidate_id ? [m.message.candidate_id] : [])))];
  const { data: rows, error: loadError } = await admin.from("company_candidates").select(SELECT).in("id", ids);
  if (loadError) {
    reportError("[candidate embeddings worker] couldn't load the candidates", loadError.message);
    return NextResponse.json({ message: "Couldn't load the candidates." }, { status: 500 });
  }
  const rowOf = new Map(((rows ?? []) as unknown as CandidateRow[]).map((r) => [r.id, r]));

  // One entry per candidate to write, with every message it answers.
  const pending = new Map<string, { row: CandidateRow; messages: QueueMessage[] }>();
  const skippedMsgs: number[] = [];
  for (const m of messages) {
    const row = m.message?.candidate_id ? rowOf.get(m.message.candidate_id) : undefined;
    const fresh =
      row &&
      !row.embedding_stale &&
      row.embedding_updated_at !== null &&
      Date.parse(row.embedding_updated_at) >= Date.parse(m.enqueued_at);
    if (!row || fresh) {
      skippedMsgs.push(m.msg_id);
      continue;
    }
    const entry = pending.get(row.id) ?? { row, messages: [] };
    entry.messages.push(m);
    pending.set(row.id, entry);
  }
  await done(skippedMsgs);

  const toClear: { row: CandidateRow; messages: QueueMessage[] }[] = [];
  const toEmbed: { row: CandidateRow; messages: QueueMessage[]; text: string }[] = [];
  for (const entry of pending.values()) {
    const text = candidateEmbeddingText(entry.row);
    if (text === null) toClear.push(entry);
    else toEmbed.push({ ...entry, text });
  }

  const failures: string[] = [];
  let vectors: number[][] = [];
  if (toEmbed.length > 0) {
    try {
      ({ embeddings: vectors } = await embedMany({
        model: google.embedding("gemini-embedding-001"),
        values: toEmbed.map((e) => e.text),
        providerOptions: { google: { outputDimensionality: 768 } },
      }));
    } catch (err) {
      // Left in the queue: it comes back after the visibility timeout.
      reportError("[candidate embeddings worker] embedMany failed", err);
      const reason = err instanceof Error ? err.message : String(err);
      for (const { row, messages: msgs } of toEmbed) {
        const last = msgs.filter((m) => m.read_ct >= CANDIDATE_EMBEDDING_MAX_READS);
        if (last.length === 0) continue;
        failures.push(`candidate ${row.id}: ${reason}`);
        for (const m of last) {
          const { error: archiveError } = await queue.rpc("archive", {
            queue_name: CANDIDATE_EMBEDDING_QUEUE,
            message_id: m.msg_id,
          });
          if (archiveError) reportError(`[candidate embeddings worker] couldn't archive ${m.msg_id}`, archiveError.message);
        }
      }
      toEmbed.length = 0;
    }
  }

  const write = async (id: string, embedding: number[] | null) => {
    const { error: writeError } = await admin
      .from("company_candidates")
      .update({
        // PostgREST takes the vector as a JSON array.
        embedding: embedding as unknown as string | null,
        embedding_updated_at: readAt,
        embedding_stale: false,
      })
      .eq("id", id);
    if (writeError) reportError(`[candidate embeddings worker] couldn't write ${id}`, writeError.message);
    return !writeError;
  };

  const results = await Promise.all([
    ...toEmbed.map(async (e, i) => ({ kind: "embedded" as const, e, ok: await write(e.row.id, vectors[i]) })),
    ...toClear.map(async (e) => ({ kind: "cleared" as const, e, ok: await write(e.row.id, null) })),
  ]);
  // A failed write stays in the queue for the next run.
  await done(results.filter((r) => r.ok).flatMap((r) => r.e.messages.map((m) => m.msg_id)));

  if (failures.length > 0) {
    await sendEmailForStatusUpdate(
      `[CANDIDATE EMBEDDINGS] Gave up on ${failures.length} candidate(s):\n${failures.join("\n")}`,
    );
  }

  return NextResponse.json({
    embedded: results.filter((r) => r.ok && r.kind === "embedded").length,
    cleared: results.filter((r) => r.ok && r.kind === "cleared").length,
    skipped: skippedMsgs.length,
    failed: failures.length,
  });
}
