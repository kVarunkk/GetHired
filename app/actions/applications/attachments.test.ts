import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { attachmentOf } from "@/test/utils/outreach";
import {
  attachToApplicationAction,
  detachFromApplicationAction,
  listShareableSignalsAction,
} from "./attachments";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const APPLICATION_ID = "e0000000-0000-4000-8000-000000000001";
const SESSION_ID = "15000000-0000-4000-8000-000000000001";
const REVIEW_ID = "2e000000-0000-4000-8000-000000000001";
const ATTACHMENT_ID = "a7000000-0000-4000-8000-000000000001";

let supabase: SupabaseMock;

const has = (call: RecordedCall, method: string) => call.chain.some((m) => m.method === method);
const inserts = () => supabase.callsFor("application_attachments").filter((c) => has(c, "insert"));
const eqs = (call: RecordedCall) => call.chain.filter((m) => m.method === "eq").map((m) => m.args);

const ownsApplication = () => supabase.queue("applications", { data: { id: APPLICATION_ID }, error: null });
const ownsSession = () => supabase.queue("interview_sessions", { data: { id: SESSION_ID }, error: null });
const inserted = () => supabase.queue("application_attachments", { data: { id: ATTACHMENT_ID }, error: null });

const attachSession = () =>
  attachToApplicationAction({ applicationId: APPLICATION_ID, kind: "interview_session", interviewSessionId: SESSION_ID });

beforeEach(async () => {
  vi.clearAllMocks();
  supabase = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  await setRequestUser(PUBLIC_APPLICANT.user, supabase.client);
});

describe("attachToApplicationAction (ORT-061, OR-TEST-006)", () => {
  it("refuses a signed-out user", async () => {
    await setRequestUser(null);

    expect(await attachSession()).toEqual({ ok: false, error: "Sign in first." });
  });

  it.each([
    ["a non-UUID application", { applicationId: "x", kind: "interview_session", interviewSessionId: SESSION_ID }],
    ["an unknown kind", { applicationId: APPLICATION_ID, kind: "transcript", interviewSessionId: SESSION_ID }],
    ["a session id on a review", { applicationId: APPLICATION_ID, kind: "resume_review", interviewSessionId: SESSION_ID }],
    ["a forged applicant id", { applicationId: APPLICATION_ID, kind: "interview_session", interviewSessionId: SESSION_ID, applicant_user_id: COMPANY_A.user.id }],
  ])("rejects %s without a query", async (_label, input) => {
    const result = await attachToApplicationAction(input as never);

    expect(result.ok).toBe(false);
    expect(supabase.calls).toHaveLength(0);
  });

  it("checks the application is the session user's", async () => {
    supabase.queue("applications", { data: null, error: null });

    expect((await attachSession()).ok).toBe(false);
    expect(eqs(supabase.callsFor("applications")[0])).toContainEqual(["applicant_user_id", PUBLIC_APPLICANT.user.id]);
    expect(inserts()).toHaveLength(0);
  });

  it("refuses another user's (or an unfinished) session, with no insert and no queueing", async () => {
    ownsApplication();
    supabase.queue("interview_sessions", { data: null, error: null });

    expect(await attachSession()).toEqual({ ok: false, error: expect.any(String) });
    const sessionQuery = supabase.callsFor("interview_sessions")[0];
    expect(eqs(sessionQuery)).toContainEqual(["interviews.user_id", PUBLIC_APPLICANT.user.id]);
    expect(eqs(sessionQuery)).toContainEqual(["status", "completed"]);
    expect(inserts()).toHaveLength(0);
    expect(supabase.callsFor("enqueue_company_interview_analysis")).toHaveLength(0);
  });

  it("refuses another user's review", async () => {
    ownsApplication();
    supabase.queue("resume_reviews", { data: null, error: null });

    const result = await attachToApplicationAction({
      applicationId: APPLICATION_ID,
      kind: "resume_review",
      resumeReviewId: REVIEW_ID,
    });

    expect(result.ok).toBe(false);
    expect(eqs(supabase.callsFor("resume_reviews")[0])).toContainEqual(["user_id", PUBLIC_APPLICANT.user.id]);
    expect(inserts()).toHaveLength(0);
  });

  it("attaches a session and queues the company analysis through the RPC", async () => {
    ownsApplication();
    ownsSession();
    inserted();
    supabase.queueRpc("enqueue_company_interview_analysis", {
      data: { analysis_id: "x", queued: true },
      error: null,
    });

    expect(await attachSession()).toEqual({ ok: true, attachmentId: ATTACHMENT_ID, analysisQueued: true });
    expect(inserts()[0].chain[0].args[0]).toEqual({
      application_id: APPLICATION_ID,
      kind: "interview_session",
      interview_session_id: SESSION_ID,
      resume_review_id: null,
    });
    expect(supabase.callsFor("enqueue_company_interview_analysis")[0].chain[0].args[1]).toEqual({
      p_session: SESSION_ID,
    });
  });

  it("reports no new queueing when the session already has a company analysis (shared twice)", async () => {
    ownsApplication();
    ownsSession();
    inserted();
    supabase.queueRpc("enqueue_company_interview_analysis", {
      data: { analysis_id: "x", queued: false },
      error: null,
    });

    expect(await attachSession()).toMatchObject({ ok: true, analysisQueued: false });
  });

  it("answers clearly when the application already has one of that kind", async () => {
    ownsApplication();
    ownsSession();
    supabase.queue("application_attachments", { data: null, error: { code: "23505", message: "duplicate" } });

    expect(await attachSession()).toEqual({
      ok: false,
      error: "You've already shared an interview with this application.",
    });
    expect(supabase.callsFor("enqueue_company_interview_analysis")).toHaveLength(0);
  });

  it("attaches a review without queueing anything", async () => {
    ownsApplication();
    supabase.queue("resume_reviews", { data: { id: REVIEW_ID }, error: null });
    inserted();

    const result = await attachToApplicationAction({
      applicationId: APPLICATION_ID,
      kind: "resume_review",
      resumeReviewId: REVIEW_ID,
    });

    expect(result).toEqual({ ok: true, attachmentId: ATTACHMENT_ID, analysisQueued: false });
    expect(supabase.callsFor("enqueue_company_interview_analysis")).toHaveLength(0);
  });
});

describe("detachFromApplicationAction (ORT-061)", () => {
  it("deletes an unopened attachment, guarded on first_viewed_at", async () => {
    supabase.queue("application_attachments", { data: attachmentOf("interview_session", { id: ATTACHMENT_ID }), error: null });
    supabase.queue("application_attachments", { data: [{ id: ATTACHMENT_ID }], error: null });

    expect(await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).toEqual({ ok: true });
    const [read, del] = supabase.callsFor("application_attachments");
    expect(eqs(read)).toContainEqual(["applications.applicant_user_id", PUBLIC_APPLICANT.user.id]);
    expect(has(del, "delete")).toBe(true);
    expect(del.chain).toContainEqual({ method: "is", args: ["first_viewed_at", null] });
  });

  it("refuses once the company has opened it", async () => {
    supabase.queue("application_attachments", {
      data: attachmentOf("interview_session", { id: ATTACHMENT_ID, first_viewed_at: "2026-10-16T00:00:00.000Z" }),
      error: null,
    });

    expect(await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).toEqual({
      ok: false,
      error: "The company has already opened it.",
    });
    expect(supabase.callsFor("application_attachments").filter((c) => has(c, "delete"))).toHaveLength(0);
  });

  it("refuses when it was opened between the read and the delete", async () => {
    supabase.queue("application_attachments", { data: attachmentOf("resume_review", { id: ATTACHMENT_ID }), error: null });
    supabase.queue("application_attachments", { data: [], error: null });

    expect(await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).toEqual({
      ok: false,
      error: "The company has already opened it.",
    });
  });

  it("treats another user's attachment as not found", async () => {
    supabase.queue("application_attachments", { data: null, error: null });

    expect((await detachFromApplicationAction({ attachmentId: ATTACHMENT_ID })).ok).toBe(false);
    expect(supabase.callsFor("application_attachments").filter((c) => has(c, "delete"))).toHaveLength(0);
  });
});

describe("listShareableSignalsAction", () => {
  it("lists only the user's completed sessions and reviews", async () => {
    supabase.queue("interview_sessions", {
      data: [{ id: SESSION_ID, ended_at: "2026-10-10T00:00:00.000Z", started_at: "2026-10-10T00:00:00.000Z", interviews: { name: "Backend mock", user_id: PUBLIC_APPLICANT.user.id } }],
      error: null,
    });
    supabase.queue("resume_reviews", {
      data: [{ id: REVIEW_ID, name: null, score: 82, created_at: "2026-10-09T00:00:00.000Z" }],
      error: null,
    });

    expect(await listShareableSignalsAction()).toEqual({
      sessions: [{ id: SESSION_ID, label: "Backend mock", endedAt: "2026-10-10T00:00:00.000Z" }],
      reviews: [{ id: REVIEW_ID, label: "Resume review", score: 82 }],
    });
    expect(eqs(supabase.callsFor("interview_sessions")[0])).toEqual(
      expect.arrayContaining([["interviews.user_id", PUBLIC_APPLICANT.user.id], ["status", "completed"]]),
    );
    expect(eqs(supabase.callsFor("resume_reviews")[0])).toEqual(
      expect.arrayContaining([["user_id", PUBLIC_APPLICANT.user.id], ["status", "completed"]]),
    );
  });
});
