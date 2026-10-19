import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { countUninvitedAboveThreshold, getInterviewFunnel } from "./funnel";

const JOB = "b0000000-0000-4000-8000-0000000000a1";

describe("getInterviewFunnel (SI-REQ-004)", () => {
  it("counts each status and averages the completed reports' overall scores", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", {
      data: [
        { status: "invited", interview_id: "i1" },
        { status: "paused", interview_id: "i2" },
        { status: "in_progress", interview_id: "i3" },
        { status: "completed", interview_id: "i4" },
        { status: "completed", interview_id: "i5" },
        { status: "completed", interview_id: "i6" },
        { status: "expired", interview_id: "i7" },
        { status: "declined", interview_id: "i8" },
        { status: "cancelled", interview_id: "i9" },
      ],
      error: null,
    });
    mock.queue("interview_sessions", {
      data: [{ id: "s4" }, { id: "s5" }, { id: "s6" }],
      error: null,
    });
    mock.queue("interview_analyses", {
      data: [
        { result: { overallScore: 4 } },
        { result: { overallScore: 3.5 } },
        // Too short to score: left out of the average.
        { result: { overallScore: null } },
      ],
      error: null,
    });

    expect(await getInterviewFunnel(mock.client, JOB)).toEqual({
      invited: 9,
      waiting: 2,
      inProgress: 1,
      completed: 3,
      expired: 1,
      declined: 1,
      avgScore: 3.8,
    });
    expect(mock.callsFor("interview_sessions")[0].chain).toContainEqual({
      method: "in",
      args: ["interview_id", ["i4", "i5", "i6"]],
    });
    const analyses = mock.callsFor("interview_analyses")[0].chain;
    expect(analyses).toContainEqual({ method: "eq", args: ["perspective", "company"] });
    expect(analyses).toContainEqual({ method: "eq", args: ["status", "completed"] });
  });

  it("is all zeros with no average for a job with no invites", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", { data: [], error: null });
    expect(await getInterviewFunnel(mock.client, JOB)).toEqual({
      invited: 0,
      waiting: 0,
      inProgress: 0,
      completed: 0,
      expired: 0,
      declined: 0,
      avgScore: null,
    });
    expect(mock.callsFor("interview_sessions")).toHaveLength(0);
  });
});

describe("countUninvitedAboveThreshold (difference 35)", () => {
  it("counts completed screenings at or above the bar with no interview", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_screenings", {
      data: [{ application_id: "a1" }, { application_id: "a2" }, { application_id: "a3" }],
      error: null,
    });
    mock.queue("application_interviews", { data: [{ application_id: "a2" }], error: null });

    expect(await countUninvitedAboveThreshold(mock.client, JOB, 70)).toBe(2);
    const screenings = mock.callsFor("application_screenings")[0].chain;
    expect(screenings).toContainEqual({ method: "eq", args: ["job_post_id", JOB] });
    expect(screenings).toContainEqual({ method: "eq", args: ["status", "completed"] });
    expect(screenings).toContainEqual({ method: "gte", args: ["fit_score", 70] });
    expect(mock.callsFor("application_interviews")[0].chain).toContainEqual({
      method: "in",
      args: ["application_id", ["a1", "a2", "a3"]],
    });
  });

  it("is 0 without screenings above the bar", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_screenings", { data: [], error: null });
    expect(await countUninvitedAboveThreshold(mock.client, JOB, 70)).toBe(0);
    expect(mock.callsFor("application_interviews")).toHaveLength(0);
  });
});
