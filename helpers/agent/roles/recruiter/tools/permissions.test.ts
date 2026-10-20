import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { execTool, recruiterToolContext } from "@/test/utils/tools";
import {
  ADMIN_A,
  HIRING_MANAGER_A,
  JOB_A1,
  JOB_A2,
  MEMBER_A,
  OWNER_A,
  memberWith,
  type MemberFixture,
} from "@/test/utils/team";
import { isPermissionKey } from "@/helpers/companies/permissions";
import { buildRecruiterSystemPrompt } from "../system-prompt";
import { createAllRecruiterTools, createRecruiterTools } from "./index";
import { hasAssignedScope, missingAbilities, RECRUITER_TOOL_PERMISSIONS } from "./permissions";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/matching/queue-screenings", () => ({ queueJobScreenings: vi.fn() }));
vi.mock("@/helpers/outreach/send", () => ({ sendOutreach: vi.fn() }));
vi.mock("@/helpers/pipeline/move", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/move")>()),
  moveApplications: vi.fn(),
}));
vi.mock("@/helpers/pipeline/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/pipeline/notes")>()),
  addNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
}));

import { queueJobScreenings } from "@/helpers/matching/queue-screenings";
import { sendOutreach } from "@/helpers/outreach/send";
import { moveApplications } from "@/helpers/pipeline/move";
import { addNote, deleteNote, updateNote } from "@/helpers/pipeline/notes";

const A1_APP = "e0000000-0000-4000-8000-0000000000a1";
const A2_APP = "e0000000-0000-4000-8000-0000000000a2";
const CANDIDATE = "a0000000-0000-4000-8000-000000000001";
const STAGE = "f0000000-0000-4000-8000-0000000000a1";

let db: SupabaseMock;

function toolsFor(member: MemberFixture) {
  return createRecruiterTools(
    recruiterToolContext(db.client, { user: member.user, company: member.myCompany }),
  ) as Record<string, Parameters<typeof execTool>[0]>;
}

/** application_job_id answers each application's job, for the scope check. */
function jobOfApplications() {
  db.queueRpc("application_job_id", (call) => {
    const id = (call.chain[0].args[1] as { p_application_id: string }).p_application_id;
    return { data: id === A1_APP ? JOB_A1 : id === A2_APP ? JOB_A2 : null, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
});

describe("RECRUITER_TOOL_PERMISSIONS (RP-REQ-030, RP-TEST-008)", () => {
  it("has an entry for every tool, and every entry is a tool with real catalog keys", () => {
    const tools = Object.keys(createAllRecruiterTools(recruiterToolContext(db.client))).sort();
    expect(Object.keys(RECRUITER_TOOL_PERMISSIONS).sort()).toEqual(tools);
    for (const rule of Object.values(RECRUITER_TOOL_PERMISSIONS)) {
      for (const key of rule.keys) expect(isPermissionKey(key), key).toBe(true);
    }
  });

  it("gives an owner every tool", () => {
    expect(Object.keys(toolsFor(OWNER_A)).sort()).toEqual(Object.keys(RECRUITER_TOOL_PERMISSIONS).sort());
  });

  it("leaves out what the role can't do", () => {
    const member = Object.keys(toolsFor(MEMBER_A));
    for (const name of ["createJobPost", "updateJobPost", "setJobPostStatus", "createRole", "assignRole", "assignToJob"]) {
      expect(member, name).not.toContain(name);
    }
    expect(member).toEqual(expect.arrayContaining(["sendOutreach", "listApplicants", "listTeam", "listRoles"]));

    expect(Object.keys(toolsFor(memberWith(["applicants.view"]))).sort()).toEqual(
      expect.arrayContaining(["listApplicants", "getApplication", "getCandidateProfile", "listMyJobs"]),
    );
    const noOutreach = Object.keys(toolsFor(memberWith(["applicants.view"])));
    expect(noOutreach).not.toContain("sendOutreach");
    expect(noOutreach).not.toContain("searchCandidates");
  });

  it("names what's missing in one prompt line, and nothing for an owner", () => {
    expect(missingAbilities({ company: OWNER_A.myCompany })).toEqual([]);

    const cannot = missingAbilities({ company: memberWith(["applicants.view"]).myCompany });
    expect(cannot).toEqual(expect.arrayContaining(["send outreach", "create job posts", "manage roles"]));

    const prompt = (company: MemberFixture) =>
      buildRecruiterSystemPrompt({
        context: { company: { name: "Acme" }, plan: null, jobs: [] },
        memories: [],
        now: new Date("2026-10-17T00:00:00Z"),
        summary: null,
        toolNames: Object.keys(toolsFor(company)),
        roleLimits: { cannot: missingAbilities({ company: company.myCompany }), assignedOnly: hasAssignedScope({ company: company.myCompany }) },
      });
    const limited = prompt(memberWith(["applicants.view"]));
    expect(limited.match(/You can't: /g)).toHaveLength(1);
    expect(limited).toMatch(/You can't: [^\n]*send outreach/);
    expect(prompt(OWNER_A)).not.toMatch(/You can't|The user's role/);
    expect(prompt(HIRING_MANAGER_A)).toMatch(/only the jobs they're assigned to/);
  });
});

describe("per-call checks (RP-REQ-031, RPT-081)", () => {
  it("refuses the Hiring manager's job tools for job A2, with no write", async () => {
    const tools = toolsFor(HIRING_MANAGER_A);

    expect(await execTool(tools.listApplicants, { jobPostId: JOB_A2 })).toEqual({
      error: "Your role can't view applicants for this job.",
    });
    expect(await execTool(tools.findMatchesForJob, { jobPostId: JOB_A2 })).toEqual({
      error: "Your role can't run matching for this job.",
    });
    expect(await execTool(tools.screenApplicants, { jobPostId: JOB_A2 })).toEqual({
      error: "Your role can't run AI screening for this job.",
    });
    expect(await execTool(tools.sendOutreach, { candidateId: CANDIDATE, jobPostId: JOB_A2, subject: "Hi", message: "Hello" })).toEqual({
      error: "Your role can't send outreach for this job.",
    });
    // Without a job, outreach needs scope all (RP-REQ-002).
    expect(await execTool(tools.sendOutreach, { candidateId: CANDIDATE, subject: "Hi", message: "Hello" })).toEqual({
      error: "Your role can't send outreach.",
    });

    jobOfApplications();
    expect(await execTool(tools.getApplication, { applicationId: A2_APP })).toEqual({
      error: "Your role can't view applicants for this job.",
    });
    jobOfApplications();
    jobOfApplications();
    expect(await execTool(tools.moveApplications, { applicationIds: [A1_APP, A2_APP], stageId: STAGE })).toEqual({
      error: "Your role can't move applicants for this job.",
    });
    jobOfApplications();
    expect(await execTool(tools.addNote, { applicationId: A2_APP, body: "Strong" })).toEqual({
      error: "Your role can't write notes for this job.",
    });

    expect(queueJobScreenings).not.toHaveBeenCalled();
    expect(sendOutreach).not.toHaveBeenCalled();
    expect(moveApplications).not.toHaveBeenCalled();
    expect(addNote).not.toHaveBeenCalled();
    expect(db.calls.filter((c) => c.kind === "from")).toHaveLength(0);
  });

  it("lets the same calls through for job A1", async () => {
    const tools = toolsFor(HIRING_MANAGER_A);
    vi.mocked(queueJobScreenings).mockResolvedValue({ ok: true, queued: 2 });

    expect(await execTool(tools.screenApplicants, { jobPostId: JOB_A1 })).toMatchObject({ queued: 2 });
    expect(queueJobScreenings).toHaveBeenCalledWith(expect.anything(), JOB_A1);
  });

  it("scopes note edits by the note's application, and a candidate note needs scope all", async () => {
    const tools = toolsFor(HIRING_MANAGER_A);
    const NOTE = "70e00000-0000-4000-8000-0000000000aa";

    db.queue("candidate_notes", { data: { application_id: A2_APP }, error: null });
    jobOfApplications();
    expect(await execTool(tools.updateNote, { noteId: NOTE, body: "Edited" })).toEqual({
      error: "Your role can't write notes for this job.",
    });
    db.queue("candidate_notes", { data: { application_id: null }, error: null });
    expect(await execTool(tools.deleteNote, { noteId: NOTE })).toEqual({
      error: "Your role can't write notes.",
    });
    db.queue("candidate_notes", { data: null, error: null });
    expect(await execTool(tools.deleteNote, { noteId: NOTE })).toEqual({ error: "Note not found." });
    expect(updateNote).not.toHaveBeenCalled();
    expect(deleteNote).not.toHaveBeenCalled();

    db.queue("candidate_notes", { data: { application_id: A1_APP }, error: null });
    jobOfApplications();
    vi.mocked(deleteNote).mockResolvedValue({ ok: true });
    expect(await execTool(tools.deleteNote, { noteId: NOTE })).toEqual({ noteId: NOTE, deleted: true });
  });

  it("leaves the stage tools out without settings.stages", () => {
    const stageTools = ["createStage", "renameStage", "reorderStages", "archiveStage"];
    const names = Object.keys(toolsFor(memberWith(["applicants.view"])));
    expect(names).toContain("listStages");
    for (const name of stageTools) expect(names, name).not.toContain(name);
    expect(Object.keys(toolsFor(memberWith(["settings.stages"])))).toEqual(expect.arrayContaining(stageTools));
  });

  it("leaves the email template tools out without settings.templates", () => {
    const templateTools = ["listEmailTemplates", "createEmailTemplate", "updateEmailTemplate", "deleteEmailTemplate"];
    const names = Object.keys(toolsFor(memberWith(["applicants.view", "settings.stages"])));
    for (const name of templateTools) expect(names, name).not.toContain(name);
    expect(Object.keys(toolsFor(memberWith(["settings.templates"])))).toEqual(expect.arrayContaining(templateTools));
  });

  it("leaves the talent list writes out without talent_lists.manage", () => {
    const names = Object.keys(toolsFor(memberWith(["talent.view"])));
    expect(names).toContain("listTalentLists");
    for (const name of ["renameTalentList", "removeFromTalentList", "deleteTalentList"]) {
      expect(names, name).not.toContain(name);
    }
    expect(Object.keys(toolsFor(memberWith(["talent.view", "talent_lists.manage"])))).toEqual(
      expect.arrayContaining(["renameTalentList", "removeFromTalentList", "deleteTalentList"]),
    );
  });

  it("calls an unknown application not found", async () => {
    const tools = toolsFor(HIRING_MANAGER_A);
    db.queueRpc("application_job_id", { data: null, error: null });

    expect(await execTool(tools.getApplication, { applicationId: "e0000000-0000-4000-8000-0000000000ff" })).toEqual({
      error: "Application not found.",
    });
  });

  it("uses permissions as they are now: a changed role applies from the next request (RP-SEC-004)", async () => {
    // Each request builds its context from a fresh my_company_access(); a
    // narrower role in the next request has no screenApplicants at all.
    expect(Object.keys(toolsFor(ADMIN_A))).toContain("screenApplicants");
    expect(Object.keys(toolsFor(memberWith(["applicants.view"])))).not.toContain("screenApplicants");
  });
});
