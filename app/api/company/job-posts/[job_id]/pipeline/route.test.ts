import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { asEachMember, OWNER_A } from "@/test/utils/team";
import { DEFAULT_STAGES, PIPELINE_JOB, stageOf } from "@/test/utils/pipeline";
import type { PipelineBoardData } from "@/utils/types/pipeline.types";
import { BOARD_STAGE_LIMIT } from "@/helpers/pipeline/board";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));

const NOW = new Date("2026-10-15T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const appId = (n: number) => `ab000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

let rls: SupabaseMock;

async function signInCompany() {
  rls = createSupabaseMock({ user: COMPANY_A.user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(COMPANY_A.user, rls.client);
}

type Row = {
  id: string;
  stage_id: string | null;
  stage_entered_at: string;
  created_at: string;
  user_info: { full_name: string | null } | null;
  application_screenings: { status: string; fit_score: number | null } | null;
};

const rowOf = (n: number, overrides: Partial<Row> = {}): Row => ({
  id: appId(n),
  stage_id: stageOf("applied").id,
  stage_entered_at: daysAgo(0),
  created_at: daysAgo(0),
  user_info: { full_name: "Priya Sharma" },
  application_screenings: null,
  ...overrides,
});

type NoteRow = { application_id: string; rating: string | null };

/** The company owns the job, which has these applications and notes. */
function ownsJob(rows: Row[], notes: NoteRow[] = []) {
  rls.queue("job_postings", { data: { id: PIPELINE_JOB.id }, error: null });
  rls.queue("pipeline_stages", { data: DEFAULT_STAGES, error: null });
  rls.queue("applications", { data: rows, error: null });
  rls.queue("candidate_notes", { data: notes, error: null });
}

const get = async (jobId = PIPELINE_JOB.id) => {
  const response = await GET(buildRequest(`/api/company/job-posts/${jobId}/pipeline`), {
    params: Promise.resolve({ job_id: jobId }),
  });
  return { status: response.status, body: (await response.json()) as PipelineBoardData };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/company/job-posts/[job_id]/pipeline (PLT-041)", () => {
  it("401s without a user", async () => {
    await setRequestUser(null);

    expect((await get()).status).toBe(401);
  });

  it("403s for an applicant", async () => {
    await setRequestUser(PUBLIC_APPLICANT.user, createSupabaseMock().client);

    expect((await get()).status).toBe(403);
  });

  it("404s for a malformed id without querying", async () => {
    await signInCompany();

    expect((await get("not-a-uuid")).status).toBe(404);
    expect(rls.callsFor("job_postings")).toHaveLength(0);
  });

  it("404s for another company's job, scoped by the session company", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: null, error: null });

    expect((await get()).status).toBe(404);
    const [jobQuery] = rls.callsFor("job_postings");
    expect(jobQuery.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(jobQuery.chain).toContainEqual({ method: "eq", args: ["id", PIPELINE_JOB.id] });
    expect(rls.callsFor("applications")).toHaveLength(0);
  });

  it("returns the active stages and one card per application", async () => {
    await signInCompany();
    ownsJob([
      rowOf(1, {
        stage_id: stageOf("interview").id,
        stage_entered_at: daysAgo(3),
        application_screenings: { status: "completed", fit_score: 82 },
      }),
      rowOf(2, { application_screenings: { status: "processing", fit_score: null } }),
      rowOf(3, { user_info: null, application_screenings: { status: "stale", fit_score: 40 } }),
    ]);

    const { status, body } = await get();

    expect(status).toBe(200);
    expect(body.stages).toEqual(DEFAULT_STAGES.map(({ id, name, kind }) => ({ id, name, kind })));
    expect(body.applications).toEqual([
      {
        id: appId(1),
        stageId: stageOf("interview").id,
        name: "Priya Sharma",
        fitScore: 82,
        daysInStage: 3,
        noteCount: 0,
        ratingAvg: null,
      },
      expect.objectContaining({ id: appId(2), fitScore: null, daysInStage: 0 }),
      // Only a completed screening's score counts.
      expect.objectContaining({ id: appId(3), name: "Applicant", fitScore: null }),
    ]);
    expect(body.truncated).toBeUndefined();

    const [appQuery] = rls.callsFor("applications");
    expect(appQuery.chain).toContainEqual({ method: "eq", args: ["job_post_id", PIPELINE_JOB.id] });
  });

  it("counts each card's notes and averages its ratings (PLT-053)", async () => {
    await signInCompany();
    ownsJob(
      [rowOf(1), rowOf(2)],
      [
        { application_id: appId(1), rating: "strong_yes" },
        { application_id: appId(1), rating: "no" },
        { application_id: appId(1), rating: null },
      ],
    );

    const { body } = await get();

    expect(body.applications[0]).toMatchObject({ noteCount: 3, ratingAvg: 3 });
    expect(body.applications[1]).toMatchObject({ noteCount: 0, ratingAvg: null });
    const [noteQuery] = rls.callsFor("candidate_notes");
    expect(noteQuery.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(noteQuery.chain).toContainEqual({
      method: "eq",
      args: ["applications.job_post_id", PIPELINE_JOB.id],
    });
    // Never the note bodies.
    expect(String(noteQuery.chain.find((m) => m.method === "select")!.args[0])).not.toContain("body");
  });

  it("never selects or returns contact details", async () => {
    await signInCompany();
    ownsJob([rowOf(1)]);

    const { body } = await get();

    const [appQuery] = rls.callsFor("applications");
    const columns = String(appQuery.chain.find((m) => m.method === "select")!.args[0]);
    expect(columns).not.toMatch(/email|phone|linkedin|resume/);
    expect(JSON.stringify(body)).not.toMatch(/@|email/i);
  });

  it(`keeps the newest ${BOARD_STAGE_LIMIT} cards per stage above 500 applications`, async () => {
    await signInCompany();
    // 450 in Applied, 60 in Screening: 510 in all. Newest first, as queried.
    const rows = [
      ...Array.from({ length: 450 }, (_, i) => rowOf(i + 1)),
      ...Array.from({ length: 60 }, (_, i) => rowOf(1000 + i, { stage_id: stageOf("screening").id })),
    ];
    ownsJob(rows);

    const { body } = await get();

    const applied = body.applications.filter((a) => a.stageId === stageOf("applied").id);
    expect(applied).toHaveLength(BOARD_STAGE_LIMIT);
    expect(applied[0].id).toBe(appId(1));
    expect(body.applications.filter((a) => a.stageId === stageOf("screening").id)).toHaveLength(60);
    expect(body.truncated).toEqual({ [stageOf("applied").id]: 450 });

    const [appQuery] = rls.callsFor("applications");
    expect(appQuery.chain).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("500s when a query fails", async () => {
    await signInCompany();
    rls.queue("job_postings", { data: { id: PIPELINE_JOB.id }, error: null });
    rls.queue("pipeline_stages", { data: DEFAULT_STAGES, error: null });
    rls.queue("applications", { data: null, error: { message: "boom" } });

    expect((await get()).status).toBe(500);
  });
});

// TM-TEST-005: every member reads the board.
asEachMember("GET pipeline board", (member) => {
  it("returns the session company's board", async () => {
    rls = createSupabaseMock({ user: member.user });
    rls.queueRpc("my_company_access", { data: member.membership, error: null });
    await setRequestUser(member.user, rls.client);
    ownsJob([rowOf(1)]);

    const { status } = await get();

    expect(status).toBe(200);
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });
});
