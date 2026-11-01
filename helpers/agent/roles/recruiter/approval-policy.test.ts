/**
 * RMT-001: RECRUITER_APPROVAL_POLICY is the data recruiterToolApproval
 * enforces, so the MCP catalog can take its confirm and credit flags from it.
 */
import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import { AGENT_MAX_CREDIT_CALLS_PER_TURN } from "../../config";
import { RECRUITER_APPROVAL_POLICY, recruiterToolApproval } from "./approval";
import { createRecruiterTools } from "./tools";
import { recruiterToolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("server-only", () => ({}));

const user = (text: string): ModelMessage => ({ role: "user", content: text });
const ran = (toolName: string, toolCallId: string): ModelMessage[] => [
  { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input: {} }] },
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId, toolName, output: { type: "json", value: {} } }],
  },
];
const decide = (toolName: string, messages: ModelMessage[] = [user("hi")]) =>
  recruiterToolApproval({ toolCall: { toolName, toolCallId: "current" }, messages });
const typeOf = (status: ReturnType<typeof recruiterToolApproval>) =>
  typeof status === "string" ? status : status?.type;

const TOOLS = Object.keys(createRecruiterTools(recruiterToolContext(createSupabaseMock().client)));
const [UNTRUSTED_READ] = RECRUITER_APPROVAL_POLICY.untrustedContentTools;

describe("RECRUITER_APPROVAL_POLICY", () => {
  it("names only real recruiter tools", () => {
    const { alwaysAsk, untrustedContentTools, gatedWriteTools, creditTools } = RECRUITER_APPROVAL_POLICY;
    for (const name of [...alwaysAsk, ...untrustedContentTools, ...creditTools]) {
      expect(TOOLS, name).toContain(name);
    }
    for (const name of gatedWriteTools.filter((n) => !n.endsWith("Memory"))) {
      expect(TOOLS, name).toContain(name);
    }
  });

  it("alwaysAsk is exactly what recruiterToolApproval always asks for", () => {
    expect(TOOLS.filter((name) => decide(name) === "user-approval").sort()).toEqual(
      [...RECRUITER_APPROVAL_POLICY.alwaysAsk].sort(),
    );
  });

  it("gatedWriteTools ask only after an untrusted read", () => {
    for (const name of RECRUITER_APPROVAL_POLICY.gatedWriteTools) {
      expect(decide(name), name).toBe("not-applicable");
      expect(typeOf(decide(name, [user("hi"), ...ran(UNTRUSTED_READ, "r1")])), name).toBe("user-approval");
    }
  });

  it("creditTools are counted toward the per-turn credit cap", () => {
    const credit = RECRUITER_APPROVAL_POLICY.creditTools;
    const spent = Array.from({ length: AGENT_MAX_CREDIT_CALLS_PER_TURN }, (_, i) =>
      ran(credit[i % credit.length], `c${i}`),
    ).flat();
    for (const name of credit) {
      expect(typeOf(decide(name, [user("hi"), ...spent])), name).toBe("denied");
    }
    expect(typeOf(decide("listMyJobs", [user("hi"), ...spent]))).toBe("not-applicable");
  });
});
