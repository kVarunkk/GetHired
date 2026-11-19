import { isToolUIPart, type UIMessage } from "ai";

/**
 * What happens to an approval the user never answered because they sent a
 * new message instead. Client-safe: the route saves it, and ChatPane applies
 * it as the message is sent so the old card loses its buttons right away.
 *
 * Before this, the request stayed `approval-requested` forever: its buttons
 * did nothing (only the latest reply can be answered), and the model never
 * saw it (dropAbandonedToolCalls), so it asked for the same thing again.
 */

/**
 * What the model reads as the call's result (an `output-denied` part becomes
 * a tool result with this text). It's set here, never by the browser.
 */
export const SKIPPED_APPROVAL_REASON =
  "The user didn't approve this and sent a new message instead, so it did not run and nothing changed. Don't say it happened. Answer their new message, and don't ask to do this again unless that message asks for it.";

type Part = UIMessage["parts"][number];

const isPendingApproval = (part: Part) => isToolUIPart(part) && part.state === "approval-requested";

/** Whether this denied part is an approval the user moved past (vs. pressed Deny). */
export function isSkippedApproval(part: Part): boolean {
  if (!isToolUIPart(part) || part.state !== "output-denied") return false;
  return (part as { approval?: { reason?: string } }).approval?.reason === SKIPPED_APPROVAL_REASON;
}

/**
 * The message with every unanswered approval marked skipped, or null when it
 * has none. Pure.
 */
export function skipPendingApprovals(message: UIMessage): UIMessage | null {
  if (message.role !== "assistant" || !message.parts.some(isPendingApproval)) return null;
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (!isPendingApproval(part)) return part;
      const { approval } = part as Part & { approval: { id: string } };
      return {
        ...part,
        state: "output-denied",
        approval: { id: approval.id, approved: false, reason: SKIPPED_APPROVAL_REASON },
      } as Part;
    }),
  };
}

/**
 * `messages` with the latest reply's unanswered approvals skipped, for when
 * the user sends a new message. The same array when there's nothing to skip.
 */
export function skipApprovalsBeforeNewMessage(messages: UIMessage[]): UIMessage[] {
  const last = messages.at(-1);
  const skipped = last ? skipPendingApprovals(last) : null;
  return skipped ? [...messages.slice(0, -1), skipped] : messages;
}
