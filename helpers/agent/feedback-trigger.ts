// When the server adds the survey card to a reply
// (plan/agent-feedback/feature-agent-feedback-spec.md §2, AF-REQ-010/011).
// Fixed rules and a per-user cooldown; the model never decides. Pure.

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import {
  AGENT_FEEDBACK_COOLDOWN_DAYS,
  AGENT_FEEDBACK_DISMISSED_COOLDOWN_DAYS,
  AGENT_FEEDBACK_MIN_USER_TURNS,
} from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The survey card's data part, saved with the reply. */
export const FEEDBACK_PART = { type: "data-feedback", id: "feedback", data: { v: 1 } } as const;

export type FinishedTool = { toolName: string; output: unknown };

const isErrorOutput = (output: unknown) =>
  typeof output === "object" && output !== null && "error" in output;

/**
 * Whether a milestone tool finished this turn without `{ error }`. A tool
 * that's still waiting on an approval, was denied or threw never produces a
 * finished output, so it doesn't count.
 */
export const finishedMilestone = (tools: readonly FinishedTool[], milestones: readonly string[]) =>
  tools.some((tool) => milestones.includes(tool.toolName) && !isErrorOutput(tool.output));

/**
 * Collects the tools that finished in this turn from the UI stream's chunks.
 * The names come from the chunks' inputs and, for a call approved in the
 * previous request and run at the start of this one, from the reply being
 * continued.
 */
export function createFinishedToolTracker(continued: UIMessage | undefined) {
  const names = new Map<string, string>();
  for (const part of continued?.parts ?? []) {
    if (isToolUIPart(part)) names.set(part.toolCallId, getToolName(part));
  }
  const finished: FinishedTool[] = [];

  return {
    observe(chunk: { type: string } & Record<string, unknown>) {
      if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") {
        names.set(chunk.toolCallId as string, chunk.toolName as string);
      } else if (chunk.type === "tool-output-available" && !chunk.preliminary) {
        const toolName = names.get(chunk.toolCallId as string);
        if (toolName) finished.push({ toolName, output: chunk.output });
      }
    },
    finished: () => finished,
  };
}

export type FeedbackOfferInput = {
  enabled: boolean;
  finishReason: string | undefined;
  stopped: boolean;
  /** This session was already offered a card. */
  sessionOffered: boolean;
  /** When this user was last offered a card, in any session. */
  lastOfferedAt: Date | null;
  /** When this user last dismissed a card. */
  lastDismissedAt: Date | null;
  /** User messages in the session, this turn's included. */
  userTurns: number;
  finishedTools: readonly FinishedTool[];
  milestones: readonly string[];
  now: Date;
};

const within = (at: Date | null, days: number, now: Date) =>
  at !== null && now.getTime() - at.getTime() < days * DAY_MS;

/**
 * Whether to add the survey card after this reply (AF-REQ-010): a final
 * answer, the first offer in the session, outside both cooldowns, after a
 * milestone or a long session.
 */
export function shouldOfferFeedback(input: FeedbackOfferInput): boolean {
  if (!input.enabled || input.finishReason !== "stop" || input.stopped) return false;
  if (input.sessionOffered) return false;
  if (within(input.lastOfferedAt, AGENT_FEEDBACK_COOLDOWN_DAYS, input.now)) return false;
  if (within(input.lastDismissedAt, AGENT_FEEDBACK_DISMISSED_COOLDOWN_DAYS, input.now)) return false;
  return (
    finishedMilestone(input.finishedTools, input.milestones) ||
    input.userTurns >= AGENT_FEEDBACK_MIN_USER_TURNS
  );
}
