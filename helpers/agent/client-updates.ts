import type { UIMessage } from "ai";
import { z } from "zod";

type MessagePart = UIMessage["parts"][number];
type ToolPart = MessagePart & { toolCallId: string; state: string };

const MAX_REASON_LENGTH = 200;

/** Client-side tools whose output the browser provides (REQ-015). */
const CLIENT_TOOL_OUTPUTS: Record<string, z.ZodTypeAny> = {
  "tool-requestResumeUpload": z.union([
    z.object({ resumeId: z.string().min(1).max(64) }),
    z.object({ cancelled: z.literal(true) }),
  ]),
};

const approvalResponse = z.object({
  id: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});

const isToolPart = (part: MessagePart): part is ToolPart =>
  "toolCallId" in part && typeof part.toolCallId === "string";

function mergePart(stored: MessagePart, incoming: MessagePart | undefined): MessagePart {
  if (!isToolPart(stored) || !incoming || !isToolPart(incoming)) return stored;
  if (incoming.toolCallId !== stored.toolCallId) return stored;

  const storedApproval = (stored as { approval?: { id: string } }).approval;

  // The user answered an approval request.
  if (stored.state === "approval-requested" && incoming.state === "approval-responded") {
    const parsed = approvalResponse.safeParse((incoming as { approval?: unknown }).approval);
    if (!parsed.success || parsed.data.id !== storedApproval?.id) return stored;

    const { id, approved, reason } = parsed.data;
    return {
      ...stored,
      state: "approval-responded",
      approval: {
        id,
        approved,
        ...(reason ? { reason: reason.slice(0, MAX_REASON_LENGTH) } : {}),
      },
    } as MessagePart;
  }

  // The browser finished a client-side tool.
  const outputSchema = CLIENT_TOOL_OUTPUTS[stored.type];
  if (outputSchema && stored.state === "input-available" && incoming.state === "output-available") {
    const parsed = outputSchema.safeParse((incoming as { output?: unknown }).output);
    if (!parsed.success) return stored;
    return { ...stored, state: "output-available", output: parsed.data } as MessagePart;
  }

  return stored;
}

/**
 * The stored assistant message with only the changes a client may make:
 * approval responses to pending approvals, and outputs of client-side tools.
 * Everything else (text, server tool outputs, extra parts) comes from the
 * stored copy, so a tampered resubmission can't forge tool results. Pure.
 */
export function mergeClientUpdates(stored: UIMessage, incoming: UIMessage): UIMessage {
  const incomingByCallId = new Map(
    incoming.parts.filter(isToolPart).map((part) => [part.toolCallId, part]),
  );

  return {
    ...stored,
    parts: stored.parts.map((part) =>
      mergePart(part, isToolPart(part) ? incomingByCallId.get(part.toolCallId) : undefined),
    ),
  };
}
