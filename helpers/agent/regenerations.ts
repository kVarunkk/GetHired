import type { UIMessage } from "ai";
import { AGENT_MAX_REGENERATIONS } from "./config";

const metadataOf = (message: UIMessage): Record<string, unknown> =>
  message.metadata && typeof message.metadata === "object"
    ? (message.metadata as Record<string, unknown>)
    : {};

/**
 * How many times the reply to this user message was regenerated. Kept in the
 * user message's `metadata.regenerations`, which only the server writes; an
 * edit saves the message afresh, so it starts again at 0.
 */
export function regenerationsOf(message: UIMessage): number {
  const count = metadataOf(message).regenerations;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

/** Whether the reply to this user message can be regenerated again. */
export const canRegenerate = (message: UIMessage) =>
  regenerationsOf(message) < AGENT_MAX_REGENERATIONS;

/** The user message with one more regeneration counted. Pure. */
export const withRegeneration = (message: UIMessage): UIMessage => ({
  ...message,
  metadata: { ...metadataOf(message), regenerations: regenerationsOf(message) + 1 },
});
