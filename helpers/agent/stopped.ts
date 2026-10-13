import { isToolUIPart, type UIMessage } from "ai";
import { FINISHED_TOOL_STATES } from "./context";

type MessagePart = UIMessage["parts"][number];

const metadataOf = (message: UIMessage): Record<string, unknown> =>
  message.metadata && typeof message.metadata === "object"
    ? (message.metadata as Record<string, unknown>)
    : {};

/** Whether the user stopped this reply before it finished. */
export const isStopped = (message: UIMessage) => metadataOf(message).stopped === true;

/**
 * A reply the user stopped, as it is saved and shown: the text and finished
 * tool steps they saw, without unfinished tool calls or suggestions, marked
 * `metadata.stopped`. Finished tool steps stay so the model knows what
 * already ran. Returns null if nothing is left to show. Shared by the chat
 * route and `ChatPane` so the live view matches a reload. Pure.
 */
export function stoppedReply(message: UIMessage): UIMessage | null {
  const parts = message.parts
    .filter((part) => !isToolUIPart(part) || FINISHED_TOOL_STATES.has(part.state))
    .filter((part) => part.type !== "data-suggestions")
    .map((part) =>
      (part.type === "text" || part.type === "reasoning") && part.state === "streaming"
        ? ({ ...part, state: "done" } as MessagePart)
        : part,
    );

  const hasContent = parts.some(
    (part) => isToolUIPart(part) || (part.type === "text" && part.text.trim() !== ""),
  );
  if (!hasContent) return null;

  return { ...message, parts, metadata: { ...metadataOf(message), stopped: true } };
}
