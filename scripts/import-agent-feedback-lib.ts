/**
 * Pure parts of `import-agent-feedback.ts`: which chat trace a 👍/👎 belongs
 * to, and the annotation written onto it. Tested in
 * `import-agent-feedback-lib.test.ts`.
 */
import { redactContactDetails } from "../helpers/agent/contact-details";
import { attr, type AnnotateRecord, type ArizeSpan } from "./arize-lib";

/** Human annotation configs the import writes (created on first run). */
export const USER_RATING_CONFIG = {
  name: "user_rating",
  values: [
    { label: "up", score: 1 },
    { label: "down", score: 0 },
  ],
};
export const USER_FEEDBACK_NOTE_CONFIG = "user_feedback_note";

/** The root span of a chat turn, by role (spec §13). */
export const CHAT_ROOT_NAMES = ["agent-chat", "recruiter-agent-chat"] as const;
export const CHAT_ROOT_FILTER = CHAT_ROOT_NAMES.map((name) => `attributes.agent.name = '${name}'`).join(" or ");

export type FeedbackRow = {
  id: string;
  session_id: string;
  message_id: string;
  agent_role: string;
  rating: number | null;
  reasons: string[];
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatRoot = {
  spanId: string;
  traceId: string;
  startTime: string;
  sessionId?: string;
  messageId?: string;
  turnEnd?: string;
  output?: string;
};

export type Match =
  | { row: FeedbackRow; root: ChatRoot; by: "message_id" | "reply_text" }
  | { row: FeedbackRow; root: null; reason: string };

export function toChatRoot(span: ArizeSpan): ChatRoot {
  return {
    spanId: span.context.span_id,
    traceId: span.context.trace_id,
    startTime: span.start_time,
    sessionId: attr(span, "session.id"),
    messageId: attr(span, "gethired.message_id"),
    turnEnd: attr(span, "gethired.turn_end"),
    output: replyOfOutput(attr(span, "output.value")),
  };
}

/**
 * The reply text in a root span's `output.value`. The exporter writes it as
 * an `assistant: …` line; traces from before that rewrite hold the AI SDK's
 * serialized messages, whose text parts carry the body in `content`.
 */
export function replyOfOutput(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith("[")) {
    try {
      const messages = JSON.parse(raw) as { role?: string; parts?: { type?: string; content?: unknown }[] }[];
      if (Array.isArray(messages)) {
        return messages
          .filter((m) => m?.role === "assistant")
          .flatMap((m) => m.parts ?? [])
          .filter((p) => p?.type === "text" && typeof p.content === "string")
          .map((p) => p.content as string)
          .join("\n");
      }
    } catch {
      // Not JSON: a reply that happens to start with "[".
    }
  }
  return raw.replace(/^assistant:\s*/, "");
}

const normalise = (text: string) => redactContactDetails(text).replace(/\s+/g, " ").trim().toLowerCase();

/** Shorter outputs ("Done.") would match too many replies to be trusted. */
const MIN_TEXT_MATCH_CHARS = 20;

/**
 * The trace a vote is about. A reply that waited on an approval is written by
 * several turns (one trace each); the vote is on the reply as it ended, so the
 * latest turn is chosen, and a turn that ended in a reply beats a paused one.
 *
 * Traces from before `gethired.message_id` existed are matched by session and
 * text: the trace's `output.value` is the reply the user saw, so the stored
 * message's text contains it.
 */
export function matchFeedback(
  row: FeedbackRow,
  roots: readonly ChatRoot[],
  replyText: string | undefined,
): Match {
  const byId = roots.filter((root) => root.messageId === row.message_id);
  if (byId.length) return { row, root: latestTurn(byId), by: "message_id" };

  // A session whose traces carry message ids gives a definite answer: none of
  // them is this reply. Only older traces fall back to the text.
  const inSession = roots.filter((root) => root.sessionId === row.session_id && !root.messageId);
  if (!inSession.length) return { row, root: null, reason: "no trace for this session in the window" };
  if (!replyText?.trim()) return { row, root: null, reason: "the reply is no longer stored" };

  const reply = normalise(replyText);
  const voted = Date.parse(row.created_at);
  const byText = inSession.filter((root) => {
    const output = root.output ? normalise(root.output) : "";
    return output.length >= MIN_TEXT_MATCH_CHARS && reply.includes(output) && Date.parse(root.startTime) <= voted;
  });
  if (!byText.length) return { row, root: null, reason: "no trace in the session ends with this reply" };
  return { row, root: latestTurn(byText), by: "reply_text" };
}

function latestTurn(roots: readonly ChatRoot[]): ChatRoot {
  const newest = (a: ChatRoot, b: ChatRoot) => Date.parse(b.startTime) - Date.parse(a.startTime);
  const replies = roots.filter((root) => root.turnEnd === "reply").sort(newest);
  return replies[0] ?? [...roots].sort(newest)[0];
}

/** The text of a stored `agent_messages.parts`. */
export function replyTextOf(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * The annotation for a vote: `user_rating` up/down, and the 👎 reasons and
 * comment (contact details masked) as `user_feedback_note`. A vote with no
 * reasons or comment writes no note.
 */
export function feedbackAnnotation(
  row: FeedbackRow,
  spanId: string,
  { withComments }: { withComments: boolean },
): AnnotateRecord | null {
  if (row.rating !== 1 && row.rating !== -1) return null;
  const up = row.rating === 1;
  const note = [
    row.reasons.length ? `reasons: ${row.reasons.join(", ")}` : "",
    withComments && row.comment?.trim() ? `comment: ${redactContactDetails(row.comment.trim())}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    record_id: spanId,
    values: [
      { name: USER_RATING_CONFIG.name, label: up ? "up" : "down", score: up ? 1 : 0 },
      ...(note ? [{ name: USER_FEEDBACK_NOTE_CONFIG, text: note }] : []),
    ],
  };
}

/**
 * One record per span: if two votes land on one span (only possible through
 * the text fallback), the latest update wins.
 */
export function dedupeBySpan(matches: readonly Extract<Match, { root: ChatRoot }>[]) {
  const bySpan = new Map<string, Extract<Match, { root: ChatRoot }>>();
  for (const match of matches) {
    const seen = bySpan.get(match.root.spanId);
    if (!seen || Date.parse(match.row.updated_at) > Date.parse(seen.row.updated_at)) {
      bySpan.set(match.root.spanId, match);
    }
  }
  return [...bySpan.values()];
}
