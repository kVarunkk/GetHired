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
  db = createSupabaseMock();
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
    expect(updates()).toEqual([
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
    expect(updates()).toEqual([{ explanation_status: "skipped_quota" }]);
    expect(archived()).toEqual([7]);
  });

  it("leaves a model error for retry before the last attempt", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS - 1));
    rowAndData();
    vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode: "model_error" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(archived()).toEqual([]);
  });

  it("marks failed with the safe code and archives on the last attempt", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    rowAndData();
    vi.mocked(explainMatch).mockResolvedValue({ ok: false, errorCode: "invalid_output" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(updates()).toEqual([{ explanation_status: "failed", explanation_error: "invalid_output" }]);
    expect(archived()).toEqual([7]);
  });

  it("summarises failures in one admin email", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS), message(8, 1, "a0000000-0000-4000-8000-000000000009"));
    rowAndData();
    db.queue("job_relevant_profiles", { data: null, error: null }); // message 7's "failed" update
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
