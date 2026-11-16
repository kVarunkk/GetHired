import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type RecordedCall } from "@/test/utils/supabase-mock";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A } from "@/test/utils/team";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { listTalentLists } from "@/helpers/pipeline/talent-lists";
import { loadImportPage } from "./import-page";

vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/pipeline/talent-lists", () => ({ listTalentLists: vi.fn() }));

const STAGES = [
  { id: "50000000-0000-4000-8000-000000000001", name: "Applied" },
  { id: "50000000-0000-4000-8000-000000000002", name: "Onsite" },
];
const PIPELINE = "9e000000-0000-4000-8000-000000000001";
const LIST = { id: "71000000-0000-4000-8000-000000000001", name: "Old ATS", slug: "old-ats" };

function db(
  jobs = [{ id: JOB_A1, title: "Backend Engineer" }, { id: JOB_A2, title: "Designer" }],
  fixed: { id: string; title: string } | null = null,
) {
  const mock = createSupabaseMock();
  // listImportJobs' list, loadFixedJob's single row, and the jobs' pipelines
  // (JPT-024: all on one pipeline here).
  const jobPostings = (call: RecordedCall) => {
    const select = String(call.chain.find((c) => c.method === "select")?.args[0]);
    if (select.includes("pipeline_id")) {
      const all = [...jobs, ...(fixed ? [fixed] : [])];
      return { data: all.map((j) => ({ id: j.id, pipeline_id: PIPELINE })), error: null };
    }
    return call.chain.some((c) => c.method === "maybeSingle")
      ? { data: fixed, error: null }
      : { data: jobs, error: null };
  };
  for (let i = 0; i < 3; i++) mock.queue("job_postings", jobPostings);
  mock.queue("pipeline_stages", {
    data: STAGES.map((s) => ({ ...s, pipeline_id: PIPELINE })),
    error: null,
  });
  mock.queue("job_interview_configs", {
    data: [
      { job_post_id: JOB_A1, enabled: true, invite_rule: "fit_threshold", fit_threshold: 70, duration_minutes: 15 },
      { job_post_id: JOB_A2, enabled: true, invite_rule: "manual", fit_threshold: null, duration_minutes: 20 },
    ],
    error: null,
  });
  return mock;
}

beforeEach(() => {
  vi.mocked(getEntitlements).mockResolvedValue({ entitlements: { screenings: { remaining: 40 } } } as never);
  vi.mocked(listTalentLists).mockResolvedValue([{ ...LIST, memberCount: 3, hasCandidate: false }]);
});

describe("loadImportPage (BI-REQ-010–018)", () => {
  it("loads the jobs with their fit-threshold interviews, the stages, the lists and the screenings left", async () => {
    const mock = db();
    expect(await loadImportPage(mock.client, ADMIN_A.myCompany)).toEqual({
      jobs: [
        { id: JOB_A1, title: "Backend Engineer", interview: { fitThreshold: 70, durationMinutes: 15 } },
        { id: JOB_A2, title: "Designer", interview: null },
      ],
      stagesByJob: { [JOB_A1]: STAGES, [JOB_A2]: STAGES },
      lists: [LIST],
      allowNoJob: true,
      screeningsRemaining: 40,
      fixedJob: null,
      notFound: false,
    });
    expect(mock.callsFor("job_interview_configs")[0].chain).toContainEqual({
      method: "in",
      args: ["job_post_id", [JOB_A1, JOB_A2]],
    });
  });

  it("leaves the lists out without talent_lists.manage, and the extras out when they fail", async () => {
    vi.mocked(getEntitlements).mockRejectedValue(new Error("down"));
    const grants = new Map(ADMIN_A.myCompany.grants);
    grants.delete("talent_lists.manage");
    const noLists = { ...ADMIN_A.myCompany, grants };

    const page = await loadImportPage(db().client, noLists);
    expect(page).toMatchObject({ lists: null, screeningsRemaining: null });
    expect(listTalentLists).not.toHaveBeenCalled();
  });

  it("makes a scoped member pick one of their jobs, and is null without applicants.import", async () => {
    const member = { ...MEMBER_A.myCompany, assignedJobIds: new Set([JOB_A1]) };
    expect(await loadImportPage(db().client, member)).toMatchObject({ allowNoJob: false });
    expect(await loadImportPage(db([]).client, member)).toBeNull();

    const mock = db();
    expect(await loadImportPage(mock.client, HIRING_MANAGER_A.myCompany)).toBeNull();
    expect(mock.calls).toHaveLength(0);
  });

  it("loads a job page's job as fixedJob, with its interview (CP-REQ-010)", async () => {
    const mock = db(undefined, { id: JOB_A1, title: "Backend Engineer" });
    const page = await loadImportPage(mock.client, ADMIN_A.myCompany, { jobId: JOB_A1 });
    expect(page).toMatchObject({
      fixedJob: { id: JOB_A1, title: "Backend Engineer", interview: { fitThreshold: 70, durationMinutes: 15 } },
      notFound: false,
      allowNoJob: true,
      lists: [LIST],
    });
    const fixed = mock.callsFor("job_postings")[1].chain;
    expect(fixed).toContainEqual({ method: "eq", args: ["id", JOB_A1] });
    expect(fixed).toContainEqual({ method: "eq", args: ["company_id", ADMIN_A.myCompany.id] });
  });

  it("flags another company's job, and one a scoped member isn't on, as not found", async () => {
    // RLS-free read scoped by company_id: another company's job comes back empty.
    expect(await loadImportPage(db().client, ADMIN_A.myCompany, { jobId: JOB_A2 })).toMatchObject({
      fixedJob: null,
      notFound: true,
      allowNoJob: true,
    });

    const member = { ...MEMBER_A.myCompany, assignedJobIds: new Set([JOB_A1]) };
    const mock = db([{ id: JOB_A1, title: "Backend Engineer" }]);
    expect(await loadImportPage(mock.client, member, { jobId: JOB_A2 })).toMatchObject({ notFound: true, fixedJob: null });
    // The permission check comes first: the job isn't read.
    expect(
      mock.callsFor("job_postings").some((c) => c.chain.some((m) => m.method === "eq" && m.args[1] === JOB_A2)),
    ).toBe(false);
  });

  it("gives a job-scoped member their job, and no pool", async () => {
    const member = { ...MEMBER_A.myCompany, assignedJobIds: new Set([JOB_A1]) };
    const page = await loadImportPage(db([{ id: JOB_A1, title: "Backend Engineer" }], { id: JOB_A1, title: "Backend Engineer" }).client, member, {
      jobId: JOB_A1,
    });
    expect(page).toMatchObject({ allowNoJob: false, fixedJob: { id: JOB_A1 }, notFound: false });
  });

  it("gives each job its own pipeline's stages (JPT-024)", async () => {
    const OTHER = "9e000000-0000-4000-8000-000000000002";
    const TAKE_HOME = { id: "50000000-0000-4000-8000-000000000003", name: "Take-home" };
    const mock = createSupabaseMock();
    mock.queue("job_postings", {
      data: [
        { id: JOB_A1, title: "Backend Engineer" },
        { id: JOB_A2, title: "Designer" },
      ],
      error: null,
    });
    mock.queue("job_postings", {
      data: [
        { id: JOB_A1, pipeline_id: PIPELINE },
        { id: JOB_A2, pipeline_id: OTHER },
      ],
      error: null,
    });
    mock.queue("pipeline_stages", {
      data: [
        { ...STAGES[0], pipeline_id: PIPELINE },
        { ...TAKE_HOME, pipeline_id: OTHER },
      ],
      error: null,
    });
    mock.queue("job_interview_configs", { data: [], error: null });

    const page = await loadImportPage(mock.client, ADMIN_A.myCompany);
    expect(page?.stagesByJob).toEqual({ [JOB_A1]: [STAGES[0]], [JOB_A2]: [TAKE_HOME] });
    const [, pipelines] = mock.callsFor("job_postings");
    expect(pipelines.chain).toContainEqual({ method: "eq", args: ["company_id", ADMIN_A.myCompany.id] });
    expect(mock.callsFor("pipeline_stages")[0].chain).toContainEqual({
      method: "in",
      args: ["pipeline_id", [PIPELINE, OTHER]],
    });
  });
});
