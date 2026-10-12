import {
  getToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";

type MessagePart = UIMessage["parts"][number];

const MAX_STUB_IDS = 10;

/** Messages after `uptoId`, or all of them if it's null or not found. */
function unsummarised(messages: UIMessage[], uptoId: string | null) {
  const index = uptoId ? messages.findIndex((m) => m.id === uptoId) : -1;
  return messages.slice(index + 1);
}

const idsOf = (items: unknown[]) =>
  items
    .map((item) =>
      item && typeof item === "object" && "id" in item ? String(item.id) : null,
    )
    .filter((id): id is string => id !== null);

/**
 * A short, deterministic stand-in for a tool's output, e.g.
 * "[searchJobs returned 12 jobs: j1, j2, …]". Pure.
 */
export function stubToolOutput(part: ToolUIPart | DynamicToolUIPart): string {
  const name = getToolName(part);
  const output: unknown = part.state === "output-available" ? part.output : undefined;

  if (output && typeof output === "object" && !Array.isArray(output)) {
    if ("error" in output && typeof output.error === "string") {
      return `[${name} failed: ${output.error}]`;
    }
  }

  const entry = Array.isArray(output)
    ? (["items", output] as const)
    : output && typeof output === "object"
      ? Object.entries(output).find(([, value]) => Array.isArray(value))
      : undefined;

  if (!entry) return `[${name} output omitted]`;

  const [label, items] = entry as [string, unknown[]];
  const ids = idsOf(items);
  if (ids.length === 0) return `[${name} returned ${items.length} ${label}]`;

  const shown = ids.slice(0, MAX_STUB_IDS).join(", ");
  const more = ids.length > MAX_STUB_IDS ? ", …" : "";
  return `[${name} returned ${items.length} ${label}: ${shown}${more}]`;
}

const stubMessage = (message: UIMessage): UIMessage => ({
  ...message,
  parts: message.parts.map((part) =>
    isToolUIPart(part) && part.state === "output-available"
      ? ({ ...part, output: stubToolOutput(part) } as MessagePart)
      : part,
  ),
});

/**
 * The messages sent to the model for one turn (spec §4.4, REQ-007/008): the
 * last `window` messages not yet folded into the session summary (starting at
 * a user message), with tool outputs older than the last `fullToolTurns`
 * turns replaced by stubs. The summary itself goes in the system prompt.
 * Pure; never mutates `messages`.
 */
export function selectContextMessages(
  messages: UIMessage[],
  uptoId: string | null,
  { window, fullToolTurns }: { window: number; fullToolTurns: number },
): UIMessage[] {
  let recent = unsummarised(messages, uptoId).slice(-window);

  const firstUser = recent.findIndex((m) => m.role === "user");
  recent = firstUser === -1 ? [] : recent.slice(firstUser);

  // Turns start at user messages; keep full tool outputs from the cutoff on.
  const userIndexes = recent.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const cutoff =
    userIndexes.length > fullToolTurns
      ? userIndexes[userIndexes.length - fullToolTurns]
      : 0;

  return recent.map((message, i) => (i < cutoff ? stubMessage(message) : message));
}

/** Tool-part states that carry a result. */
export const FINISHED_TOOL_STATES = new Set(["output-available", "output-error", "output-denied"]);

/**
 * Removes unfinished tool calls (pending approvals, client tools never
 * completed, half-streamed inputs) from every message except the last. Those
 * calls were abandoned when the user moved on, and providers reject
 * histories with tool calls that never got a result. The last message is
 * kept intact so a pending approval or client tool can still continue. Pure.
 */
export function dropAbandonedToolCalls(messages: UIMessage[]): UIMessage[] {
  return messages.map((message, i) =>
    i === messages.length - 1
      ? message
      : {
          ...message,
          parts: message.parts.filter(
            (part) => !isToolUIPart(part) || FINISHED_TOOL_STATES.has(part.state),
          ),
        },
  );
}

/** Whether more than `trigger` messages are not yet folded into the summary. */
export function needsSummary(
  messages: UIMessage[],
  uptoId: string | null,
  trigger: number,
): boolean {
  return unsummarised(messages, uptoId).length > trigger;
}

/** Unsummarised messages that fall outside the verbatim `window`. */
export function messagesToSummarise(
  messages: UIMessage[],
  uptoId: string | null,
  { window }: { window: number },
): UIMessage[] {
  const pending = unsummarised(messages, uptoId);
  return pending.slice(0, Math.max(0, pending.length - window));
}
