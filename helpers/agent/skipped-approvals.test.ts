import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  isSkippedApproval,
  SKIPPED_APPROVAL_REASON,
  skipApprovalsBeforeNewMessage,
  skipPendingApprovals,
} from "./skipped-approvals";

const pendingPart = {
  type: "tool-updateMyPreferences",
  toolCallId: "c1",
  state: "approval-requested",
  input: { minSalary: 1000000 },
  approval: { id: "ap1" },
};
const donePart = {
  type: "tool-searchJobs",
  toolCallId: "c0",
  state: "output-available",
  input: {},
  output: { jobs: [] },
};
const reply = (parts: unknown[]): UIMessage => ({ id: "a1", role: "assistant", parts }) as UIMessage;
const user = (id: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: "hi" }] });

describe("skipPendingApprovals", () => {
  it("marks each unanswered approval denied with the skip reason, and leaves other parts", () => {
    const skipped = skipPendingApprovals(reply([donePart, { type: "text", text: "Shall I?" }, pendingPart]));

    expect(skipped?.parts[0]).toEqual(donePart);
    expect(skipped?.parts[1]).toEqual({ type: "text", text: "Shall I?" });
    expect(skipped?.parts[2]).toMatchObject({
      toolCallId: "c1",
      input: { minSalary: 1000000 },
      state: "output-denied",
      approval: { id: "ap1", approved: false, reason: SKIPPED_APPROVAL_REASON },
    });
    expect(isSkippedApproval(skipped!.parts[2])).toBe(true);
  });

  it("returns null when nothing is waiting, or for a user message", () => {
    expect(skipPendingApprovals(reply([donePart]))).toBeNull();
    expect(skipPendingApprovals(user("u1"))).toBeNull();
  });

  it("doesn't count a Deny the user pressed as skipped", () => {
    const denied = { ...pendingPart, state: "output-denied", approval: { id: "ap1", approved: false, reason: "no" } };
    expect(isSkippedApproval(denied as UIMessage["parts"][number])).toBe(false);
  });
});

describe("skipApprovalsBeforeNewMessage", () => {
  it("skips only the latest reply's approvals", () => {
    const messages = [user("u1"), reply([pendingPart])];
    const next = skipApprovalsBeforeNewMessage(messages);

    expect(next[0]).toBe(messages[0]);
    expect(next[1].parts[0]).toMatchObject({ state: "output-denied" });
  });

  it("returns the same array when there's nothing to skip", () => {
    const messages = [user("u1"), reply([donePart])];
    expect(skipApprovalsBeforeNewMessage(messages)).toBe(messages);
    expect(skipApprovalsBeforeNewMessage([])).toEqual([]);
  });
});
