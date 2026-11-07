import type { UIMessage } from "ai";
import { z } from "zod";

type MessagePart = UIMessage["parts"][number];
type ToolPart = MessagePart & { toolCallId: string; state: string };

/**
 * What the model reads after the user declines. Without it the provider sends
 * a bare "Tool call execution denied.", and the model has reported the change
 * as done. Set here, for every tool, so the browser can't supply the text.
 */
export const DECLINED_REASON =
  "The user declined this, so it did not run and nothing changed. Don't say it happened. Ask what they'd like to do instead.";

const changeIds = z.array(z.string().min(1).max(64)).max(200);

/** Client-side tools whose output the browser provides (REQ-015). */
const CLIENT_TOOL_OUTPUTS: Record<string, z.ZodTypeAny> = {
  "tool-requestResumeUpload": z.union([
    z.object({ resumeId: z.string().min(1).max(64) }),
    z.object({ cancelled: z.literal(true) }),
  ]),
  // What the user did on the changes card. The write already happened in a
  // server action, so a forged output can only mislead the model (RI-REQ-022).
  "tool-reviewResumeChanges": z
    .object({
      status: z.enum(["applied", "discarded"]),
      applied: changeIds,
      skipped: changeIds,
      changed: changeIds,
      targetResumeId: z.string().uuid().nullable(),
    })
    .strict(),
  // The recruiter agent's import widgets (BI-REQ-060). The ids only point the
  // server tools at an import; they read everything else themselves, scoped
  // to the session's company.
  "tool-requestResumeImport": z.union([
    z.object({ batchId: z.string().uuid(), files: z.number().int().min(1).max(100) }).strict(),
    z.object({ cancelled: z.literal(true) }),
  ]),
  "tool-requestSpreadsheetImport": z.union([
    z.object({ batchId: z.string().uuid(), rows: z.number().int().min(1).max(5000) }).strict(),
    z.object({ cancelled: z.literal(true) }),
  ]),
  "tool-requestCandidateResume": z.union([
    z.object({ uploaded: z.literal(true), rescreened: z.number().int().min(0).max(1000) }).strict(),
    z.object({ cancelled: z.literal(true) }),
  ]),
};

const approvalResponse = z.object({
  id: z.string(),
  approved: z.boolean(),
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

    const { id, approved } = parsed.data;
    return {
      ...stored,
      state: "approval-responded",
      approval: {
        id,
        approved,
        ...(approved ? {} : { reason: DECLINED_REASON }),
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
