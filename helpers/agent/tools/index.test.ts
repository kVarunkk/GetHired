import { describe, expect, it } from "vitest";
import { createAgentTools } from "./index";
import { agentToolApproval } from "../approval";
import { inputJsonSchema, toolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";

const tools = createAgentTools(toolContext(createSupabaseMock().client));

describe("createAgentTools", () => {
  it("exposes exactly the agent's tools", () => {
    expect(Object.keys(tools).sort()).toEqual(
      [
        "getMyProfile",
        "updateMyPreferences",
        "searchJobs",
        "naturalLanguageJobSearch",
        "findRelevantJobs",
        "findSimilarJobs",
        "getJobDetails",
        "saveJob",
        "unsaveJob",
        "listSavedJobs",
        "listApplications",
        "updateApplicationStatus",
        "getApplicationForm",
        "submitApplication",
        "listResumes",
        "setPrimaryResume",
        "requestResumeUpload",
        "startResumeReview",
        "getResumeReview",
        "pickResumeForJob",
        "listInterviews",
        "listScreeningInterviews",
        "getInterviewAnalysis",
        "createInterview",
        "completeOnboarding",
        "saveMemory",
        "deleteMemory",
      ].sort(),
    );
  });

  it("describes every tool", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description, name).toBeTruthy();
      expect(tool.description!.length, name).toBeGreaterThan(20);
    }
  });

  it("never lets the model pass a user id (SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      const schema = JSON.stringify(await inputJsonSchema(tool));
      expect(schema, name).not.toMatch(/user_?id/i);
    }
  });

  it("leaves approvals to the toolApproval policy, not the deprecated needsApproval (SEC-012)", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.needsApproval, name).toBeUndefined();
    }
  });

  it("asks for approval only for credit-spending, profile-changing or applying tools (REQ-014)", () => {
    const needingApproval = Object.keys(tools)
      .filter(
        (name) =>
          agentToolApproval({
            toolCall: { toolName: name, toolCallId: "c1" },
            messages: [{ role: "user", content: "hi" }],
          }) === "user-approval",
      )
      .sort();

    expect(needingApproval).toEqual([
      "completeOnboarding",
      "startResumeReview",
      "submitApplication",
      "updateMyPreferences",
    ]);
  });

  it("leaves requestResumeUpload to the client (REQ-015)", () => {
    expect(tools.requestResumeUpload.execute).toBeUndefined();
    for (const [name, tool] of Object.entries(tools)) {
      if (name !== "requestResumeUpload") expect(tool.execute, name).toBeTypeOf("function");
    }
  });
});
