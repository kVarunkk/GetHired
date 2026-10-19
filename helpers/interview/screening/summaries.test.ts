import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { getInterviewSummaries } from "./summaries";
import { interviewBadge } from "./summary-view";

vi.mock("server-only", () => ({}));

const JOB = "b0000000-0000-4000-8000-0000000000a1";

describe("getInterviewSummaries (SIT-062)", () => {
  it("keys each interview by application, with the completed report's overall score", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", {
      data: [
        { id: "ai1", application_id: "a1", status: "invited", interview_id: "i1" },
        { id: "ai2", application_id: "a2", status: "completed", interview_id: "i2" },
        { id: "ai3", application_id: "a3", status: "completed", interview_id: "i3" },
        { id: "ai4", application_id: "a4", status: "completed", interview_id: "i4" },
      ],
      error: null,
    });
    mock.queue("interview_sessions", {
      data: [
        { id: "s2", interview_id: "i2" },
        { id: "s3", interview_id: "i3" },
      ],
      error: null,
    });
    mock.queue("interview_analyses", {
      data: [
        { interview_session_id: "s2", status: "completed", overallScore: 3.8 },
        { interview_session_id: "s3", status: "processing", overallScore: null },
      ],
      error: null,
    });

    expect(await getInterviewSummaries(mock.client, JOB)).toEqual({
      a1: { id: "ai1", status: "invited", overallScore: null, report: "none" },
      a2: { id: "ai2", status: "completed", overallScore: 3.8, report: "ready" },
      a3: { id: "ai3", status: "completed", overallScore: null, report: "pending" },
      // Completed with no scored session: too short, or the last attempt failed.
      a4: { id: "ai4", status: "completed", overallScore: null, report: "none" },
    });
    expect(mock.callsFor("application_interviews")[0].chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB] });
    expect(mock.callsFor("interview_analyses")[0].chain).toContainEqual({ method: "eq", args: ["perspective", "company"] });
  });

  it("is empty without interviews (or without interviews.view, through RLS)", async () => {
    const mock = createSupabaseMock();
    mock.queue("application_interviews", { data: [], error: null });
    expect(await getInterviewSummaries(mock.client, JOB)).toEqual({});
    expect(mock.callsFor("interview_sessions")).toHaveLength(0);
  });
});

describe("interviewBadge", () => {
  const s = (status: string, overallScore: number | null = null, report: "ready" | "pending" | "none" = "none") => ({
    id: "x",
    status,
    overallScore,
    report,
  });

  it.each([
    [s("invited"), "Invited"],
    [s("paused"), "Paused"],
    [s("in_progress"), "In progress"],
    [s("completed", 4, "ready"), "4.0 / 5"],
    [s("completed", null, "pending"), "Scoring…"],
    [s("completed", null, "ready"), "Not scored"],
    [s("completed", null, "none"), "Incomplete"],
    [s("expired"), "Expired"],
    [s("declined"), "Declined"],
    [s("cancelled"), "Cancelled"],
  ])("%o reads %s", (summary, label) => {
    expect(interviewBadge(summary).label).toBe(label);
  });
});
