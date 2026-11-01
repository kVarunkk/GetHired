import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCandidateTools } from "./candidates";
import { execTool, recruiterToolContext, validateInput } from "@/test/utils/tools";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { JOB_A1, JOB_A2, memberWith } from "@/test/utils/team";
import { createRecruiterMemoryTools } from "./memory";
import { upsertMemory } from "@/helpers/agent/memory";

vi.mock("server-only", () => ({}));
vi.mock("@/helpers/posthog/EventCaptureServerException", () => ({ eventCaptureServerException: vi.fn() }));
vi.mock("@/helpers/profiles/search-profiles", () => ({ searchProfiles: vi.fn() }));
vi.mock("@/helpers/profiles/queue-job-relevance", () => ({ queueJobPostingRelevance: vi.fn() }));
vi.mock("@/helpers/agent/memory", async (orig) => ({ ...(await orig()), upsertMemory: vi.fn() }));

const c = (n: number) => `cc000000-0000-4000-8000-00000000000${n}`;
const SECRET = { email: "meera.secret@mail.test", phone: "+91 98765 43210", link: "https://linkedin.com/in/meera" };

let db: SupabaseMock;
let tools: ReturnType<typeof createCandidateTools>;

const matchesRpc = (matches: unknown[], extra: Record<string, unknown> = {}) =>
  db.queueRpc("match_company_candidates", {
    data: { ok: true, job_embedded: true, pool_size: 4, matches, ...extra },
    error: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
  tools = createCandidateTools(recruiterToolContext(db.client));
});

describe("findPoolCandidates tool (CPT-057, CP-REQ-063)", () => {
  it("lists the company's candidates matching a job, sandboxed, with no contact details", async () => {
    matchesRpc([
      { company_candidate_id: c(1), similarity: 0.85, has_email: true, has_resume: true },
      { company_candidate_id: c(2), similarity: 0.6, has_email: false, has_resume: false },
    ]);
    db.queue("company_candidates", {
      data: [
        {
          id: c(1),
          full_name: "Meera Iyer",
          current_title: "Backend Engineer",
          location: "pune",
          experience_years: 6,
          skills: Array.from({ length: 30 }, (_, i) => `skill${i}`),
          // Even if a select ever returned them.
          email: SECRET.email,
          phone: SECRET.phone,
          links: { linkedin: SECRET.link },
        },
        { id: c(2), full_name: "Ravi", current_title: null, location: null, experience_years: null, skills: [] },
      ],
      error: null,
    });

    const result = (await execTool(tools.findPoolCandidates, { jobPostId: JOB_A1, limit: 5 })) as {
      candidates: Record<string, unknown>[];
    };

    expect(db.callsFor("match_company_candidates")[0].chain[0].args[1]).toEqual({ p_job_id: JOB_A1, p_limit: 5 });
    expect(result.candidates).toHaveLength(2);
    const meera = result.candidates[0];
    expect(meera).toMatchObject({
      candidateId: c(1),
      experienceYears: 6,
      similarity: 100,
      hasResume: true,
      hasEmail: true,
      url: `/company/candidates/${c(1)}`,
    });
    expect(meera.name).toBe("<candidate_name>\nMeera Iyer\n</candidate_name>");
    expect(meera.title).toBe("<candidate_title>\nBackend Engineer\n</candidate_title>");
    expect(String(meera.skills).match(/skill\d+/g)).toHaveLength(15);
    expect(String(meera.skills)).toMatch(/^<candidate_skills>/);
    expect(result.candidates[1]).toMatchObject({ hasEmail: false, title: null, skills: null });

    const text = JSON.stringify(result);
    for (const value of Object.values(SECRET)) expect(text).not.toContain(value);
    expect(text).not.toMatch(/"email"|"phone"|"links"/);
  });

  it("says when the job isn't read yet, or there are no candidates to match", async () => {
    matchesRpc([], { job_embedded: false });
    expect(await execTool(tools.findPoolCandidates, { jobPostId: JOB_A1 })).toMatchObject({ status: "job_not_ready" });

    matchesRpc([], { pool_size: 0 });
    expect(await execTool(tools.findPoolCandidates, { jobPostId: JOB_A1 })).toMatchObject({ status: "no_candidates" });

    matchesRpc([]);
    expect(await execTool(tools.findPoolCandidates, { jobPostId: JOB_A1 })).toEqual({ candidates: [] });
  });

  it("needs jobs.view for the job", async () => {
    const scoped = memberWith(["talent.view", { key: "jobs.view", scope: "assigned" }], { assignedJobIds: [JOB_A2] });
    const own = createCandidateTools(recruiterToolContext(db.client, { company: scoped.myCompany }));
    expect(await execTool(own.findPoolCandidates, { jobPostId: JOB_A1 })).toEqual({
      error: "Your role can't view job posts for this job.",
    });
    expect(db.callsFor("match_company_candidates")).toHaveLength(0);
  });

  it("passes the RPC's refusal on", async () => {
    db.queueRpc("match_company_candidates", { data: { ok: false, reason: "not_found" }, error: null });
    expect(await execTool(tools.findPoolCandidates, { jobPostId: JOB_A1 })).toEqual({
      error: "Not found. It may have been deleted.",
    });
  });
});

describe("addCandidatesToJob tool (CPT-058, CP-REQ-063)", () => {
  it("adds up to 50 of the company's candidates to a job, emailing no one", async () => {
    db.queueRpc("add_candidates_to_job", {
      data: { ok: true, counts: { added_to_job: 2, no_email: 1 } },
      error: null,
    });

    const result = await execTool(tools.addCandidatesToJob, {
      jobPostId: JOB_A1,
      candidateIds: [c(1), c(2), c(3)],
      stageId: "5a000000-0000-4000-8000-000000000001",
    });

    expect(db.callsFor("add_candidates_to_job")[0].chain[0].args[1]).toEqual({
      p_job_id: JOB_A1,
      p_candidate_ids: [c(1), c(2), c(3)],
      p_stage_id: "5a000000-0000-4000-8000-000000000001",
    });
    expect(result).toMatchObject({
      counts: { added_to_job: 2, no_email: 1 },
      summary: "2 candidates added to the job · 1 has no email",
      applicationsUrl: `/company/job-posts/${JOB_A1}/applications`,
    });
    // The tool never touches an email queue itself; the RPC queues nothing (BI-REQ-005).
    expect(db.calls.filter((call) => /email|send/.test(call.target))).toHaveLength(0);
  });

  it("takes 1 to 50 ids", async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `cc000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect((await validateInput(tools.addCandidatesToJob, { jobPostId: JOB_A1, candidateIds: [] })).success).toBe(false);
    expect((await validateInput(tools.addCandidatesToJob, { jobPostId: JOB_A1, candidateIds: ids(51) })).success).toBe(false);
    expect((await validateInput(tools.addCandidatesToJob, { jobPostId: JOB_A1, candidateIds: ids(50) })).success).toBe(true);
  });

  it("passes the RPC's refusal on", async () => {
    db.queueRpc("add_candidates_to_job", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await execTool(tools.addCandidatesToJob, { jobPostId: JOB_A1, candidateIds: [c(1)] })).toEqual({
      error: "Your role can't import applicants here.",
    });
  });
});

describe("memories never hold a pool match's similarity (CPT-058)", () => {
  const save = (content: string) =>
    execTool(createRecruiterMemoryTools(recruiterToolContext(db.client)).saveMemory, { content, category: "preference" });

  it.each(["Meera has similarity 91 for the backend job", "Ravi's match score is 72", "Asha: similarity 0.84"])(
    "refuses %j",
    async (content) => {
      expect(((await save(content)) as { error?: string }).error).toBe("PER_CANDIDATE_SCORE");
      expect(upsertMemory).not.toHaveBeenCalled();
    },
  );

  it("allows a bar", async () => {
    vi.mocked(upsertMemory).mockResolvedValue({ ok: true, memory: { id: "m1", content: "x" } } as never);
    const result = (await save("Only look at pool matches with similarity at least 70")) as { error?: string };
    expect(result.error).not.toBe("PER_CANDIDATE_SCORE");
  });
});
