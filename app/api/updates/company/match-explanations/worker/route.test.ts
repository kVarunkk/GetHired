import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { explainMatch } from "@/helpers/matching/explain-match";
import { MATCH_MAX_ATTEMPTS, MATCH_WORKER_BATCH_SIZE } from "@/helpers/matching/config";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { CANDIDATE_PROFILE, JOB_POST, RESUME_CONTENT, explanationOf } from "@/test/utils/matching";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ consumeEntitlement: vi.fn() }));
vi.mock("@/helpers/matching/explain-match", () => ({ explainMatch: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));

const ROW_ID = "f0000000-0000-4000-8000-000000000001";
const QUEUE = "match_explanation_queue";

let db: SupabaseMock;

const message = (msg_id: number, read_ct = 1, userId = PUBLIC_APPLICANT.id) => ({
  msg_id,
  read_ct,
  message: { jobPostId: JOB_POST.id, userId },
});

function queueMessages(...messages: ReturnType<typeof message>[]) {
  db.queueRpc("read", { data: messages, error: null }, "pgmq_public");
}

/** One message's data: its row, the job and the candidate. */
function rowAndData(row: Record<string, unknown> | null = { id: ROW_ID, explanation_status: "queued" }) {
  db.queue("job_relevant_profiles", { data: row, error: null });
  if (!row || row.explanation_status === "completed") return;
  db.queue("job_postings", { data: JOB_POST, error: null });
  db.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
  db.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
}

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/updates/company/match-explanations/worker", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const updates = () =>
  db
    .callsFor("job_relevant_profiles")
    .filter((c) => has(c, "update"))
    .map((c) => c.chain.find((m) => m.method === "update")!.args[0] as Record<string, unknown>);
/** The writes after the claim: what the run did with the row. */
const outcomes = () => updates().filter((u) => u.explanation_status !== "processing");
const archived = () => db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

const entitlementError = () =>
  new EntitlementError({
    key: "match_explanations",
    kind: "allowance",
    qty: 1,
    used: 50,
    amount: 50,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    reason: "limit_reached",
    suggestedTier: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  // The guarded writes (SM-REQ-001/003) report whether a row moved, and the
  // claim check before the charge reads the row: unless a test queues
  // otherwise, they all find this run's row.
  db = createSupabaseMock({
    fallback: (call) =>
      call.target === "job_relevant_profiles" && has(call, "select")
        ? { data: has(call, "update") ? [{ id: ROW_ID }] : { id: ROW_ID }, error: null }
        : { data: null, error: null },
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(explainMatch).mockResolvedValue({ ok: true, explanation: explanationOf() });
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
});

describe("GET /api/updates/company/match-explanations/worker (MTT-041)", () => {
  it.each([
    ["a missing", null],
    ["a wrong", "nope"],
  ])("401s with %s secret", async (_label, secret) => {
    const res = await run(secret);

    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("reads a batch with a visibility timeout", async () => {
    queueMessages();

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 0 });
    expect(db.callsFor("read")[0].chain[0].args[1]).toEqual({
      queue_name: QUEUE,
      sleep_seconds: 120,
      n: MATCH_WORKER_BATCH_SIZE,
    });
  });

  it("explains, charges with the row's ref, stores and archives", async () => {
    queueMessages(message(7));
    rowAndData();

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(explainMatch).toHaveBeenCalledWith(
      { job: JOB_POST, profile: CANDIDATE_PROFILE, resume: RESUME_CONTENT },
      expect.anything(),
    );
    // The digest's work: no actor (RP-REQ-043).
    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "match_explanations",
      1,
      { type: "match_explanation", id: ROW_ID },
      null,
    );
    expect(outcomes()).toEqual([
      expect.objectContaining({
        explanation: explanationOf(),
        explanation_status: "completed",
        explanation_error: null,
        explained_at: expect.any(String),
      }),
    ]);
    expect(archived()).toEqual([7]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("archives an already-completed row without a model call", async () => {
    queueMessages(message(7));
    rowAndData({ id: ROW_ID, explanation_status: "completed" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(explainMatch).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("archives a message whose candidate no longer matches", async () => {
    queueMessages(message(7));
    rowAndData(null);

    await run();

    expect(explainMatch).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("marks skipped_quota and archives without retrying when the allowance is used up", async () => {
    queueMessages(message(7));
    rowAndData();
    vi.mocked(consumeEntitlement).mockRejectedValue(entitlementError());

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(outcomes()).toEqual([{ explanation_status: "skipped_quota" }]);
    expect(archived()).toEqual([7]);
  });

  it("leaves a model error for retry before the last attempt", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS - 1));
    rowAndData();
    vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode: "model_error" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(consumeEntitlement).not.toHaveBeenCalled();
    // Left processing under a claim that dies before the retry reads it.
    expect(outcomes()).toEqual([]);
    expect(archived()).toEqual([]);
  });

  it("marks failed with the safe code and archives on the last attempt", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    rowAndData();
    vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode: "invalid_output" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(outcomes()).toEqual([{ explanation_status: "failed", explanation_error: "invalid_output" }]);
    expect(archived()).toEqual([7]);
  });

  it("summarises failures in one admin email", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS), message(8, 1, "a0000000-0000-4000-8000-000000000009"));
    rowAndData();
    db.queue("job_relevant_profiles", { data: [{ id: ROW_ID }], error: null }); // message 7's claim
    db.queue("job_relevant_profiles", { data: [{ id: ROW_ID }], error: null }); // message 7's "failed" update
    rowAndData();
    vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode: "model_error" });

    await run();

    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toMatch(/2 of 2/);
  });

  it("keeps going after one message throws", async () => {
    queueMessages(message(7), message(8));
    db.queue("job_relevant_profiles", { data: null, error: { message: "db down" } });
    rowAndData();

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 1 });
    expect(archived()).toEqual([8]);
  });

  it("gives up on a message that keeps throwing, after the last attempt", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    db.queue("job_relevant_profiles", { data: null, error: { message: "db down" } });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(updates()).toEqual([{ explanation_status: "failed", explanation_error: "worker_error" }]);
    expect(archived()).toEqual([7]);
  });

  it("500s when the queue can't be read", async () => {
    db.queueRpc("read", { data: null, error: { message: "no queue" } }, "pgmq_public");

    expect((await run()).status).toBe(500);
  });
});

describe("GET /api/updates/company/match-explanations/worker: claims (SMT-019, SM-REQ-001/002/003)", () => {
  const writeTo = (status: string) =>
    db
      .callsFor("job_relevant_profiles")
      .find((c) =>
        c.chain.some((m) => m.method === "update" && (m.args[0] as { explanation_status?: string }).explanation_status === status),
      );
  const claimOf = () => (writeTo("processing")!.chain[0].args[0] as { claimed_at: string }).claimed_at;

  it.each(["queued", "stale"])("claims a %s row: processing from that state, with claimed_at", async (state) => {
    queueMessages(message(7));
    rowAndData({ id: ROW_ID, explanation_status: state, claimed_at: null });

    await run();

    const claim = writeTo("processing")!;
    expect(claim.chain[0].args[0]).toEqual({ explanation_status: "processing", claimed_at: expect.any(String) });
    expect(claim.chain).toContainEqual({ method: "in", args: ["explanation_status", [state]] });
  });

  it.each([
    ["completed", () => {}],
    ["skipped_quota", () => vi.mocked(consumeEntitlement).mockRejectedValue(entitlementError())],
    ["failed", () => vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode: "model_error" })],
  ])("moves to %s from processing under its own claim only", async (status, arrange) => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    rowAndData();
    arrange();

    await run();

    const final = writeTo(status)!;
    expect(final.chain).toContainEqual({ method: "in", args: ["explanation_status", ["processing"]] });
    expect(final.chain).toContainEqual({ method: "eq", args: ["claimed_at", claimOf()] });
  });

  it("leaves a row under a live claim alone: no model call, no charge, no write, message kept", async () => {
    queueMessages(message(7));
    rowAndData({ id: ROW_ID, explanation_status: "processing", claimed_at: new Date(Date.now() - 10_000).toISOString() });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 0, skipped: 1 });
    expect(explainMatch).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(archived()).toEqual([]);
  });

  it("re-claims a dead claim, filtering on the old one", async () => {
    const old = new Date(Date.now() - 121_000).toISOString();
    queueMessages(message(7));
    rowAndData({ id: ROW_ID, explanation_status: "processing", claimed_at: old });

    expect(await (await run()).json()).toEqual({ processed: 1, failed: 0 });
    expect(writeTo("processing")!.chain).toContainEqual({ method: "eq", args: ["claimed_at", old] });
  });

  it("doesn't charge or save when the claim was lost during the model call", async () => {
    queueMessages(message(7));
    rowAndData();
    db.queue("job_relevant_profiles", { data: [{ id: ROW_ID }], error: null }); // the claim
    db.queue("job_relevant_profiles", { data: null, error: null }); // the check before the charge: re-queued

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(explainMatch).toHaveBeenCalledTimes(1);
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(writeTo("completed")).toBeUndefined();
    expect(archived()).toEqual([7]);
  });

  it("keeps the give-up guard: failed only for a row that isn't completed", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    db.queue("job_relevant_profiles", { data: null, error: { message: "db down" } });

    await run();

    expect(writeTo("failed")!.chain).toContainEqual({ method: "neq", args: ["explanation_status", "completed"] });
    // Nor a row a newer run holds under a live claim (SM-REQ-003).
    const or = writeTo("failed")!.chain.find((m) => m.method === "or");
    expect(or?.args[0]).toMatch(
      /^explanation_status\.neq\.processing,claimed_at\.is\.null,claimed_at\.lte\."[^"]+",claimed_at\.eq\."[^"]+"$/,
    );
  });
});

/**
 * One job_relevant_profiles row held in memory, which applies a chain's
 * filters the way PostgREST would, so the run and the stale pass interact
 * through real state instead of scripted answers.
 */
function profileTable(initial: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...initial };
  const matches = (call: RecordedCall) =>
    call.chain.every(({ method, args }) => {
      const [column, value] = args as [string, unknown];
      if (method === "eq" || method === "is") return row[column] === value;
      if (method === "neq") return row[column] !== value;
      if (method === "in") return (value as unknown[]).includes(row[column]);
      return true;
    });
  const answer = (call: RecordedCall) => {
    if (call.target !== "job_relevant_profiles") return { data: null, error: null };
    const update = call.chain.find((m) => m.method === "update");
    if (update) {
      if (!matches(call)) return { data: [], error: null };
      Object.assign(row, update.args[0] as Record<string, unknown>);
      return { data: [{ id: row.id, user_id: row.user_id }], error: null };
    }
    return { data: matches(call) ? { ...row } : null, error: null };
  };
  return { row, answer };
}

describe("GET /api/updates/company/match-explanations/worker: a job edit during a run (SM-TEST-006)", () => {
  const EDITED_JOB = { ...JOB_POST, description: `${JOB_POST.description} Now also needs Kubernetes.` };

  function runData(job: typeof JOB_POST) {
    db.queue("job_postings", { data: job, error: null });
    db.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
    db.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
  }

  it("refuses run A's explanation of the old job; run B explains the edited job", async () => {
    const { markJobResultsStale } = await import("@/helpers/matching/mark-stale");
    const table = profileTable({
      id: ROW_ID,
      job_posting_id: JOB_POST.id,
      user_id: PUBLIC_APPLICANT.id,
      explanation_status: "queued",
      claimed_at: null,
    });
    db = createSupabaseMock({ fallback: table.answer });
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

    // Run A: the job is edited while the model call is in flight.
    queueMessages(message(7));
    runData(JOB_POST);
    vi.mocked(explainMatch).mockImplementationOnce(async () => {
      await markJobResultsStale(db.client, JOB_POST.id);
      return { ok: true, explanation: explanationOf({ summary: "old job" }) };
    });

    await run();

    expect(table.row).toMatchObject({ explanation_status: "queued", claimed_at: null });
    expect(table.row.explanation).toBeUndefined();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    const [send] = db.callsFor("send");
    expect(send.chain[0].args[1]).toMatchObject({
      queue_name: QUEUE,
      message: { jobPostId: JOB_POST.id, userId: PUBLIC_APPLICANT.id },
    });
    expect(archived()).toEqual([7]);

    // Run B: the stale pass's message, against the edited job.
    queueMessages(message(8));
    runData(EDITED_JOB);
    vi.mocked(explainMatch).mockResolvedValueOnce({ ok: true, explanation: explanationOf({ summary: "new job" }) });

    await run();

    expect(explainMatch).toHaveBeenLastCalledWith(expect.objectContaining({ job: EDITED_JOB }), expect.anything());
    expect(table.row).toMatchObject({ explanation_status: "completed", explanation: { summary: "new job" } });
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(archived()).toEqual([7, 8]);
  });
});
