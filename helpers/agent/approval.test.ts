import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { agentToolApproval } from "./approval";

const user = (text: string): ModelMessage => ({ role: "user", content: text });

/** One executed tool call: the assistant's call and its result. */
const ran = (toolName: string, toolCallId: string, denied = false): ModelMessage[] => [
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName, input: {} }],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: denied ? { type: "execution-denied" } : { type: "json", value: {} },
      },
    ],
  },
];

const decide = (toolName: string, messages: ModelMessage[], toolCallId = "current") =>
  agentToolApproval({ toolCall: { toolName, toolCallId }, messages });

const typeOf = (status: ReturnType<typeof agentToolApproval>) =>
  typeof status === "string" ? status : status?.type;

describe("agentToolApproval: approvals (REQ-014, SEC-012)", () => {
  it.each(["startResumeReview", "updateMyPreferences", "completeOnboarding"])(
    "always asks the user before %s",
    (toolName) => {
      expect(decide(toolName, [user("hi")])).toBe("user-approval");
    },
  );

  it.each(["searchJobs", "getJobDetails", "saveJob", "listResumes", "naturalLanguageJobSearch"])(
    "lets %s run without approval",
    (toolName) => {
      expect(decide(toolName, [user("hi")])).toBe("not-applicable");
    },
  );
});

describe("agentToolApproval: memory after untrusted content (SEC-012)", () => {
  it.each(["saveMemory", "deleteMemory"])("runs %s freely in a normal turn", (toolName) => {
    expect(decide(toolName, [user("remember I hate Acme"), ...ran("searchJobs", "c1")])).toBe(
      "not-applicable",
    );
  });

  it.each(["getJobDetails", "getResumeReview", "getInterviewAnalysis"])(
    "asks before saving a memory after %s in the same turn",
    (reader) => {
      const status = decide("saveMemory", [user("look at this job"), ...ran(reader, "c1")]);
      expect(typeOf(status)).toBe("user-approval");
      expect((status as { reason?: string }).reason).toMatch(/memory/i);
    },
  );

  it("asks before deleting a memory after reading a job", () => {
    expect(typeOf(decide("deleteMemory", [user("x"), ...ran("getJobDetails", "c1")]))).toBe(
      "user-approval",
    );
  });

  it("ignores untrusted content from earlier turns", () => {
    const messages = [user("job?"), ...ran("getJobDetails", "c1"), user("remember I like remote")];
    expect(decide("saveMemory", messages)).toBe("not-applicable");
  });

  it("ignores a read that was denied, since it never ran", () => {
    expect(decide("saveMemory", [user("x"), ...ran("getJobDetails", "c1", true)])).toBe(
      "not-applicable",
    );
  });

  it("still asks when the approved call is replayed with itself in the messages", () => {
    const messages = [user("x"), ...ran("getJobDetails", "c1"), ...ran("saveMemory", "current")];
    expect(typeOf(decide("saveMemory", messages))).toBe("user-approval");
  });
});

describe("agentToolApproval: credit cap per turn (SEC-013)", () => {
  it("allows two credit-spending calls in a turn", () => {
    const messages = [user("x"), ...ran("naturalLanguageJobSearch", "c1")];
    expect(decide("naturalLanguageJobSearch", messages)).toBe("not-applicable");
  });

  it("denies a third credit-spending call, with a reason for the model", () => {
    const messages = [
      user("x"),
      ...ran("naturalLanguageJobSearch", "c1"),
      ...ran("naturalLanguageJobSearch", "c2"),
    ];
    const status = decide("naturalLanguageJobSearch", messages);
    expect(typeOf(status)).toBe("denied");
    expect((status as { reason?: string }).reason).toMatch(/2 credit-spending/);
  });

  it("counts resume reviews too, and denies before asking", () => {
    const messages = [
      user("x"),
      ...ran("naturalLanguageJobSearch", "c1"),
      ...ran("startResumeReview", "c2"),
    ];
    expect(typeOf(decide("startResumeReview", messages))).toBe("denied");
  });

  it("doesn't count calls from earlier turns, denied calls, or the call itself", () => {
    const messages = [
      user("a"),
      ...ran("naturalLanguageJobSearch", "c1"),
      ...ran("naturalLanguageJobSearch", "c2"),
      user("b"),
      ...ran("startResumeReview", "c3", true),
      ...ran("naturalLanguageJobSearch", "c4"),
      ...ran("naturalLanguageJobSearch", "current"),
    ];
    expect(decide("naturalLanguageJobSearch", messages)).toBe("not-applicable");
  });
});
