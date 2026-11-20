/**
 * Copies agent reply feedback (👍/👎, `agent_feedback` with kind 'reply') onto
 * the reply's chat trace in Arize AX as human annotations (AF-REQ-042), so
 * thumbs-down turns can be filtered and set against the online evals.
 *
 *   npx tsx --env-file=.env scripts/import-agent-feedback.ts [--days 30] [--dry-run] [--no-comments]
 *
 * - The trace is found by `gethired.message_id` on the root chat span; older
 *   traces by session and reply text (`matchFeedback`).
 * - Writes `user_rating` (up / down) and, for a 👎 with reasons or a comment,
 *   `user_feedback_note` (contact details masked; `--no-comments` leaves the
 *   comment out). Both configs are created on the first run.
 * - Upserts, so it's safe to re-run. A vote the user later removed keeps its
 *   annotation: Arize has no delete for span annotations.
 * - `--days` is capped at 31, Arize's annotation window. `--explain` prints why
 *   each unmatched vote missed.
 *
 * Uses ARIZE_API_KEY, ARIZE_SPACE_ID, NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../utils/types/database.types";
import { redactContactDetails } from "../helpers/agent/contact-details";
import { arg, arizeFromEnv, flag } from "./arize-lib";
import {
  CHAT_ROOT_FILTER,
  dedupeBySpan,
  feedbackAnnotation,
  matchFeedback,
  replyTextOf,
  toChatRoot,
  USER_FEEDBACK_NOTE_CONFIG,
  USER_RATING_CONFIG,
  type ChatRoot,
  type FeedbackRow,
  type Match,
} from "./import-agent-feedback-lib";

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const days = Math.min(31, Math.max(1, Number(arg("days") ?? 30)));
  const dryRun = flag("dry-run");
  const withComments = !flag("no-comments");
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SERVICE_ROLE_KEY.");
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const arize = arizeFromEnv();

  const { data, error } = await supabase
    .from("agent_feedback")
    .select("id, session_id, message_id, agent_role, rating, reasons, comment, created_at, updated_at")
    .eq("kind", "reply")
    .gte("created_at", start.toISOString())
    .order("created_at");
  if (error) throw new Error(`agent_feedback: ${error.message}`);
  const rows = (data ?? []) as FeedbackRow[];
  console.log(`${rows.length} reply votes in the last ${days} days`);
  if (!rows.length) return;

  // The turn's trace starts before the vote, so look a little further back.
  const roots: ChatRoot[] = [];
  const firstVote = new Date(Date.parse(rows[0].created_at) - DAY_MS);
  const searchStart = firstVote > start ? firstVote : start;
  for await (const span of arize.listSpans({ start: searchStart, end, filter: CHAT_ROOT_FILTER })) {
    roots.push(toChatRoot(span));
  }
  console.log(`${roots.length} chat turns traced since ${searchStart.toISOString()}`);

  // Reply text, only for votes whose trace has no message id (older traces).
  const ids = new Set(roots.map((root) => root.messageId).filter(Boolean));
  const needText = rows.filter((row) => !ids.has(row.message_id)).map((row) => row.message_id);
  const texts = new Map<string, string>();
  for (let i = 0; i < needText.length; i += 200) {
    const { data: messages, error: messagesError } = await supabase
      .from("agent_messages")
      .select("id, parts")
      .in("id", needText.slice(i, i + 200));
    if (messagesError) throw new Error(`agent_messages: ${messagesError.message}`);
    for (const message of messages ?? []) texts.set(message.id, replyTextOf(message.parts));
  }

  const matches: Match[] = rows.map((row) => matchFeedback(row, roots, texts.get(row.message_id)));
  const matched = dedupeBySpan(matches.filter((m): m is Extract<Match, { root: ChatRoot }> => m.root !== null));
  const unmatched = matches.filter((m): m is Extract<Match, { root: null }> => m.root === null);

  const count = (by: string) => matched.filter((m) => m.by === by).length;
  console.log(
    `Matched ${matched.length} (${count("message_id")} by message id, ${count("reply_text")} by reply text); ` +
      `${unmatched.length} unmatched`,
  );
  const reasons = new Map<string, number>();
  for (const m of unmatched) reasons.set(m.reason, (reasons.get(m.reason) ?? 0) + 1);
  for (const [reason, n] of reasons) console.log(`  unmatched, ${reason}: ${n}`);

  // The start of the stored reply against the session's traced replies, to
  // see why the text fallback missed (printed to the terminal only).
  if (flag("explain")) {
    const head = (text: string | undefined) => JSON.stringify(redactContactDetails(text ?? "").slice(0, 80));
    for (const m of unmatched) {
      console.log(`\n${m.row.message_id} (voted ${m.row.created_at}): ${m.reason}`);
      console.log(`  reply ${head(texts.get(m.row.message_id))}`);
      for (const root of roots.filter((r) => r.sessionId === m.row.session_id)) {
        console.log(`  trace ${root.startTime} ${root.turnEnd ?? "?"} ${root.messageId ?? "-"} ${head(root.output)}`);
      }
    }
  }

  const records = matched
    .map((m) => feedbackAnnotation(m.row, m.root.spanId, { withComments }))
    .filter((record) => record !== null);
  const down = records.filter((r) => r.values[0].label === "down").length;
  console.log(`${records.length} annotations to write (${records.length - down} up, ${down} down)`);
  if (dryRun || !records.length) {
    if (dryRun) console.log("Dry run: nothing written.");
    return;
  }

  await arize.ensureCategoricalConfig(USER_RATING_CONFIG);
  await arize.ensureFreeformConfig(USER_FEEDBACK_NOTE_CONFIG);
  await arize.annotateSpans({ records, start: searchStart, end });
  console.log(`Wrote ${records.length} annotations. Filter on annotation.${USER_RATING_CONFIG.name}.label = 'down'.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
