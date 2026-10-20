import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { draftOutreach, limitWords } from "@/helpers/outreach/draft";
import { mockGenerateModel } from "@/test/utils/ai";
import { setRequestUser, mockUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { INJECTION_LINE, JOB_POST, PII, RESUME_CONTENT } from "@/test/utils/matching";
import { directoryRowOf } from "@/test/utils/outreach";
import { draftOutreachAction } from "./draft-outreach";
import { OWNER_A } from "@/test/utils/team";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@ai-sdk/google", () => ({ google: vi.fn() }));

const CANDIDATE_ID = directoryRowOf().user_id!;
const DRAFT = JSON.stringify({
  subject: "Frontend role at Acme",
  message: "Hi Ada, your design system work stands out. We're hiring a senior frontend engineer. Interested? Answer on GetHired.",
});

let db: SupabaseMock;

const deps = () => ({ supabase: db.client, company: { ...OWNER_A.myCompany, name: "Acme", email: null } });

/** The directory row, with RESUME_CONTENT's sections as the view would store them (contact section dropped). */
const DIRECTORY = directoryRowOf({
  resume_sections: (RESUME_CONTENT.sections ?? []).filter((s) => s.type !== "contact"),
});

function queueHappyPath({ count = 1 } = {}) {
  db.queueRpc("company_can_view_candidate", { data: true, error: null });
  db.queue("candidate_directory", { data: DIRECTORY, error: null });
  db.queue("job_postings", { data: JOB_POST, error: null });
  db.queue("job_relevant_profiles", {
    data: { explanation: { summary: "Strong React match for the senior role.", strengths: [], gaps: [], conflicts: [] }, explanation_status: "completed" },
    error: null,
  });
  db.queueRpc("increment_outreach_drafts", { data: count, error: null });
}

/** The prompt text the model received. */
function promptOf(model: MockLanguageModelV4) {
  return JSON.stringify(model.doGenerateCalls[0].prompt);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
});

describe("draftOutreach (ORT-070, OR-TEST-005)", () => {
  it("drafts from the directory profile, the job and the match summary, never contact fields", async () => {
    queueHappyPath();
    const model = mockGenerateModel(DRAFT);

    const result = await draftOutreach(deps(), { candidateId: CANDIDATE_ID, jobPostId: JOB_POST.id }, { model });

    expect(result).toMatchObject({ ok: true, subject: "Frontend role at Acme" });
    expect(db.callsFor("candidate_directory")).toHaveLength(1);
    expect(db.callsFor("user_info")).toHaveLength(0);
    expect(db.callsFor("resumes")).toHaveLength(0);
    const select = String(db.callsFor("candidate_directory")[0].chain.find((c) => c.method === "select")?.args[0]);
    expect(select).not.toMatch(/email|linkedin|github/);

    const prompt = promptOf(model);
    expect(prompt).toContain(JOB_POST.title);
    expect(prompt).toContain("Strong React match for the senior role.");
    expect(prompt).toContain("<candidate_profile>");
    for (const value of [PII.resumeEmail, PII.resumePhone, PII.resumeUrl]) expect(prompt).not.toContain(value);
  });

  it("keeps an injection line in the resume inside the sandbox", async () => {
    queueHappyPath();
    const model = mockGenerateModel(DRAFT);

    await draftOutreach(deps(), { candidateId: CANDIDATE_ID, jobPostId: JOB_POST.id }, { model });

    const prompt = promptOf(model);
    const open = prompt.indexOf("<resume_excerpt>");
    const close = prompt.indexOf("</resume_excerpt>");
    const injection = prompt.indexOf(INJECTION_LINE);
    expect(injection).toBeGreaterThan(open);
    expect(injection).toBeLessThan(close);
  });

  it("cuts the message to 120 words", async () => {
    queueHappyPath();
    const long = JSON.stringify({ subject: "Hi", message: Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ") });

    const result = await draftOutreach(deps(), { candidateId: CANDIDATE_ID }, { model: mockGenerateModel(long) });

    expect(result.ok && result.message.split(/\s+/)).toHaveLength(120);
  });

  it("refuses the 21st draft of the day without calling the model", async () => {
    queueHappyPath({ count: 21 });
    const model = mockGenerateModel(DRAFT);

    const result = await draftOutreach(deps(), { candidateId: CANDIDATE_ID, jobPostId: JOB_POST.id }, { model });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("20 AI drafts") });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns { ok: false } when the model fails", async () => {
    queueHappyPath();
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("model down");
      },
    });

    expect(await draftOutreach(deps(), { candidateId: CANDIDATE_ID }, { model })).toMatchObject({ ok: false });
  });

  it("treats a candidate the company can't see as not found, before counting", async () => {
    db.queueRpc("company_can_view_candidate", { data: false, error: null });
    const model = mockGenerateModel(DRAFT);

    expect(await draftOutreach(deps(), { candidateId: CANDIDATE_ID }, { model })).toEqual({
      ok: false,
      error: "Candidate not found.",
    });
    expect(db.callsFor("increment_outreach_drafts")).toHaveLength(0);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("charges no credits", async () => {
    queueHappyPath();
    await draftOutreach(deps(), { candidateId: CANDIDATE_ID }, { model: mockGenerateModel(DRAFT) });
    const targets = db.calls.map((c) => c.target);
    expect(targets.filter((t) => /credit|entitlement|consume|hold/.test(t))).toEqual([]);
  });
});

describe("limitWords", () => {
  it("keeps line breaks and stops at the limit", () => {
    expect(limitWords("one two\nthree four", 3)).toBe("one two\nthree");
  });
});

describe("draftOutreachAction", () => {
  it("refuses an applicant", async () => {
    await setRequestUser(mockUser({ type: "applicant" }), db.client);
    expect(await draftOutreachAction({ candidateId: CANDIDATE_ID })).toMatchObject({ ok: false });
  });

  it("rejects a non-UUID candidate", async () => {
    db.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
    await setRequestUser(COMPANY_A.user, db.client);
    expect(await draftOutreachAction({ candidateId: "x" })).toMatchObject({ ok: false });
    expect(db.callsFor("company_can_view_candidate")).toHaveLength(0);
  });
});
