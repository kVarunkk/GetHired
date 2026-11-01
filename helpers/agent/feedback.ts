// Agent feedback: reason lists, the input schema and the client's feedback
// state (plan/agent-feedback/feature-agent-feedback-spec.md §1, §2, §4).
// Client-safe: no server imports.

import { isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import { AGENT_CONTENT_FILTER_MESSAGE } from "./config";
import { FINISHED_TOOL_STATES } from "./context";
import { RA_CONTENT_FILTER_MESSAGE } from "./roles/recruiter/config";
import type { AgentRoleId } from "./roles/types";

export type FeedbackReason = { key: string; label: string };

const SHARED_REASONS: FeedbackReason[] = [
  { key: "wrong_info", label: "Wrong or made-up info" },
  { key: "didnt_follow", label: "Didn't do what I asked" },
  { key: "too_long", label: "Too long" },
  { key: "too_slow", label: "Too slow" },
  { key: "tool_failed", label: "Something broke" },
  { key: "other", label: "Other" },
];

/** What went wrong, per role (AF-REQ-006). The role's own reason comes before "Other". */
export const FEEDBACK_REASONS: Record<AgentRoleId, readonly FeedbackReason[]> = {
  applicant: [
    ...SHARED_REASONS.slice(0, -1),
    { key: "bad_job_matches", label: "Bad job matches" },
    SHARED_REASONS.at(-1)!,
  ],
  company: [
    ...SHARED_REASONS.slice(0, -1),
    { key: "bad_candidate_matches", label: "Bad candidate matches" },
    SHARED_REASONS.at(-1)!,
  ],
};

/** What went well, for a survey rated 4–5 (AF-REQ-013). */
export const SURVEY_POSITIVE_REASONS: readonly FeedbackReason[] = [
  { key: "saved_time", label: "Saved me time" },
  { key: "accurate", label: "Accurate" },
  { key: "easy", label: "Easy to use" },
  { key: "other", label: "Other" },
];

/** The reason chips to offer: the role's negative list, or the survey's positive one. */
export const reasonsFor = (
  role: AgentRoleId,
  { positive = false }: { positive?: boolean } = {},
): readonly FeedbackReason[] => (positive ? SURVEY_POSITIVE_REASONS : FEEDBACK_REASONS[role]);

/** Whether a survey rating gets the positive reasons. */
export const isPositiveSurveyRating = (rating: number) => rating >= 4;

export const FEEDBACK_COMMENT_MAX = 2000;
export const FEEDBACK_MAX_REASONS = 6;
export const FEEDBACK_MESSAGE_ID_MAX = 64;

export type AgentFeedbackKind = "reply" | "survey";

/**
 * The server action's input for one role (AF-REQ-030). A reply is rated ±1
 * and never dismissed; a survey is rated 1–5, or dismissed with no rating and
 * no reasons. Reasons must come from the role's list (the positive list for a
 * survey rated 4–5).
 */
export function agentFeedbackInputSchema(role: AgentRoleId) {
  const negative = new Set(FEEDBACK_REASONS[role].map((r) => r.key));
  const positive = new Set(SURVEY_POSITIVE_REASONS.map((r) => r.key));

  return z
    .object({
      sessionId: z.string().uuid(),
      messageId: z.string().min(1).max(FEEDBACK_MESSAGE_ID_MAX),
      kind: z.enum(["reply", "survey"]),
      rating: z.number().int().optional(),
      dismissed: z.boolean().optional(),
      reasons: z
        .array(z.string().max(40))
        .max(FEEDBACK_MAX_REASONS)
        .refine((list) => new Set(list).size === list.length, "Reasons must be unique.")
        .optional(),
      comment: z
        .string()
        .trim()
        .max(FEEDBACK_COMMENT_MAX)
        .optional()
        .transform((value) => (value ? value : undefined)),
    })
    .strict()
    .superRefine((input, ctx) => {
      const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      const reasons = input.reasons ?? [];

      if (input.kind === "reply") {
        if (input.dismissed) issue("A reply rating can't be dismissed.");
        if (input.rating !== 1 && input.rating !== -1) issue("A reply is rated 1 or -1.");
        if (reasons.some((key) => !negative.has(key))) issue("Unknown reason.");
        return;
      }

      if (input.dismissed) {
        if (input.rating !== undefined || reasons.length > 0 || input.comment) {
          issue("A dismissed survey has no rating, reasons or comment.");
        }
        return;
      }
      if (input.rating === undefined || input.rating < 1 || input.rating > 5) {
        issue("A survey is rated 1 to 5.");
        return;
      }
      const allowed = isPositiveSurveyRating(input.rating) ? positive : negative;
      if (reasons.some((key) => !allowed.has(key))) issue("Unknown reason.");
    });
}

export type AgentFeedbackInput = z.infer<ReturnType<typeof agentFeedbackInputSchema>>;

/** The saved feedback for a chat's messages, keyed by message id (AF-REQ-031). */
export type AgentFeedbackEntry = { reply?: -1 | 1; survey?: "answered" | "dismissed" };
export type AgentFeedbackState = Record<string, AgentFeedbackEntry>;

export type AgentFeedbackRow = {
  message_id: string;
  kind: string;
  rating: number | null;
  dismissed: boolean;
};

/** The client's feedback state from a session's `agent_feedback` rows. Pure. */
export function feedbackStateFromRows(rows: readonly AgentFeedbackRow[]): AgentFeedbackState {
  const state: AgentFeedbackState = {};
  for (const row of rows) {
    const entry = (state[row.message_id] ??= {});
    if (row.kind === "reply" && (row.rating === 1 || row.rating === -1)) {
      entry.reply = row.rating;
    } else if (row.kind === "survey") {
      entry.survey = row.dismissed ? "dismissed" : "answered";
    }
  }
  return state;
}

const CONTENT_FILTER_MESSAGES = new Set([AGENT_CONTENT_FILTER_MESSAGE, RA_CONTENT_FILTER_MESSAGE]);

const textOf = (message: UIMessage) =>
  message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();

/**
 * Whether a reply shows 👍/👎 (AF-REQ-002): a finished assistant reply with
 * text, not still streaming, not waiting on an approval or upload, and not
 * the content-filter message. A stopped reply can be rated. Pure.
 */
export function canRateReply(message: UIMessage, { streaming }: { streaming: boolean }) {
  if (message.role !== "assistant" || streaming) return false;
  const text = textOf(message);
  if (text === "" || CONTENT_FILTER_MESSAGES.has(text)) return false;
  return !message.parts.some((part) => isToolUIPart(part) && !FINISHED_TOOL_STATES.has(part.state));
}

/** Whether the server attached the survey card to this reply (AF-REQ-010). */
export const hasFeedbackPart = (parts: readonly { type: string }[]) =>
  parts.some((part) => part.type === "data-feedback");
