import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail, sendEmailForStatusUpdate } from "@/utils/email";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { JOB_POST } from "@/test/utils/matching";
import { MATCH_EXPLAIN_TOP_N } from "@/helpers/matching/config";
import { processJobPostingRelevance } from "./relevant-profiles-utils";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("react-email", () => ({ render: vi.fn(async () => "<html/>") }));
vi.mock("@/emails/RelevantProfilesUpdateEmail", () => ({ RelevantProfilesUpdateEmail: () => null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "sb=1" }) }));

const JOB_ID = JOB_POST.id;
const fetchMock = vi.fn();

let session: SupabaseMock;
let admin: SupabaseMock;

const scoreOf = (aggregate: number, skills = 3, experience = 3, preferenceConflict = 0.1) => ({
  skills,
  experience,
  preferenceConflict,
  aggregate,
});

function digestResponds(userIds: string[], matchScores?: Record<string, ReturnType<typeof scoreOf>>) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: userIds.map((user_id) => ({ user_id })), matchScores }), {
      status: 200,
    }),
  );
}

function seed(db: SupabaseMock) {
  db.queue("company_info", {
    data: { id: COMPANY_A.id, name: COMPANY_A.info.name, email: COMPANY_A.info.email },
    error: null,
  });
  db.queue("job_postings", { data: { title: JOB_POST.title }, error: null });
}

/** Rows currently stored for the job, as the digest reads them before writing. */
function existingRows(rows: { user_id: string; match_score: number | null; explanation_status: string }[]) {
  admin.queue("job_relevant_profiles", { data: rows, error: null });
}

const relevanceCalls = (db: SupabaseMock) => db.callsFor("job_relevant_profiles");
const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const argsOf = (call: RecordedCall, method: string) => call.chain.find((m) => m.method === method)?.args;

/** The rows written for the job, whether by insert or upsert. */
function writtenRows(db: SupabaseMock) {
  const write = relevanceCalls(db).find((c) => has(c, "insert") || has(c, "upsert"));
  return (write ? (argsOf(write, "insert") ?? argsOf(write, "upsert"))![0] : []) as Record<string, unknown>[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  session = createSupabaseMock({ user: COMPANY_A.user });
  admin = createSupabaseMock();
  vi.mocked(createClient).mockResolvedValue(session.client);
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
});
afterEach(() => vi.unstubAllGlobals());

describe("processJobPostingRelevance (characterisation)", () => {
  it("ranks rows by position, marks the job completed and emails the company", async () => {
    seed(admin);
    digestResponds(["u1", "u2", "u3"]);

    const result = await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(result).toEqual({ success: true });
    expect(writtenRows(admin).map((r) => [r.user_id, r.relevance_rank])).toEqual([
      ["u1", 1],
      ["u2", 2],
      ["u3", 3],
    ]);
    const jobUpdate = admin.callsFor("job_postings").find((c) => has(c, "update"))!;
    expect(argsOf(jobUpdate, "update")![0]).toMatchObject({ matching_status: "completed", matching_error: null });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: COMPANY_A.info.email }));
  });

  it("marks the job failed and emails the admin when the digest fetch fails", async () => {
    seed(admin);
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));

    const result = await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(result).toMatchObject({ success: false });
    const jobUpdate = admin.callsFor("job_postings").find((c) => has(c, "update"))!;
    expect(argsOf(jobUpdate, "update")![0]).toMatchObject({ matching_status: "failed" });
    expect(sendEmailForStatusUpdate).toHaveBeenCalledWith(expect.stringContaining(JOB_ID));
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("processJobPostingRelevance scores (MT-REQ-001)", () => {
  it("stores match_score = round(aggregate / 4 * 100) and the criterion scores", async () => {
    seed(admin);
    existingRows([]);
    digestResponds(["u1", "u2"], { u1: scoreOf(3.3, 3.5, 3, 0.15) });

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    const [u1, u2] = writtenRows(admin);
    expect(u1).toMatchObject({
      user_id: "u1",
      match_score: 83,
      skills_score: 3.5,
      experience_score: 3,
      preference_conflict: 0.15,
    });
    expect(u2).toMatchObject({
      user_id: "u2",
      match_score: null,
      skills_score: null,
      experience_score: null,
      preference_conflict: null,
    });
  });

  it("upserts on (job_posting_id, user_id) and never writes the explanation", async () => {
    seed(admin);
    existingRows([]);
    digestResponds(["u1"], { u1: scoreOf(3) });

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    const upsert = relevanceCalls(admin).find((c) => has(c, "upsert"))!;
    expect(upsert).toBeDefined();
    expect(argsOf(upsert, "upsert")![1]).toMatchObject({ onConflict: "job_posting_id,user_id" });
    for (const row of writtenRows(admin)) expect(row).not.toHaveProperty("explanation");
    expect(relevanceCalls(admin).some((c) => has(c, "insert"))).toBe(false);
  });

  it("deletes only the rows no longer matched", async () => {
    seed(admin);
    existingRows([
      { user_id: "u1", match_score: 75, explanation_status: "completed" },
      { user_id: "gone", match_score: 60, explanation_status: "none" },
    ]);
    digestResponds(["u1", "u2"], { u1: scoreOf(3), u2: scoreOf(2.5) });

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    const deletes = relevanceCalls(admin).filter((c) => has(c, "delete"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].chain).toContainEqual({ method: "eq", args: ["job_posting_id", JOB_ID] });
    expect(deletes[0].chain).toContainEqual({ method: "not", args: ["user_id", "in", "(u1,u2)"] });
  });

  it("deletes every row for the job when nothing matches", async () => {
    seed(admin);
    existingRows([{ user_id: "gone", match_score: 60, explanation_status: "none" }]);
    digestResponds([]);

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    const deletes = relevanceCalls(admin).filter((c) => has(c, "delete"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0].chain).toContainEqual({ method: "eq", args: ["job_posting_id", JOB_ID] });
    expect(relevanceCalls(admin).some((c) => has(c, "upsert"))).toBe(false);
  });

  it("marks a completed explanation stale when the score changed, and keeps other statuses", async () => {
    seed(admin);
    existingRows([
      { user_id: "changed", match_score: 60, explanation_status: "completed" },
      { user_id: "same", match_score: 75, explanation_status: "completed" },
      { user_id: "queued", match_score: 50, explanation_status: "queued" },
    ]);
    digestResponds(["changed", "same", "queued", "new"], {
      changed: scoreOf(3.2), // 80
      same: scoreOf(3), // 75
      queued: scoreOf(3.6), // 90
      new: scoreOf(2),
    });

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    const status = Object.fromEntries(writtenRows(admin).map((r) => [r.user_id, r.explanation_status]));
    expect(status).toEqual({ changed: "stale", same: "completed", queued: "queued", new: "none" });
  });

  it("writes the rows with the service role on a user-triggered run", async () => {
    seed(session);
    existingRows([]);
    digestResponds(["u1"], { u1: scoreOf(3) });

    const result = await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, false);

    expect(result).toEqual({ success: true });
    expect(relevanceCalls(session)).toEqual([]);
    expect(writtenRows(admin)).toHaveLength(1);
  });

  it("fails the run when the upsert fails", async () => {
    seed(admin);
    existingRows([]);
    admin.queue("job_relevant_profiles", { data: null, error: { message: "boom" } });
    digestResponds(["u1"], { u1: scoreOf(3) });

    const result = await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(result).toMatchObject({ success: false });
    expect(sendEmailForStatusUpdate).toHaveBeenCalled();
  });
});

describe("processJobPostingRelevance background explanations (MT-REQ-002, MTT-040)", () => {
  const sends = () => admin.callsFor("send").map((c) => c.chain[0].args[1] as Record<string, unknown>);
  const queuedUpdate = () =>
    relevanceCalls(admin).find(
      (c) => has(c, "update") && (argsOf(c, "update")![0] as Record<string, unknown>).explanation_status === "queued",
    );

  it("queues the top N rows that have no explanation, one message each", async () => {
    const ids = Array.from({ length: MATCH_EXPLAIN_TOP_N + 5 }, (_, i) => `u${i}`);
    seed(admin);
    existingRows([]);
    digestResponds(ids, Object.fromEntries(ids.map((id) => [id, scoreOf(3)])));

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    const top = ids.slice(0, MATCH_EXPLAIN_TOP_N);
    expect(sends()).toEqual(
      top.map((userId) => ({
        queue_name: "match_explanation_queue",
        message: { jobPostId: JOB_ID, userId },
        sleep_seconds: 0,
      })),
    );
    const update = queuedUpdate()!;
    expect(update.chain).toContainEqual({ method: "eq", args: ["job_posting_id", JOB_ID] });
    expect(update.chain).toContainEqual({ method: "in", args: ["user_id", top] });
  });

  it("re-queues stale explanations and skips completed and queued ones", async () => {
    seed(admin);
    existingRows([
      { user_id: "done", match_score: 75, explanation_status: "completed" },
      { user_id: "old", match_score: 50, explanation_status: "completed" },
      { user_id: "waiting", match_score: 75, explanation_status: "queued" },
    ]);
    digestResponds(["done", "old", "waiting", "new"], {
      done: scoreOf(3), // 75, unchanged
      old: scoreOf(3.2), // changed → stale
      waiting: scoreOf(3),
      new: scoreOf(2),
    });

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(sends().map((m) => (m.message as { userId: string }).userId)).toEqual(["old", "new"]);
  });

  it("only marks rows queued once their message is sent", async () => {
    seed(admin);
    existingRows([]);
    admin.queueRpc("send", { data: [1], error: null }, "pgmq_public");
    admin.queueRpc("send", { data: null, error: { message: "queue down" } }, "pgmq_public");
    digestResponds(["a", "b"], { a: scoreOf(3), b: scoreOf(3) });

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(queuedUpdate()!.chain).toContainEqual({ method: "in", args: ["user_id", ["a"]] });
  });

  it("doesn't fail the digest when enqueueing fails", async () => {
    seed(admin);
    existingRows([]);
    admin.queueRpc("send", () => {
      throw new Error("pgmq unavailable");
    }, "pgmq_public");
    digestResponds(["a"], { a: scoreOf(3) });

    const result = await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(result).toEqual({ success: true });
    expect(queuedUpdate()).toBeUndefined();
  });

  it("sends nothing when nothing matched", async () => {
    seed(admin);
    existingRows([]);
    digestResponds([]);

    await processJobPostingRelevance(COMPANY_A.user.id, JOB_ID, true);

    expect(sends()).toEqual([]);
  });
});
