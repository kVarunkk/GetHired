import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";
import { recruiterToolApproval } from "./approval";
import { createRecruiterTools } from "./tools";
import { RA_MAX_EMAIL_ACTIONS_PER_TURN } from "./config";
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

describe("recruiterToolApproval (RA-TEST-002, recruiter half)", () => {
  it("asks before every outward or spending action, and nothing else (RA-REQ-005)", () => {
    expect(TOOLS.filter((name) => decide(name) === "user-approval").sort()).toEqual(
      [
        "createJobPost",
        "updateJobPost",
        "setJobPostStatus",
        "runMatchingForJob",
        "screenApplicants",
        "moveApplications",
        "sendOutreach",
        // RP-REQ-032: every role and hiring-team change.
        "createRole",
        "updateRole",
        "deleteRole",
        "assignRole",
        "assignToJob",
        "unassignFromJob",
      ].sort(),
    );
  });

  it.each([
    "getCandidateProfile",
    "compareCandidates",
    "getApplication",
    "findMatchesForJob",
    "listApplicants",
    "explainMatch",
    "searchCandidates",
    "getJobPost",
    "listNotes",
    "getHiringFunnel",
    "listOutreach",
    "getOutreach",
  ])("gates memory and note writes after %s in the same turn (RA-SEC-003)", (reader) => {
    for (const write of ["saveMemory", "deleteMemory", "addNote"]) {
      expect(typeOf(decide(write, [user("x"), ...ran(reader, "c1")])), write).toBe("user-approval");
    }
  });

  it("lets memory and note writes run freely otherwise", () => {
    expect(decide("saveMemory", [user("x"), ...ran("listMyJobs", "c1")])).toBe("not-applicable");
    expect(decide("addNote", [user("x"), ...ran("listStages", "c1")])).toBe("not-applicable");
    expect(decide("addToTalentList", [user("x"), ...ran("getApplication", "c1")])).toBe("not-applicable");
  });

  it(`denies the email action after ${RA_MAX_EMAIL_ACTIONS_PER_TURN} in a turn (RA-SEC-006)`, () => {
    const messages = [user("x")];
    for (let i = 0; i < RA_MAX_EMAIL_ACTIONS_PER_TURN; i++) {
      messages.push(...ran("moveApplications", `c${i}`));
    }
    const status = decide("moveApplications", messages);
    expect(typeOf(status)).toBe("denied");
    expect((status as { reason: string }).reason).toMatch(/email/i);

    expect(typeOf(decide("moveApplications", messages.slice(0, -2)))).toBe("user-approval");
  });

  it("counts outreach and moves toward the same email cap (RA-SEC-006)", () => {
    const messages = [user("x"), ...ran("sendOutreach", "c1"), ...ran("moveApplications", "c2")];
    expect(typeOf(decide("sendOutreach", messages))).toBe("user-approval");

    messages.push(...ran("sendOutreach", "c3"));
    expect(typeOf(decide("sendOutreach", messages))).toBe("denied");
    expect(typeOf(decide("moveApplications", messages))).toBe("denied");
  });

  it("caps credit-spending calls per turn (RA-SEC-007)", () => {
    const messages = [user("x"), ...ran("screenApplicants", "c1"), ...ran("runMatchingForJob", "c2")];
    expect(typeOf(decide("screenApplicants", messages))).toBe("denied");
    expect(typeOf(decide("explainMatch", messages))).toBe("denied");
  });
});
