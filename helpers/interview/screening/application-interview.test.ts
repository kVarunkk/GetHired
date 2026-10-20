import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { getApplicationInterview } from "./application-interview";

vi.mock("server-only", () => ({}));

const APP = "e0000000-0000-4000-8000-000000000001";
const SNAPSHOT = {
  questions: [{ text: "Why us?" }],
  competencies: [{ name: "APIs", description: "Designs clean APIs." }],
  duration_minutes: 15,
  deadline_days: 5,
  language: "en",
  company_name: "Acme",
  job_title: "Backend Engineer",
};
const ROW = {
  id: "ai1",
  status: "completed",
  job_post_id: "j1",
  interview_id: "i1",
  deadline_at: "2026-10-24T00:00:00.000Z",
  attempts_used: 2,
  max_attempts: 2,
  attempt_granted: false,
  deadline_extensions: 0,
  accommodation_request: null,
  invited_via: "fit_threshold",
  completed_at: "2026-10-20T00:00:00.000Z",
  created_at: "2026-10-19T00:00:00.000Z",
  config_snapshot: SNAPSHOT,
};
const TURN = { turn_id: 1, timestamp: 1, user: "I design REST APIs.", assistant: "Tell me about APIs.", interrupted: false };
const REPORT = {
  competencies: [{ name: "APIs", score: 4, rationale: "Clear.", evidence: [{ turnId: 1, quote: "I design REST APIs." }] }],
  questionCoverage: [{ question: "Why us?", asked: false, turnId: null }],
  summary: "Solid.",
  strengths: ["APIs"],
  concerns: [],
  followUpQuestions: ["Versioning?"],
  overallScore: 4,
};

describe("getApplicationInterview (SIT-063)", () => {
  it("returns the interview, its attempts and the latest company report", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", { data: ROW, error: null });
    mock.queue("interview_sessions", {
      data: [
        { id: "s1", started_at: "a", ended_at: "b", end_reason: "client_disconnect", duration_seconds: 40, status: "ineligible", turns: [] },
        { id: "s2", started_at: "c", ended_at: "d", end_reason: "completed", duration_seconds: 800, status: "completed", turns: [TURN] },
      ],
      error: null,
    });
    mock.queue("interview_analyses", {
      data: [{ interview_session_id: "s2", status: "completed", result: REPORT }],
      error: null,
    });

    const view = await getApplicationInterview(mock.client, APP);

    expect(view).toMatchObject({
      id: "ai1",
      status: "completed",
      attemptsUsed: 2,
      maxAttempts: 2,
      durationMinutes: 15,
      competencies: SNAPSHOT.competencies,
      questions: ["Why us?"],
      report: { status: "completed", sessionId: "s2", result: REPORT },
    });
    expect(view?.attempts.map((a) => [a.id, a.endReason, a.durationSeconds])).toEqual([
      ["s1", "client_disconnect", 40],
      ["s2", "completed", 800],
    ]);
    expect(view?.attempts[1].turns).toEqual([TURN]);
    expect(mock.callsFor("application_interviews")[0].chain).toContainEqual({ method: "eq", args: ["application_id", APP] });
    expect(mock.callsFor("interview_analyses")[0].chain).toContainEqual({ method: "eq", args: ["perspective", "company"] });
  });

  it("drops a stored report that doesn't match the schema (never shows a recommendation)", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", { data: ROW, error: null });
    mock.queue("interview_sessions", {
      data: [{ id: "s2", started_at: "c", ended_at: "d", end_reason: "completed", duration_seconds: 800, status: "completed", turns: [TURN] }],
      error: null,
    });
    mock.queue("interview_analyses", {
      data: [{ interview_session_id: "s2", status: "completed", result: { ...REPORT, recommendation: "hire" } }],
      error: null,
    });

    expect((await getApplicationInterview(mock.client, APP))?.report).toEqual({
      status: "completed",
      sessionId: "s2",
      result: null,
    });
  });

  it("has no report before a completed session", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", { data: { ...ROW, status: "invited", attempts_used: 0 }, error: null });
    mock.queue("interview_sessions", { data: [], error: null });

    const view = await getApplicationInterview(mock.client, APP);
    expect(view?.report).toBeNull();
    expect(view?.attempts).toEqual([]);
    expect(mock.callsFor("interview_analyses")).toHaveLength(0);
  });

  it("is null without an interview (or without interviews.view, through RLS)", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", { data: null, error: null });
    expect(await getApplicationInterview(mock.client, APP)).toBeNull();
  });
});
