import type { ModelMessage, ToolApprovalStatus } from "ai";
import { AGENT_MAX_CREDIT_CALLS_PER_TURN } from "./config";

export type ToolApprovalFn = (options: {
  toolCall: { toolName: string; toolCallId: string };
  messages: ModelMessage[];
}) => ToolApprovalStatus;

/** A group of tools that can run at most `max` times per turn between them. */
export type PerTurnCap = { tools: readonly string[]; max: number; reason: string };

export type ToolApprovalPolicy = {
  /** Tools the user always approves. */
  alwaysAsk: readonly string[];
  /** Tools whose output carries text the user didn't write in this chat (SEC-011). */
  untrustedContentTools: readonly string[];
  /** Tools that need approval once untrusted content was read this turn. */
  gatedWriteTools: readonly string[];
  untrustedReason: string;
  /** Tools that spend credits, capped at AGENT_MAX_CREDIT_CALLS_PER_TURN per turn (SEC-013). */
  creditTools: readonly string[];
  /** Further per-turn caps, e.g. email-sending actions (RA-SEC-006). */
  perTurnCaps?: readonly PerTurnCap[];
};

const CREDIT_LIMIT_REASON = `Only ${AGENT_MAX_CREDIT_CALLS_PER_TURN} credit-spending actions can run per message. Ask the user before trying again.`;

/**
 * Tool results of the current turn: everything after the last user message.
 * A continuation after an approval or upload adds no user message, so it
 * belongs to the same turn. Denied calls never ran, so they're left out, as
 * is the call being decided (it's already in the messages when an approval
 * is replayed).
 */
function ranThisTurn(messages: ModelMessage[], excludeCallId: string) {
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  return messages
    .slice(lastUser + 1)
    .flatMap((message) => (message.role === "tool" ? message.content : []))
    .filter(
      (part) =>
        part.type === "tool-result" &&
        part.toolCallId !== excludeCallId &&
        part.output.type !== "execution-denied",
    )
    .map((part) => (part as { toolName: string }).toolName);
}

/**
 * Builds a tool approval policy for `streamText`'s `toolApproval` (spec §14,
 * RA spec §4.4). Pure. Caps are checked first, so a call over a cap is denied
 * rather than put to the user.
 */
export function createToolApproval(policy: ToolApprovalPolicy): ToolApprovalFn {
  const alwaysAsk = new Set(policy.alwaysAsk);
  const untrusted = new Set(policy.untrustedContentTools);
  const gatedWrites = new Set(policy.gatedWriteTools);
  const caps: PerTurnCap[] = [
    { tools: policy.creditTools, max: AGENT_MAX_CREDIT_CALLS_PER_TURN, reason: CREDIT_LIMIT_REASON },
    ...(policy.perTurnCaps ?? []),
  ];

  return ({ toolCall, messages }) => {
    const { toolName, toolCallId } = toolCall;

    for (const cap of caps) {
      if (!cap.tools.includes(toolName)) continue;
      const used = ranThisTurn(messages, toolCallId).filter((name) => cap.tools.includes(name));
      if (used.length >= cap.max) return { type: "denied", reason: cap.reason };
    }

    if (alwaysAsk.has(toolName)) return "user-approval";

    if (gatedWrites.has(toolName)) {
      const readUntrusted = ranThisTurn(messages, toolCallId).some((name) => untrusted.has(name));
      if (readUntrusted) return { type: "user-approval", reason: policy.untrustedReason };
    }

    return "not-applicable";
  };
}

/** The applicant agent's policy (REQ-014, SEC-011–013). */
export const APPLICANT_APPROVAL_POLICY: ToolApprovalPolicy = {
  // They spend credits or change the profile.
  alwaysAsk: ["startResumeReview", "updateMyPreferences", "completeOnboarding"],
  untrustedContentTools: ["getJobDetails", "getResumeReview", "getInterviewAnalysis"],
  // Long-term memory goes into every later prompt.
  gatedWriteTools: ["saveMemory", "deleteMemory"],
  untrustedReason:
    "The assistant read a job posting or report in this reply, so memory changes need your OK.",
  creditTools: ["naturalLanguageJobSearch", "startResumeReview"],
};

/** The applicant agent's tool approval policy, passed to `streamText` as `toolApproval`. */
export const agentToolApproval = createToolApproval(APPLICANT_APPROVAL_POLICY);
