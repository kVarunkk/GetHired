import { describe, expect, it, vi } from "vitest";
import { createRecruiterTools } from "./index";
import { inputJsonSchema, recruiterToolContext } from "@/test/utils/tools";
import { createSupabaseMock } from "@/test/utils/supabase-mock";

vi.mock("server-only", () => ({}));

const tools = createRecruiterTools(recruiterToolContext(createSupabaseMock().client));

describe("createRecruiterTools (RAT-028)", () => {
  it("exposes exactly the recruiter's tools for phases 0–6, roles, question sets and the careers page, to an owner", () => {
    expect(Object.keys(tools).sort()).toEqual(
      [
        "getMyCompany",
        "listMyJobs",
        "getJobPost",
        "createJobPost",
        "updateJobPost",
        "setJobPostStatus",
        "deleteJobPost",
        "searchCandidates",
        "findMatchesForJob",
        "runMatchingForJob",
        "getCandidateProfile",
        "compareCandidates",
        "saveCandidate",
        "unsaveCandidate",
        "listApplicants",
        "getApplication",
        "getHiringFunnel",
        "listStages",
        "createStage",
        "renameStage",
        "reorderStages",
        "archiveStage",
        "moveApplications",
        "addNote",
        "listNotes",
        "updateNote",
        "deleteNote",
        "addToTalentList",
        "listTalentLists",
        "renameTalentList",
        "removeFromTalentList",
        "deleteTalentList",
        "listEmailTemplates",
        "createEmailTemplate",
        "updateEmailTemplate",
        "deleteEmailTemplate",
        "explainMatch",
        "screenApplicants",
        "sendOutreach",
        "listOutreach",
        "getOutreach",
        "withdrawOutreach",
        "listTeam",
        "listRoles",
        "listHiringTeams",
        "getAuditLog",
        "getRole",
        "createRole",
        "updateRole",
        "deleteRole",
        "assignRole",
        "setDefaultRole",
        "removeTeamMember",
        "assignToJob",
        "unassignFromJob",
        "listInvites",
        "inviteTeamMember",
        "resendInvite",
        "revokeInvite",
        "listQuestionSets",
        "applyQuestionSet",
        "saveQuestionSet",
        "deleteQuestionSet",
        "getCareersPage",
        "updateCareersPage",
        "setCareersAddress",
        "setCareersPublished",
        "getInterviewSetup",
        "configureScreeningInterview",
        "inviteToInterview",
        "getInterviewReport",
        "compareInterviewReports",
        "saveMemory",
        "deleteMemory",
      ].sort(),
    );
  });

  it("describes every tool", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description?.length ?? 0, name).toBeGreaterThan(20);
    }
  });

  it("never lets the model pass a company or user id (RA-SEC-002)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(JSON.stringify(await inputJsonSchema(tool)), name).not.toMatch(/company_?id|user_?id/i);
    }
  });

  it("leaves approvals to the toolApproval policy and runs every tool on the server", () => {
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.needsApproval, name).toBeUndefined();
      expect(tool.execute, name).toBeTypeOf("function");
    }
  });

  it("shares no applicant-only tools", () => {
    for (const name of ["searchJobs", "startResumeReview", "completeOnboarding", "updateMyPreferences"]) {
      expect(tools).not.toHaveProperty(name);
    }
  });
});
