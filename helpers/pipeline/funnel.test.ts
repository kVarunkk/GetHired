import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseMock,
  type SupabaseMock,
} from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { PIPELINE_JOB, stageOf } from "@/test/utils/pipeline";
import { NEEDS_ATTENTION_DAYS, getCompanyFunnel, getJobFunnel } from "./funnel";

vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-15T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();
const company = {
  id: COMPANY_A.id,
  name: COMPANY_A.info.name,
  email: COMPANY_A.info.email,
};

let db: SupabaseMock;

const rpcStage = (
  kind: Parameters<typeof stageOf>[0],
  count: number,
  reached: number,
  median: number | null,
) => ({
  stage_id: stageOf(kind).id,
  name: stageOf(kind).name,
  kind,
  count,
  reached,
  median_days: median,
});

const FUNNEL = {
  stages: [
    rpcStage("applied", 2, 5, 4),
    rpcStage("screening", 2, 3, 3),
    rpcStage("interview", 0, 1, 5),
    rpcStage("offer", 0, 0, null),
    rpcStage("hired", 1, 1, null),
    rpcStage("rejected", 0, 0, null),
    rpcStage("on_hold", 0, 0, null),
  ],
  sources: { applied: 4, agent: 1 },
  time_to_hire_days: 10,
  total: 5,
};

beforeEach(() => {
  db = createSupabaseMock();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("getJobFunnel (PLT-081, PL-TEST-005)", () => {
  it("calls get_job_funnel once and maps the stages, sources and time to hire", async () => {
    db.queueRpc("get_job_funnel", { data: FUNNEL, error: null });

    const funnel = await getJobFunnel(db.client, PIPELINE_JOB.id);

    expect(db.callsFor("get_job_funnel")).toHaveLength(1);
    expect(db.callsFor("get_job_funnel")[0].chain[0].args).toEqual([
      "get_job_funnel",
      { p_job_post_id: PIPELINE_JOB.id },
    ]);
    expect(funnel).toEqual({
      stages: [
        {
          stageId: stageOf("applied").id,
          name: "Applied",
          kind: "applied",
          count: 2,
          reached: 5,
          conversion: null,
          medianDays: 4,
        },
        {
          stageId: stageOf("screening").id,
          name: "Screening",
          kind: "screening",
          count: 2,
          reached: 3,
          conversion: 0.6,
          medianDays: 3,
        },
        {
          stageId: stageOf("interview").id,
          name: "Interview",
          kind: "interview",
          count: 0,
          reached: 1,
          conversion: 1 / 3,
          medianDays: 5,
        },
        {
          stageId: stageOf("offer").id,
          name: "Offer",
          kind: "offer",
          count: 0,
          reached: 0,
          conversion: 0,
          medianDays: null,
        },
        // The previous progress stage reached nobody: null, not NaN or Infinity.
        {
          stageId: stageOf("hired").id,
          name: "Hired",
          kind: "hired",
          count: 1,
          reached: 1,
          conversion: null,
          medianDays: null,
        },
        // Rejected and On hold aren't steps of the funnel.
        expect.objectContaining({ kind: "rejected", conversion: null }),
        expect.objectContaining({ kind: "on_hold", conversion: null }),
      ],
      sources: { applied: 4, agent: 1 },
      timeToHireDays: 10,
      total: 5,
    });
  });

  it("returns null for a job the company can't see", async () => {
    db.queueRpc("get_job_funnel", { data: null, error: null });

    expect(await getJobFunnel(db.client, PIPELINE_JOB.id)).toBeNull();
  });

  it("throws on an RPC error", async () => {
    db.queueRpc("get_job_funnel", { data: null, error: { message: "boom" } });

    await expect(getJobFunnel(db.client, PIPELINE_JOB.id)).rejects.toThrow(
      /boom/,
    );
  });
});

describe("getCompanyFunnel (PLT-081, PL-REQ-011)", () => {
  const JOB_2 = {
    id: "b0000000-0000-4000-8000-0000000000f2",
    title: "Designer",
  };

  function twoJobs() {
    db.queue("job_postings", {
      data: [
        { id: PIPELINE_JOB.id, title: PIPELINE_JOB.title },
        { id: JOB_2.id, title: JOB_2.title },
      ],
      error: null,
    });
    db.queueRpc("get_job_funnel", { data: FUNNEL, error: null });
    db.queueRpc("get_job_funnel", {
      data: {
        ...FUNNEL,
        stages: [
          rpcStage("applied", 3, 3, null),
          rpcStage("hired", 0, 0, null),
        ],
        total: 3,
      },
      error: null,
    });
  }

  it("sums the stage counts across the company's active jobs", async () => {
    twoJobs();
    db.queue("applications", { data: [], error: null });

    const result = await getCompanyFunnel({ supabase: db.client, company });

    const [jobs] = db.callsFor("job_postings");
    expect(jobs.chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(jobs.chain).toContainEqual({
      method: "eq",
      args: ["status", "active"],
    });
    expect(result.stages.find((s) => s.kind === "applied")).toMatchObject({
      count: 5,
    });
    expect(result.stages.find((s) => s.kind === "screening")).toMatchObject({
      count: 2,
    });
    expect(result.stages.find((s) => s.kind === "hired")).toMatchObject({
      count: 1,
    });
    expect(result.jobs).toEqual([
      {
        jobPostId: PIPELINE_JOB.id,
        title: PIPELINE_JOB.title,
        total: 5,
        stages: expect.any(Array),
      },
      {
        jobPostId: JOB_2.id,
        title: "Designer",
        total: 3,
        stages: expect.any(Array),
      },
    ]);
  });

  it(`lists applications in Applied for more than ${NEEDS_ATTENTION_DAYS} days with no event since`, async () => {
    twoJobs();
    const waiting = {
      id: "e0000000-0000-4000-8000-0000000000a1",
      stage_entered_at: daysAgo(5),
      user_info: { full_name: "Priya Sharma" },
      job_postings: {
        id: PIPELINE_JOB.id,
        title: PIPELINE_JOB.title,
        company_id: COMPANY_A.id,
      },
    };
    const touched = {
      ...waiting,
      id: "e0000000-0000-4000-8000-0000000000a2",
      stage_entered_at: daysAgo(6),
    };
    db.queue("applications", { data: [touched, waiting], error: null });
    db.queue("application_events", {
      data: [
        // The applied event when they entered doesn't count; a note since does.
        { application_id: waiting.id, type: "applied", created_at: daysAgo(5) },
        {
          application_id: touched.id,
          type: "note_added",
          created_at: daysAgo(1),
        },
      ],
      error: null,
    });

    const { needsAttention } = await getCompanyFunnel({
      supabase: db.client,
      company,
    });

    expect(needsAttention).toEqual([
      {
        applicationId: waiting.id,
        name: "Priya Sharma",
        jobPostId: PIPELINE_JOB.id,
        jobTitle: PIPELINE_JOB.title,
        daysInApplied: 5,
      },
    ]);
    const [apps] = db.callsFor("applications");
    expect(apps.chain).toContainEqual({
      method: "eq",
      args: ["job_postings.company_id", COMPANY_A.id],
    });
    expect(apps.chain).toContainEqual({
      method: "eq",
      args: ["pipeline_stages.kind", "applied"],
    });
    expect(apps.chain).toContainEqual({
      method: "lt",
      args: ["stage_entered_at", daysAgo(NEEDS_ATTENTION_DAYS)],
    });
  });
});
