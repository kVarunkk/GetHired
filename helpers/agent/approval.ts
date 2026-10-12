import type { ModelMessage, ToolApprovalStatus } from "ai";
import { AGENT_MAX_CREDIT_CALLS_PER_TURN } from "./config";

/** Tools the user always approves: they spend credits or change the profile (REQ-014). */
const ALWAYS_ASK = new Set(["startResumeReview", "updateMyPreferences", "completeOnboarding"]);

/** Tools whose output carries text the user didn't write in this chat (SEC-011). */
const UNTRUSTED_CONTENT_TOOLS = new Set([
  "getJobDetails",
  "getResumeReview",
  "getInterviewAnalysis",
]);

/** Tools that write long-term memory, which goes into every later prompt. */
const MEMORY_TOOLS = new Set(["saveMemory", "deleteMemory"]);

/** Tools that spend AI credits (SEC-013). */
const CREDIT_TOOLS = new Set(["naturalLanguageJobSearch", "startResumeReview"]);

const UNTRUSTED_REASON =
  "The assistant read a job posting or report in this reply, so memory changes need your OK.";
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
 * The agent's tool approval policy (spec §14, SEC-012, SEC-013), passed to
 * `streamText` as `toolApproval`. Pure.
 */
export function agentToolApproval({
  toolCall,
  messages,
}: {
  toolCall: { toolName: string; toolCallId: string };
  messages: ModelMessage[];
}): ToolApprovalStatus {
  const { toolName, toolCallId } = toolCall;

  if (CREDIT_TOOLS.has(toolName)) {
    const spent = ranThisTurn(messages, toolCallId).filter((name) => CREDIT_TOOLS.has(name));
    if (spent.length >= AGENT_MAX_CREDIT_CALLS_PER_TURN) {
      return { type: "denied", reason: CREDIT_LIMIT_REASON };
    }
  }

  if (ALWAYS_ASK.has(toolName)) return "user-approval";

  if (MEMORY_TOOLS.has(toolName)) {
    const readUntrusted = ranThisTurn(messages, toolCallId).some((name) =>
      UNTRUSTED_CONTENT_TOOLS.has(name),
    );
    if (readUntrusted) return { type: "user-approval", reason: UNTRUSTED_REASON };
  }

  return "not-applicable";
}
