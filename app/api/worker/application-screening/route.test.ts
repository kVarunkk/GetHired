import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { screenApplication } from "@/helpers/matching/screen-application";
import { jobSnapshotHash } from "@/helpers/matching/job-snapshot";
import { MATCH_MAX_ATTEMPTS, MATCH_WORKER_BATCH_SIZE, MT_MODEL } from "@/helpers/matching/config";
import { sendEmailForStatusUpdate } from "@/utils/email";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  APPLICATION,
  CANDIDATE_PROFILE,
  JOB_POST,
  RESUME_CONTENT,
  screeningResultOf,
} from "@/test/utils/matching";
import { inviteAboveFitThreshold } from "@/helpers/interview/screening/fit-threshold";
import { GET } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ consumeEntitlement: vi.fn() }));
vi.mock("@/helpers/matching/screen-application", () => ({ screenApplication: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/interview/screening/fit-threshold", () => ({
  inviteAboveFitThreshold: vi.fn(async () => ({ invited: false, reason: "disabled" })),
}));

const QUEUE = "application_screening_queue";
const SCREENING_ID = "f1000000-0000-4000-8000-000000000001";
const HASH = jobSnapshotHash(JOB_POST);

let db: SupabaseMock;

const message = (msg_id: number, read_ct = 1, applicationId = APPLICATION.id) => ({
  msg_id,
  read_ct,
  message: { application_id: applicationId },
});

function queueMessages(...messages: ReturnType<typeof message>[]) {
  db.queueRpc("read", { data: messages, error: null }, "pgmq_public");
}

const screeningRow = (overrides: Record<string, unknown> = {}) => ({
  id: SCREENING_ID,
  application_id: APPLICATION.id,
  company_id: COMPANY_A.id,
  status: "queued",
  job_snapshot_hash: null,
  result: null,
  attempts: 0,
  ...overrides,
});

/** One message's data: the screening, the application, the job and the candidate. */
function screeningData(
  screening: Record<string, unknown> | null = screeningRow(),
  { application = APPLICATION as unknown, candidate = true } = {},
) {
  db.queue("application_screenings", { data: screening, error: null });
  if (!screening) return;
  db.queue("applications", { data: application, error: null });
  if (!application) return;
  db.queue("job_postings", { data: JOB_POST, error: null });
  if (screening.status === "completed" && screening.job_snapshot_hash === HASH) return;
  if (!candidate) return;
  db.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
  db.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
}

const run = (secret: string | null = "test-secret") =>
  GET(
    buildRequest("/api/worker/application-screening", {
      headers: secret ? { "X-Internal-Secret": secret } : {},
    }),
  );

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const updates = () =>
  db
    .callsFor("application_screenings")
    .filter((c) => has(c, "update"))
    .map((c) => c.chain.find((m) => m.method === "update")!.args[0] as Record<string, unknown>);
const archived = () =>
  db.callsFor("archive").map((c) => (c.chain[0].args[1] as { message_id: number }).message_id);

const entitlementError = () =>
  new EntitlementError({
    key: "screenings",
    kind: "allowance",
    qty: 1,
    used: 100,
    amount: 100,
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
      call.target === "application_screenings" && has(call, "select")
        ? { data: has(call, "update") ? [{ id: SCREENING_ID }] : { id: SCREENING_ID }, error: null }
        : { data: null, error: null },
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(screenApplication).mockResolvedValue({ ok: true, result: screeningResultOf() });
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
});

describe("GET /api/worker/application-screening (MT-TEST-004)", () => {
  it.each([
    ["a missing", null],
    ["a wrong", "nope"],
  ])("401s with %s secret", async (_label, secret) => {
    const res = await run(secret);

    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("screens what the application sent, and never loads its contact snapshot (RE-REQ-062, RE-SEC-006)", async () => {
    const sent = {
      name: "Sent",
      template: "classic",
      content: {
        version: 2,
        sections: [{ id: "s1", type: "skills", items: [{ id: "i1", bullets: [{ id: "b1", text: "Text as sent" }] }] }],
      },
    };
    queueMessages(message(7));
    db.queue("application_screenings", { data: screeningRow(), error: null });
    db.queue("applications", { data: { ...APPLICATION, resume_snapshot: sent }, error: null });
    db.queue("job_postings", { data: JOB_POST, error: null });
    db.queue("user_info", { data: CANDIDATE_PROFILE, error: null });

    await run();

    expect(JSON.stringify(vi.mocked(screenApplication).mock.calls[0][0].resume)).toContain("Text as sent");
    expect(db.callsFor("resumes")).toHaveLength(0);
    const select = String(db.callsFor("applications")[0].chain.find((c) => c.method === "select")?.args[0]);
    expect(select).not.toContain("contact_snapshot");
    expect(select).not.toContain("*");
  });

  it("reads up to a batch with a 120-second visibility timeout", async () => {
    queueMessages();

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 0 });
    expect(db.callsFor("read")[0].chain[0].args[1]).toEqual({
      queue_name: QUEUE,
      sleep_seconds: 120,
      n: MATCH_WORKER_BATCH_SIZE,
    });
  });

  it("screens, charges after the model call, stores and archives", async () => {
    queueMessages(message(7));
    screeningData();

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(screenApplication).toHaveBeenCalledWith(
      { job: JOB_POST, application: APPLICATION, profile: CANDIDATE_PROFILE, resume: RESUME_CONTENT },
      expect.anything(),
    );
    // Queued on apply: no requester, the system's charge (RP-REQ-043).
    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "screenings",
      1,
      { type: "application_screening", id: APPLICATION.id },
      null,
    );
    expect(vi.mocked(screenApplication).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(consumeEntitlement).mock.invocationCallOrder[0],
    );
    expect(updates()).toEqual([
      expect.objectContaining({ status: "processing", attempts: 1 }),
      expect.objectContaining({
        status: "completed",
        fit_score: 82,
        recommendation: "yes",
        result: screeningResultOf(),
        job_snapshot_hash: HASH,
        model: MT_MODEL,
        error_code: null,
        completed_at: expect.any(String),
      }),
    ]);
    expect(updates()[1]).not.toHaveProperty("previous_result");
    expect(archived()).toEqual([7]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("writes one screened event for a completed screening (PLT-055)", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ result: screeningResultOf({ fit_score: 61 }) }));

    await run();

    const events = db
      .callsFor("application_events")
      .map((c) => c.chain.find((m) => m.method === "insert")!.args[0]);
    expect(events).toEqual([
      {
        company_id: COMPANY_A.id,
        application_id: APPLICATION.id,
        candidate_user_id: APPLICATION.applicant_user_id,
        type: "screened",
        payload: { fit_score: 82, recommendation: "yes", previous_fit_score: 61 },
      },
    ]);
  });

  it("offers the fit-threshold AI interview invite after a completed screening (SIT-03C)", async () => {
    queueMessages(message(7));
    screeningData();

    await run();

    expect(inviteAboveFitThreshold).toHaveBeenCalledWith(db.client, {
      applicationId: APPLICATION.id,
      jobPostId: APPLICATION.job_post_id,
      fitScore: 82,
    });
  });

  it("offers no invite when the screening fails or is skipped", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 1 }));
    vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "model_error" });

    await run();

    expect(inviteAboveFitThreshold).not.toHaveBeenCalled();
  });

  it("writes no screened event when the screening fails", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 1 }));
    vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "model_error" });

    await run();

    expect(db.callsFor("application_events")).toHaveLength(0);
  });

  it("keeps the completed screening when the event insert fails", async () => {
    queueMessages(message(7));
    screeningData();
    db.queue("application_events", { data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await (await run()).json()).toEqual({ processed: 1, failed: 0 });
    expect(archived()).toEqual([7]);
  });

  it("uses the application's own resume", async () => {
    const application = { ...APPLICATION, resume_id: "r0000000-0000-4000-8000-000000000001" };
    queueMessages(message(7));
    screeningData(screeningRow(), { application });

    await run();

    expect(db.callsFor("resumes")[0].chain).toContainEqual({
      method: "eq",
      args: ["id", application.resume_id],
    });
  });

  it("moves the existing result to previous_result on a re-screen", async () => {
    const older = screeningResultOf({ fit_score: 60, recommendation: "maybe" });
    queueMessages(message(7));
    screeningData(screeningRow({ status: "stale", result: older, job_snapshot_hash: "old" }));

    await run();

    expect(updates()[1]).toMatchObject({ previous_result: older, result: screeningResultOf() });
  });

  it("archives with no model call or charge when it's completed for the same job snapshot", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ status: "completed", job_snapshot_hash: HASH, result: screeningResultOf() }));

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(screenApplication).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(archived()).toEqual([7]);
  });

  it("re-screens a completed screening whose job has changed", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ status: "completed", job_snapshot_hash: "old", result: screeningResultOf() }));

    await run();

    expect(screenApplication).toHaveBeenCalledTimes(1);
  });

  it("archives with no model call when the application is gone", async () => {
    queueMessages(message(7));
    screeningData(screeningRow(), { application: null });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(screenApplication).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("archives with no model call when there's no screening row", async () => {
    queueMessages(message(7));
    screeningData(null);

    await run();

    expect(screenApplication).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("screens from the answers and resume when the profile is missing", async () => {
    queueMessages(message(7));
    screeningData(screeningRow(), { candidate: false });
    db.queue("user_info", { data: null, error: null });

    await run();

    expect(vi.mocked(screenApplication).mock.calls[0][0]).toMatchObject({ profile: {}, resume: null });
  });

  it("screens an application with no applicant_user_id without loading a profile (BIT-000)", async () => {
    queueMessages(message(7));
    const application = { ...APPLICATION, applicant_user_id: null };
    screeningData(screeningRow(), { application, candidate: false });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(db.callsFor("user_info")).toHaveLength(0);
    expect(vi.mocked(screenApplication).mock.calls[0][0]).toMatchObject({ profile: {}, resume: null });
    expect(archived()).toEqual([7]);
  });

  describe("company candidates (BIT-017, BI-REQ-031/036)", () => {
    const CANDIDATE_ID = "cc000000-0000-4000-8000-000000000001";
    const BATCH_ID = "cb000000-0000-4000-8000-000000000001";
    const imported = {
      ...APPLICATION,
      applicant_user_id: null,
      company_candidate_id: CANDIDATE_ID,
      import_batch_id: BATCH_ID,
      source: "imported",
    };
    const candidateRow = (overrides: Record<string, unknown> = {}) => ({
      id: CANDIDATE_ID,
      full_name: "Meera Iyer",
      current_title: null,
      current_company: null,
      location: null,
      experience_years: null,
      skills: [],
      resume_content: null,
      ...overrides,
    });

    it("scores and charges a candidate with a resume, from the candidate's own record", async () => {
      queueMessages(message(7));
      screeningData(screeningRow(), { application: imported, candidate: false });
      db.queue("company_candidates", { data: candidateRow({ resume_content: RESUME_CONTENT }), error: null });

      await run();

      expect(db.callsFor("user_info")).toHaveLength(0);
      expect(vi.mocked(screenApplication).mock.calls[0][0]).toMatchObject({
        profile: { full_name: "Meera Iyer" },
        resume: RESUME_CONTENT,
      });
      expect(consumeEntitlement).toHaveBeenCalled();
      expect(updates().at(-1)).toMatchObject({ status: "completed" });
      const [event] = db.callsFor("application_events");
      expect(event.chain[0].args[0]).toMatchObject({ type: "screened", candidate_user_id: null });
      // BI-REQ-015b: the invite checks the batch's auto-invite.
      expect(inviteAboveFitThreshold).toHaveBeenCalledWith(
        db.client,
        expect.objectContaining({ imported: { batchId: BATCH_ID } }),
      );
    });

    it("marks a name-and-email candidate insufficient_info: no model, charge, event or invite", async () => {
      queueMessages(message(7));
      screeningData(screeningRow(), { application: imported, candidate: false });
      db.queue("company_candidates", { data: candidateRow(), error: null });

      const res = await run();

      expect(await res.json()).toEqual({ processed: 1, failed: 0 });
      expect(screenApplication).not.toHaveBeenCalled();
      expect(consumeEntitlement).not.toHaveBeenCalled();
      expect(db.callsFor("application_events")).toHaveLength(0);
      expect(inviteAboveFitThreshold).not.toHaveBeenCalled();
      // Claimed first (SM-REQ-003), so the mark can't overwrite a live run.
      expect(updates()).toEqual([
        expect.objectContaining({ status: "processing" }),
        expect.objectContaining({ status: "insufficient_info", error_code: null }),
      ]);
      const mark = db.callsFor("application_screenings").find((c) =>
        c.chain.some((m) => m.method === "update" && (m.args[0] as { status: string }).status === "insufficient_info"),
      )!;
      expect(mark.chain).toContainEqual({ method: "in", args: ["status", ["processing"]] });
      expect(archived()).toEqual([7]);
    });

    it("scores an insufficient_info screening re-queued after a resume upload (BIT-049)", async () => {
      queueMessages(message(7));
      screeningData(screeningRow({ status: "queued" }), { application: imported, candidate: false });
      db.queue("company_candidates", { data: candidateRow({ resume_content: RESUME_CONTENT }), error: null });

      await run();

      expect(screenApplication).toHaveBeenCalled();
      expect(updates().at(-1)).toMatchObject({ status: "completed" });
    });

    it("scores a claimed import on the import, not the person's profile (BIT-103)", async () => {
      queueMessages(message(7));
      const claimed = { ...imported, applicant_user_id: APPLICATION.applicant_user_id, resume_id: null };
      screeningData(screeningRow(), { application: claimed, candidate: false });
      db.queue("company_candidates", { data: candidateRow({ resume_content: RESUME_CONTENT }), error: null });

      await run();

      expect(db.callsFor("user_info")).toHaveLength(0);
      expect(db.callsFor("resumes")).toHaveLength(0);
      expect(vi.mocked(screenApplication).mock.calls[0][0]).toMatchObject({
        profile: { full_name: "Meera Iyer" },
        resume: RESUME_CONTENT,
      });
      expect(updates().at(-1)).toMatchObject({ status: "completed" });
    });

    it("marks a claimed import with too little detail insufficient_info (BIT-103)", async () => {
      queueMessages(message(7));
      const claimed = { ...imported, applicant_user_id: APPLICATION.applicant_user_id, resume_id: null };
      screeningData(screeningRow(), { application: claimed, candidate: false });
      db.queue("company_candidates", { data: candidateRow(), error: null });

      await run();

      expect(screenApplication).not.toHaveBeenCalled();
      expect(updates().at(-1)).toEqual(expect.objectContaining({ status: "insufficient_info" }));
    });

    it("uses the person's own resume when the application has one", async () => {
      queueMessages(message(7));
      const application = {
        ...imported,
        applicant_user_id: APPLICATION.applicant_user_id,
        resume_id: "r0000000-0000-4000-8000-000000000001",
      };
      screeningData(screeningRow(), { application });

      await run();

      expect(db.callsFor("company_candidates")).toHaveLength(0);
      expect(db.callsFor("resumes")[0].chain).toContainEqual({ method: "eq", args: ["id", application.resume_id] });
    });

    it("leaves a GetHired applicant with little detail to the model", async () => {
      queueMessages(message(7));
      screeningData(screeningRow(), { candidate: false });
      db.queue("user_info", { data: { full_name: "Sam" }, error: null });
      db.queue("resumes", { data: null, error: null });

      await run();

      expect(screenApplication).toHaveBeenCalled();
      expect(db.callsFor("company_candidates")).toHaveLength(0);
    });
  });

  it("marks skipped_quota and archives without retrying when the allowance is used up", async () => {
    queueMessages(message(7));
    screeningData();
    vi.mocked(consumeEntitlement).mockRejectedValue(entitlementError());

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(updates()[1]).toEqual(expect.objectContaining({ status: "skipped_quota" }));
    expect(updates()[1]).not.toHaveProperty("result");
    expect(archived()).toEqual([7]);
  });

  it("charges a retried message with the same ref", async () => {
    queueMessages(message(7, 2));
    screeningData(screeningRow({ status: "processing", attempts: 1 }));
    vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: true });

    await run();

    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "screenings",
      1,
      { type: "application_screening", id: APPLICATION.id },
      null,
    );
    expect(updates()[1]).toMatchObject({ status: "completed" });
  });

  it("charges the member who queued it, so their per-member cap applies (RP-REQ-043)", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ requested_by: COMPANY_A.user.id }));

    await run();

    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "screenings",
      1,
      { type: "application_screening", id: APPLICATION.id },
      COMPANY_A.user.id,
    );
  });

  it("increments attempts and leaves a model error for retry before the last attempt", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 2 }));
    vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "model_error" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(updates()).toEqual([
      expect.objectContaining({ status: "processing", attempts: MATCH_MAX_ATTEMPTS - 1 }),
      expect.objectContaining({ status: "queued", error_code: "model_error" }),
    ]);
    expect(archived()).toEqual([]);
  });

  it("stores failed with the safe code and archives on the last attempt", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 1 }));
    vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "invalid_output" });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(updates()[1]).toEqual(
      expect.objectContaining({ status: "failed", error_code: "invalid_output" }),
    );
    expect(archived()).toEqual([7]);
  });

  it("summarises failures in one admin email", async () => {
    queueMessages(message(7), message(8, 1, "e0000000-0000-4000-8000-000000000099"));
    screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 1 }));
    db.queue("application_screenings", { data: [{ id: SCREENING_ID }], error: null }); // message 7's claim
    db.queue("application_screenings", { data: [{ id: SCREENING_ID }], error: null }); // message 7's "failed" update
    screeningData();
    vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "model_error" });

    await run();

    expect(sendEmailForStatusUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmailForStatusUpdate).mock.calls[0][0]).toMatch(/2 of 2/);
  });

  it("keeps going after one message throws", async () => {
    queueMessages(message(7), message(8));
    db.queue("application_screenings", { data: null, error: { message: "db down" } });
    screeningData();

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 1 });
    expect(archived()).toEqual([8]);
  });

  it("gives up on a message that keeps throwing, after the last attempt", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    db.queue("application_screenings", { data: null, error: { message: "db down" } });

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 1 });
    expect(updates()).toEqual([expect.objectContaining({ status: "failed", error_code: "worker_error" })]);
    expect(archived()).toEqual([7]);
  });

  it("500s when the queue can't be read", async () => {
    db.queueRpc("read", { data: null, error: { message: "no queue" } }, "pgmq_public");

    expect((await run()).status).toBe(500);
  });
});

describe("GET /api/worker/application-screening: claims (SMT-015, SM-REQ-001/002/003)", () => {
  const writeTo = (status: string) =>
    db
      .callsFor("application_screenings")
      .find((c) => c.chain.some((m) => m.method === "update" && (m.args[0] as { status?: string }).status === status));
  const claimOf = () => (writeTo("processing")!.chain[0].args[0] as { claimed_at: string }).claimed_at;

  it("claims from the state it read and sets claimed_at", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ status: "stale" }));

    await run();

    const claim = writeTo("processing")!;
    expect(claim.chain[0].args[0]).toMatchObject({ status: "processing", attempts: 1, claimed_at: expect.any(String) });
    expect(claim.chain).toContainEqual({ method: "in", args: ["status", ["stale"]] });
  });

  it.each([
    ["completed", () => screeningData()],
    ["queued after a model error", () => {
      screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 2 }));
      vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "model_error" });
    }],
    ["failed on the last attempt", () => {
      screeningData(screeningRow({ attempts: MATCH_MAX_ATTEMPTS - 1 }));
      vi.mocked(screenApplication).mockResolvedValue({ ok: false, errorCode: "model_error" });
    }],
    ["skipped_quota", () => {
      screeningData();
      vi.mocked(consumeEntitlement).mockRejectedValue(entitlementError());
    }],
  ])("moves to %s from processing under its own claim only", async (_label, arrange) => {
    queueMessages(message(7));
    arrange();

    await run();

    const finals = db
      .callsFor("application_screenings")
      .filter((c) => c.chain.some((m) => m.method === "update" && (m.args[0] as { status?: string }).status !== "processing"));
    expect(finals).toHaveLength(1);
    expect(finals[0].chain).toContainEqual({ method: "in", args: ["status", ["processing"]] });
    expect(finals[0].chain).toContainEqual({ method: "eq", args: ["claimed_at", claimOf()] });
  });

  it("leaves a row under a live claim alone: no model call, no charge, no write, message kept", async () => {
    queueMessages(message(7));
    screeningData(screeningRow({ status: "processing", attempts: 1, claimed_at: new Date(Date.now() - 10_000).toISOString() }));

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 0, skipped: 1 });
    expect(screenApplication).not.toHaveBeenCalled();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(updates()).toHaveLength(0);
    expect(archived()).toEqual([]);
    expect(sendEmailForStatusUpdate).not.toHaveBeenCalled();
  });

  it("re-claims a dead claim, filtering on the old one", async () => {
    const old = new Date(Date.now() - 121_000).toISOString();
    queueMessages(message(7));
    screeningData(screeningRow({ status: "processing", attempts: 1, claimed_at: old }));

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(writeTo("processing")!.chain).toContainEqual({ method: "eq", args: ["claimed_at", old] });
    expect(screenApplication).toHaveBeenCalledTimes(1);
  });

  it("does nothing when another run claims the row first", async () => {
    queueMessages(message(7));
    screeningData();
    db.queue("application_screenings", { data: [], error: null }); // the claim matches nothing

    const res = await run();

    expect(await res.json()).toEqual({ processed: 0, failed: 0, skipped: 1 });
    expect(screenApplication).not.toHaveBeenCalled();
    expect(archived()).toEqual([]);
  });

  it("doesn't charge when the claim was lost during the model call (SM-TEST-009)", async () => {
    queueMessages(message(7));
    screeningData();
    db.queue("application_screenings", { data: [{ id: SCREENING_ID }], error: null }); // the claim
    db.queue("application_screenings", { data: null, error: null }); // the check before the charge: re-queued

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    expect(screenApplication).toHaveBeenCalledTimes(1);
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(writeTo("completed")).toBeUndefined();
    expect(db.callsFor("application_events")).toHaveLength(0);
    expect(inviteAboveFitThreshold).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("writes no event or invite when the completed save is refused", async () => {
    queueMessages(message(7));
    screeningData();
    db.queue("application_screenings", { data: [{ id: SCREENING_ID }], error: null }); // the claim
    db.queue("application_screenings", { data: { id: SCREENING_ID }, error: null }); // still ours before the charge
    db.queue("application_screenings", { data: [], error: null }); // re-queued between the charge and the save

    const res = await run();

    expect(await res.json()).toEqual({ processed: 1, failed: 0 });
    // The charge is by application, so the newer run's is a duplicate.
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(db.callsFor("application_events")).toHaveLength(0);
    expect(inviteAboveFitThreshold).not.toHaveBeenCalled();
    expect(archived()).toEqual([7]);
  });

  it("keeps the give-up guard: failed only for a screening that isn't completed", async () => {
    queueMessages(message(7, MATCH_MAX_ATTEMPTS));
    db.queue("application_screenings", { data: null, error: { message: "db down" } });

    await run();

    expect(writeTo("failed")!.chain).toContainEqual({ method: "neq", args: ["status", "completed"] });
    // Nor a row a newer run holds under a live claim (SM-REQ-003).
    const or = writeTo("failed")!.chain.find((m) => m.method === "or");
    expect(or?.args[0]).toMatch(/^status\.neq\.processing,claimed_at\.is\.null,claimed_at\.lte\."[^"]+",claimed_at\.eq\."[^"]+"$/);
  });
});

/**
 * One screening row held in memory, which applies a chain's filters the way
 * PostgREST would (eq, neq, in, is), so concurrent runs interact through real
 * state instead of scripted answers.
 */
function screeningTable(initial: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...initial };
  const matches = (call: RecordedCall) =>
    call.chain.every(({ method, args }) => {
      const [column, value] = args as [string, unknown];
      if (method === "eq") return row[column] === value;
      if (method === "neq") return row[column] !== value;
      if (method === "in") return (value as unknown[]).includes(row[column]);
      if (method === "is") return row[column] === value;
      return true;
    });
  const answer = (call: RecordedCall) => {
    if (call.target !== "application_screenings") return { data: null, error: null };
    const upsert = call.chain.find((m) => m.method === "upsert");
    if (upsert) return { data: [], error: null }; // the row exists: nothing inserted
    const update = call.chain.find((m) => m.method === "update");
    if (update) {
      if (!matches(call)) return { data: [], error: null };
      Object.assign(row, update.args[0] as Record<string, unknown>);
      return { data: [{ id: row.id, application_id: row.application_id }], error: null };
    }
    return { data: matches(call) ? { ...row } : null, error: null };
  };
  return { row, answer };
}

describe("GET /api/worker/application-screening: a re-queue during a run (SM-TEST-009)", () => {
  /** What one run reads besides the screening: the application, the job and the candidate. */
  function runData() {
    db.queue("applications", { data: APPLICATION, error: null });
    db.queue("job_postings", { data: JOB_POST, error: null });
    db.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
    db.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
  }

  it("refuses run A's result and charges nothing for it; run B screens and saves", async () => {
    const { requeueScreenings } = await import("@/helpers/matching/queue-screenings");
    const table = screeningTable({ ...screeningRow(), job_post_id: JOB_POST.id, requested_by: null, claimed_at: null });
    db = createSupabaseMock({ fallback: table.answer });
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

    // Run A: a resume is attached while the model call is in flight.
    queueMessages(message(7));
    runData();
    vi.mocked(screenApplication).mockImplementationOnce(async () => {
      await requeueScreenings(db.client, {
        companyId: COMPANY_A.id,
        applications: [{ id: APPLICATION.id, job_post_id: JOB_POST.id }],
        requestedBy: "u-attach",
      });
      return { ok: true, result: screeningResultOf({ fit_score: 40 }) };
    });

    await run();

    expect(table.row).toMatchObject({ status: "queued", claimed_at: null });
    expect(table.row.fit_score).toBeUndefined();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(db.callsFor("application_events")).toHaveLength(0);
    expect(archived()).toEqual([7]);

    // Run B: the re-queue's message.
    queueMessages(message(8));
    runData();
    vi.mocked(screenApplication).mockResolvedValueOnce({ ok: true, result: screeningResultOf({ fit_score: 90 }) });

    await run();

    expect(table.row).toMatchObject({ status: "completed", fit_score: 90 });
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(archived()).toEqual([7, 8]);
  });
});

describe("GET /api/worker/application-screening: a job edit during a run (SM-TEST-006)", () => {
  const EDITED_JOB = { ...JOB_POST, description: `${JOB_POST.description} Now also needs Kubernetes.` };

  function runData(job: typeof JOB_POST) {
    db.queue("applications", { data: APPLICATION, error: null });
    db.queue("job_postings", { data: job, error: null });
    db.queue("user_info", { data: CANDIDATE_PROFILE, error: null });
    db.queue("resumes", { data: { content: RESUME_CONTENT }, error: null });
  }

  it("refuses run A's result against the old job; run B screens the edited job", async () => {
    const { markJobResultsStale } = await import("@/helpers/matching/mark-stale");
    const table = screeningTable({ ...screeningRow(), job_post_id: JOB_POST.id, requested_by: null, claimed_at: null });
    db = createSupabaseMock({ fallback: table.answer });
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

    // Run A: the job is edited while the model call is in flight.
    queueMessages(message(7));
    runData(JOB_POST);
    vi.mocked(screenApplication).mockImplementationOnce(async () => {
      await markJobResultsStale(db.client, JOB_POST.id);
      return { ok: true, result: screeningResultOf({ fit_score: 40 }) };
    });

    await run();

    expect(table.row).toMatchObject({ status: "queued", claimed_at: null });
    expect(table.row.fit_score).toBeUndefined();
    expect(consumeEntitlement).not.toHaveBeenCalled();
    const [send] = db.callsFor("send_batch");
    expect(send.chain[0].args[1]).toMatchObject({ messages: [{ application_id: APPLICATION.id }] });
    expect(archived()).toEqual([7]);

    // Run B: the stale pass's message, against the edited job.
    queueMessages(message(8));
    runData(EDITED_JOB);
    vi.mocked(screenApplication).mockResolvedValueOnce({ ok: true, result: screeningResultOf({ fit_score: 90 }) });

    await run();

    expect(table.row).toMatchObject({
      status: "completed",
      fit_score: 90,
      job_snapshot_hash: jobSnapshotHash(EDITED_JOB),
    });
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(archived()).toEqual([7, 8]);
  });
});
