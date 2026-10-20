import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import fixture from "@/helpers/interview/screening/fixtures/transcript-callback.json";
import { notifyCompanyOfCompletedInterview } from "@/helpers/interview/screening/notify-company";
import { flushAfter } from "@/test/utils/after";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/notify-company", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/interview/screening/notify-company")>()),
  notifyCompanyOfCompletedInterview: vi.fn(),
}));

const SECRET = "voice-callback-secret";
let service: SupabaseMock;

const post = (body: unknown = fixture, secret: string | null = SECRET) =>
  POST(
    buildRequest("/api/internal/interview-transcript", {
      method: "POST",
      body,
      headers: secret === null ? {} : { "x-voice-callback-secret": secret },
    }),
  );

const queueSession = (kind = "screening") =>
  service.queue("interview_sessions", {
    data: { id: "is-1", interviews: { kind, application_interview_id: "ai-1" } },
    error: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VOICE_CALLBACK_SECRET", SECRET);
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/internal/interview-transcript (SI-SEC-004, SI-TEST-004)", () => {
  it.each([
    ["missing", null],
    ["wrong", "nope"],
    ["a prefix of the right one", SECRET.slice(0, 5)],
  ])("401 with a %s secret", async (_, secret) => {
    expect((await post(fixture, secret)).status).toBe(401);
    expect(service.calls).toHaveLength(0);
  });

  it("401 when the server has no secret configured", async () => {
    vi.stubEnv("VOICE_CALLBACK_SECRET", "");
    expect((await post(fixture, "")).status).toBe(401);
  });

  it.each([
    ["too many turns", { ...fixture, turns: Array.from({ length: 201 }, () => fixture.turns[0]) }],
    ["an over-long turn", { ...fixture, turns: [{ ...fixture.turns[0], user: "x".repeat(4001) }] }],
    ["an unknown key", { ...fixture, score: 5 }],
    ["the sweeper's end reason", { ...fixture, endReason: "no_callback" }],
  ])("400 for %s", async (_, body) => {
    expect((await post(body)).status).toBe(400);
    expect(service.calls).toHaveLength(0);
  });

  it("404 for a session start_screening_attempt didn't register", async () => {
    expect((await post()).status).toBe(404);
    const lookup = service.callsFor("interview_sessions")[0].chain;
    expect(lookup).toContainEqual({ method: "eq", args: ["interview_id", fixture.interviewId] });
    expect(lookup).toContainEqual({ method: "eq", args: ["voice_session_id", fixture.voiceSessionId] });
  });

  it("202 ignored for a practice session, without writing", async () => {
    queueSession("practice");
    const res = await post();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "ignored" });
    expect(service.callsFor("finish_screening_session")).toHaveLength(0);
  });

  it.each(["completed", "time_limit", "inactivity", "client_disconnect", "error"])(
    "records an %s end with the transcript and duration",
    async (endReason) => {
      queueSession();
      service.queueRpc("finish_screening_session", {
        data: { ok: true, status: "recorded", session_status: "completed", interview_status: "completed" },
        error: null,
      });

      const res = await post({ ...fixture, endReason });

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "recorded" });
      expect(service.callsFor("finish_screening_session")[0].chain[0].args[1]).toEqual({
        p_session_id: "is-1",
        p_turns: fixture.turns,
        p_end_reason: endReason,
        p_duration_seconds: fixture.durationSeconds,
      });
    },
  );

  it("200 already_recorded on a repeat callback", async () => {
    queueSession();
    service.queueRpc("finish_screening_session", { data: { ok: true, status: "already_recorded" }, error: null });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "already_recorded" });
  });

  it("500 when recording fails, so the voice server retries", async () => {
    queueSession();
    service.queueRpc("finish_screening_session", { data: null, error: { message: "down" } });
    expect((await post()).status).toBe(500);
  });

  describe("the company email for an interview too short to score (SI-REQ-030)", () => {
    const finish = (data: Record<string, unknown>) =>
      service.queueRpc("finish_screening_session", { data: { ok: true, ...data }, error: null });

    it("is sent after the response when the interview completed with no report", async () => {
      queueSession();
      finish({ status: "recorded", session_status: "ineligible", interview_status: "completed", analysis_id: null });

      expect((await post()).status).toBe(200);
      expect(notifyCompanyOfCompletedInterview).not.toHaveBeenCalled();
      await flushAfter();
      expect(notifyCompanyOfCompletedInterview).toHaveBeenCalledWith(service.client, "ai-1", { scored: false });
    });

    it.each([
      ["a report was queued (the worker emails)", { status: "recorded", interview_status: "completed", analysis_id: "an-1" }],
      ["a retry is allowed", { status: "recorded", interview_status: "invited", analysis_id: null, retry: true }],
      ["a repeat callback", { status: "already_recorded", interview_status: "completed", analysis_id: null }],
    ])("isn't sent when %s", async (_, data) => {
      queueSession();
      finish(data);

      await post();
      await flushAfter();
      expect(notifyCompanyOfCompletedInterview).not.toHaveBeenCalled();
    });
  });
});
