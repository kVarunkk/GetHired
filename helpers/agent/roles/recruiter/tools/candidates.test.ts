import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCandidateTools } from "./candidates";
import { searchProfiles } from "@/helpers/profiles/search-profiles";
import { triggerJobPostingRelevanceUpdate } from "@/app/actions/relevant-profiles-update";
import { execTool, inputJsonSchema, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { CANDIDATE_PROFILE, INJECTION_LINE, JOB_POST, PII, RESUME_CONTENT } from "@/test/utils/matching";
import { scrubPII } from "@/helpers/ai/fairness";
import { RA_RESUME_EXCERPT_MAX_CHARS } from "../config";
import { flushAfter } from "@/test/utils/after";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({
  eventCaptureServerException: vi.fn(),
}));
vi.mock("@/helpers/profiles/search-profiles", () => ({ searchProfiles: vi.fn() }));
vi.mock("@/app/actions/relevant-profiles-update", () => ({
  triggerJobPostingRelevanceUpdate: vi.fn(),
}));

const CANDIDATE_ID = CANDIDATE_PROFILE.user_id;
const OTHER_ID = "a0000000-0000-4000-8000-0000000000ff";
const EXPLANATION = {
  summary: "Strong React and TypeScript match.",
  strengths: ["5 years of React"],
  gaps: ["No Next.js shown"],
  conflicts: [],
};

/** Every contact value in the fixtures; none may reach a tool output (RA-SEC-005). */
const CONTACT = [PII.email, PII.resumeEmail, PII.phone, PII.resumePhone, PII.linkedin, PII.github, PII.resumeUrl];
const expectNoContact = (output: unknown) => {
  const text = JSON.stringify(output);
  for (const value of CONTACT) expect(text).not.toContain(value);
  expect(text).not.toMatch(/"email"|"linkedin|"github/);
};

/** RESUME_CONTENT as candidate_directory returns it: four section types, PII redacted. */
const DIRECTORY_SECTIONS = (RESUME_CONTENT.sections ?? [])
  .filter((section) => ["experience", "skills", "projects", "education"].includes(section.type ?? ""))
  .map((section) => ({
    ...section,
    items: section.items?.map((item) => ({
      ...item,
      bullets: item.bullets?.map((b) => ({ text: scrubPII(b.text ?? "") })),
    })),
  }));

let supabase: SupabaseMock;
let tools: ReturnType<typeof createCandidateTools>;

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  tools = createCandidateTools(recruiterToolContext(supabase.client));
});

describe("candidate tool schemas", () => {
  it("never take a company or user id, or a protected characteristic (RA-SEC-002/004)", async () => {
    for (const [name, tool] of Object.entries(tools)) {
      const schema = JSON.stringify(await inputJsonSchema(tool));
      expect(schema, name).not.toMatch(/company_?id|user_?id/i);
      expect(schema, name).not.toMatch(/"(age|gender|religion|caste|marital\w*|nationality)"/i);
    }
  });

  it("compares 2 to 5 candidates", async () => {
    const ids = (n: number) => Array.from({ length: n }, () => CANDIDATE_ID);
    expect((await validateInput(tools.compareCandidates, { candidateIds: ids(1), jobPostId: JOB_POST.id })).success).toBe(false);
    expect((await validateInput(tools.compareCandidates, { candidateIds: ids(6), jobPostId: JOB_POST.id })).success).toBe(false);
    expect((await validateInput(tools.compareCandidates, { candidateIds: ids(2), jobPostId: JOB_POST.id })).success).toBe(true);
  });
});

describe("searchCandidates tool", () => {
  it("searches the talent pool for the session's company and returns compact rows", async () => {
    vi.mocked(searchProfiles).mockResolvedValue({
      profiles: [CANDIDATE_PROFILE as never],
      nextCursor: "next",
      planLimit: null,
    });

    const result = await execTool(tools.searchCandidates, {
      roles: ["Frontend Engineer"],
      skills: ["React"],
      locations: ["Pune"],
      minExperience: 3,
      maxSalary: 4000000,
    });

    expect(searchProfiles).toHaveBeenCalledWith(COMPANY_A.id, {
      roles: ["Frontend Engineer"],
      skills: ["React"],
      locations: ["Pune"],
      minExperience: 3,
      maxExperience: undefined,
      budget: 4000000,
      jobTypes: undefined,
      workStyle: undefined,
      limit: 10,
      cursor: undefined,
    });
    expect(result).toEqual({
      candidates: [
        {
          id: CANDIDATE_ID,
          name: PII.name,
          roles: ["Frontend Engineer", "UI Engineer"],
          experienceYears: 5,
          locations: ["pune", "remote"],
          topSkills: ["React", "TypeScript", "Jest"],
          salary: "₹1500000–₹2500000",
          workStyle: ["Hybrid"],
          url: `/company/profiles/${CANDIDATE_ID}`,
        },
      ],
      nextCursor: "next",
    });
    expectNoContact(result);
  });

  it("reports the plan's cap on one search", async () => {
    vi.mocked(searchProfiles).mockResolvedValue({ profiles: [], nextCursor: null, planLimit: 5 });

    expect(await execTool(tools.searchCandidates, { skills: ["Go"] })).toMatchObject({
      candidates: [],
      planLimit: 5,
      upgradeUrl: "/company/billing",
    });
  });

  it.each([
    { roles: ["female engineer"] },
    { skills: ["young"] },
    { locations: ["no muslims"] },
    { workStyle: ["unmarried"] },
  ])("refuses a protected characteristic in %j without searching (RA-SEC-004)", async (input) => {
    const result = await execTool(tools.searchCandidates, input);

    expect(result).toMatchObject({ error: "NOT_JOB_RELATED" });
    expect(searchProfiles).not.toHaveBeenCalled();
  });
});

describe("findMatchesForJob tool", () => {
  const job = (matching_status: string) => ({ id: JOB_POST.id, title: JOB_POST.title, matching_status });

  it.each([
    ["pending", "not_run"],
    ["progress", "processing"],
    ["failed", "failed"],
  ])("returns %s matching as %s", async (matchingStatus, status) => {
    supabase.queue("job_postings", { data: job(matchingStatus), error: null });

    expect(await execTool(tools.findMatchesForJob, { jobPostId: JOB_POST.id })).toEqual({
      status,
      jobPostId: JOB_POST.id,
    });
  });

  it("lists matched candidates by rank with scores and sandboxed summaries", async () => {
    supabase.queue("job_postings", { data: job("completed"), error: null });
    supabase.queue("job_relevant_profiles", {
      data: [
        { user_id: CANDIDATE_ID, relevance_rank: 1, match_score: 88, explanation: EXPLANATION, explanation_status: "completed" },
        // Went private since matching: neither the directory nor RLS returns them.
        { user_id: "a0000000-0000-4000-8000-0000000000aa", relevance_rank: 2, match_score: 80, explanation: null, explanation_status: "none" },
        { user_id: OTHER_ID, relevance_rank: 3, match_score: 70, explanation: EXPLANATION, explanation_status: "stale" },
      ],
      error: null,
    });
    supabase.queue("candidate_directory", {
      data: [CANDIDATE_PROFILE, { ...CANDIDATE_PROFILE, user_id: OTHER_ID }],
      error: null,
    });
    supabase.queue("user_info", { data: [], error: null });

    const result = (await execTool(tools.findMatchesForJob, { jobPostId: JOB_POST.id, limit: 5 })) as {
      candidates: Record<string, unknown>[];
    };

    expect(supabase.callsFor("job_postings")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    const matchQuery = supabase.callsFor("job_relevant_profiles")[0].chain;
    expect(matchQuery).toContainEqual({ method: "eq", args: ["job_posting_id", JOB_POST.id] });
    expect(matchQuery).toContainEqual({ method: "limit", args: [5] });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toMatchObject({
      id: CANDIDATE_ID,
      rank: 1,
      matchScore: 88,
      matchSummary: "<match_explanation>\nStrong React and TypeScript match.\n</match_explanation>",
      url: `/company/profiles/${CANDIDATE_ID}?job_post=${JOB_POST.id}`,
    });
    // A stale explanation isn't shown.
    expect(result.candidates[1].matchSummary).toBeNull();
    expectNoContact(result);
  });

  it("treats another company's job as not found", async () => {
    supabase.queue("job_postings", { data: null, error: null });

    expect(await execTool(tools.findMatchesForJob, { jobPostId: JOB_POST.id })).toEqual({
      error: "Job post not found.",
    });
  });
});

describe("runMatchingForJob tool", () => {
  it("starts matching through the shared action", async () => {
    vi.mocked(triggerJobPostingRelevanceUpdate).mockResolvedValue({ success: true, message: "processing started" });

    expect(await execTool(tools.runMatchingForJob, { jobPostId: JOB_POST.id })).toEqual({
      status: "processing",
      jobPostId: JOB_POST.id,
      note: "The company gets an email when matching finishes.",
    });
    expect(triggerJobPostingRelevanceUpdate).toHaveBeenCalledWith(JOB_POST.id);
  });

  it("passes its error through", async () => {
    vi.mocked(triggerJobPostingRelevanceUpdate).mockResolvedValue({
      success: false,
      error: "Matching is already in progress for this job.",
    });

    expect(await execTool(tools.runMatchingForJob, { jobPostId: JOB_POST.id })).toEqual({
      error: "Matching is already in progress for this job.",
    });
  });
});

describe("getCandidateProfile tool", () => {
  function queueProfile() {
    supabase.queueRpc("company_can_view_candidate", { data: true, error: null });
    supabase.queueRpc("company_has_candidate_access", { data: false, error: null });
    supabase.queue("candidate_directory", {
      data: { ...CANDIDATE_PROFILE, resume_sections: DIRECTORY_SECTIONS },
      error: null,
    });
    supabase.queue("job_relevant_profiles", {
      data: [
        {
          match_score: 88,
          explanation: EXPLANATION,
          explanation_status: "completed",
          job_postings: { id: JOB_POST.id, title: JOB_POST.title, company_id: COMPANY_A.id },
        },
      ],
      error: null,
    });
    supabase.queue("applications", {
      data: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          status: "reviewed",
          created_at: "2026-10-01T00:00:00.000Z",
          job_postings: { id: JOB_POST.id, title: JOB_POST.title, company_id: COMPANY_A.id },
        },
      ],
      error: null,
    });
    supabase.queue("company_favorites", { data: [{ id: "f1" }], error: null });
  }

  it("returns a sandboxed profile, resume excerpt, matches and applications, with no contact details", async () => {
    queueProfile();

    const result = (await execTool(tools.getCandidateProfile, {
      candidateId: CANDIDATE_ID,
      jobPostId: JOB_POST.id,
    })) as Record<string, unknown>;

    expect(supabase.callsFor("company_can_view_candidate")[0].chain[0].args[1]).toEqual({
      p_user_id: CANDIDATE_ID,
    });
    expect(result).toMatchObject({
      id: CANDIDATE_ID,
      name: PII.name,
      saved: true,
      url: `/company/profiles/${CANDIDATE_ID}?job_post=${JOB_POST.id}`,
      applications: [
        {
          applicationId: "e0000000-0000-4000-8000-000000000001",
          jobTitle: JOB_POST.title,
          status: "reviewed",
          url: "/company/applicants/e0000000-0000-4000-8000-000000000001",
        },
      ],
    });
    expect(result.careerGoals).toMatch(/^<candidate_profile>\n[\s\S]*Lead a frontend platform team/);
    expect(result.resumeExcerpt).toMatch(/^<resume_excerpt>\n/);
    expect(result.resumeExcerpt).toContain("Cut the dashboard's load time");
    // Candidate text is data: the injection line stays inside the sandbox.
    const excerpt = String(result.resumeExcerpt);
    expect(excerpt.indexOf(INJECTION_LINE)).toBeGreaterThan(excerpt.indexOf("<resume_excerpt>"));
    expect(String(result.resumeExcerpt).length).toBeLessThan(RA_RESUME_EXCERPT_MAX_CHARS + 60);
    expect(JSON.stringify(result.matches)).toContain("<match_explanation>");
    expectNoContact(result);
    // Without access: the directory profile only (ORT-045, RA-SEC-005).
    expect(supabase.callsFor("user_info")).toHaveLength(0);
    expect(supabase.callsFor("resumes")).toHaveLength(0);
    expect(result.contactNote).toMatch(/answers Interested/);
  });

  it("includes the company's latest outreach to the candidate, or null (RAT-051)", async () => {
    queueProfile();
    supabase.queue("candidate_outreach", {
      data: [
        { id: "o2", candidate_user_id: CANDIDATE_ID, status: "sent", sent_at: "2026-10-10T09:00:00.000Z" },
        { id: "o1", candidate_user_id: CANDIDATE_ID, status: "expired", sent_at: "2026-08-01T09:00:00.000Z" },
      ],
      error: null,
    });

    const result = (await execTool(tools.getCandidateProfile, { candidateId: CANDIDATE_ID })) as Record<string, unknown>;

    expect(result.outreach).toEqual({ id: "o2", status: "sent", sentAt: "2026-10-10", url: "/company/outreach/o2" });
    const chain = supabase.callsFor("candidate_outreach")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "in", args: ["candidate_user_id", [CANDIDATE_ID]] });

    queueProfile();
    supabase.queue("candidate_outreach", { data: null, error: { message: "boom" } });
    const none = (await execTool(tools.getCandidateProfile, { candidateId: CANDIDATE_ID })) as Record<string, unknown>;
    expect(none.outreach).toBeNull();
  });

  it("adds contact details once the candidate applied or answered Interested", async () => {
    supabase.queueRpc("company_can_view_candidate", { data: true, error: null });
    supabase.queueRpc("company_has_candidate_access", { data: true, error: null });
    supabase.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
    supabase.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });

    const result = (await execTool(tools.getCandidateProfile, { candidateId: CANDIDATE_ID })) as Record<string, unknown>;

    expect(result.contact).toEqual({ email: PII.email, linkedin: PII.linkedin, github: PII.github });
    expect(result).not.toHaveProperty("contactNote");
    expect(supabase.callsFor("candidate_directory")).toHaveLength(0);
  });

  it("records one profile view after the read, and a failed record doesn't fail the tool (OR-REQ-020)", async () => {
    queueProfile();
    supabase.queueRpc("record_profile_view", { data: null, error: { message: "boom" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = (await execTool(tools.getCandidateProfile, { candidateId: CANDIDATE_ID })) as Record<string, unknown>;
    expect(result.id).toBe(CANDIDATE_ID);
    expect(supabase.callsFor("record_profile_view")).toHaveLength(0);

    await flushAfter();

    const calls = supabase.callsFor("record_profile_view");
    expect(calls).toHaveLength(1);
    expect(calls[0].chain[0].args[1]).toEqual({ p_candidate: CANDIDATE_ID });
    spy.mockRestore();
  });

  it("treats a candidate the company can't see as not found", async () => {
    supabase.queueRpc("company_can_view_candidate", { data: false, error: null });

    expect(await execTool(tools.getCandidateProfile, { candidateId: OTHER_ID })).toEqual({
      error: "Candidate not found.",
    });
    await flushAfter();
    expect(supabase.callsFor("record_profile_view")).toHaveLength(0);
    expect(supabase.callsFor("user_info")).toHaveLength(0);
    expect(supabase.callsFor("candidate_directory")).toHaveLength(0);
  });
});

describe("compareCandidates tool", () => {
  it("lines candidates up for one of the company's jobs, with match and fit scores", async () => {
    supabase.queue("job_postings", { data: { id: JOB_POST.id, title: JOB_POST.title }, error: null });
    supabase.queue("candidate_directory", { data: [CANDIDATE_PROFILE], error: null });
    supabase.queue("user_info", { data: [], error: null });
    supabase.queue("job_relevant_profiles", {
      data: [{ user_id: CANDIDATE_ID, match_score: 88, explanation: EXPLANATION, explanation_status: "completed" }],
      error: null,
    });
    supabase.queue("applications", {
      data: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          applicant_user_id: CANDIDATE_ID,
          status: "submitted",
          application_screenings: { status: "completed", fit_score: 81, recommendation: "yes" },
        },
      ],
      error: null,
    });

    const result = (await execTool(tools.compareCandidates, {
      candidateIds: [CANDIDATE_ID, OTHER_ID],
      jobPostId: JOB_POST.id,
    })) as { job: unknown; candidates: Record<string, unknown>[] };

    expect(result.job).toEqual({ id: JOB_POST.id, title: JOB_POST.title });
    expect(result.candidates[0]).toMatchObject({
      id: CANDIDATE_ID,
      matchScore: 88,
      application: {
        id: "e0000000-0000-4000-8000-000000000001",
        status: "submitted",
        fitScore: 81,
        recommendation: "yes",
        url: "/company/applicants/e0000000-0000-4000-8000-000000000001",
      },
    });
    expect(String(result.candidates[0].matchDetails)).toMatch(/^<match_explanation>/);
    expect(result.candidates[1]).toEqual({ id: OTHER_ID, error: "Candidate not found." });
    expectNoContact(result);
  });

  it("treats another company's job as not found", async () => {
    supabase.queue("job_postings", { data: null, error: null });

    expect(
      await execTool(tools.compareCandidates, { candidateIds: [CANDIDATE_ID, OTHER_ID], jobPostId: JOB_POST.id }),
    ).toEqual({ error: "Job post not found." });
  });
});

describe("saveCandidate and unsaveCandidate tools", () => {
  it("saves a visible candidate once", async () => {
    supabase.queueRpc("company_can_view_candidate", { data: true, error: null });
    supabase.queue("company_favorites", { data: [], error: null });

    expect(await execTool(tools.saveCandidate, { candidateId: CANDIDATE_ID })).toEqual({
      candidateId: CANDIDATE_ID,
      saved: true,
    });
    const [, insert] = supabase.callsFor("company_favorites");
    expect(insert.chain[0]).toEqual({
      method: "insert",
      args: [{ company_id: COMPANY_A.id, user_id: CANDIDATE_ID }],
    });
  });

  it("doesn't save twice", async () => {
    supabase.queueRpc("company_can_view_candidate", { data: true, error: null });
    supabase.queue("company_favorites", { data: [{ id: "f1" }], error: null });

    await execTool(tools.saveCandidate, { candidateId: CANDIDATE_ID });

    expect(supabase.callsFor("company_favorites")).toHaveLength(1);
  });

  it("refuses a candidate the company can't see", async () => {
    supabase.queueRpc("company_can_view_candidate", { data: false, error: null });

    expect(await execTool(tools.saveCandidate, { candidateId: OTHER_ID })).toEqual({
      error: "Candidate not found.",
    });
  });

  it("unsaves within the company", async () => {
    expect(await execTool(tools.unsaveCandidate, { candidateId: CANDIDATE_ID })).toEqual({
      candidateId: CANDIDATE_ID,
      saved: false,
    });
    const chain = supabase.callsFor("company_favorites")[0].chain;
    expect(chain[0].method).toBe("delete");
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", CANDIDATE_ID] });
  });
});
