import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { listJobInterviews } from "./job-interviews";

vi.mock("server-only", () => ({}));

const JOB = "b0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-14T12:00:00.000Z");
const ME = "c1000000-0000-4000-8000-000000000001";
const ADA = "c1000000-0000-4000-8000-000000000002";

const row = (id: string, app: string, over: Record<string, unknown> = {}) => ({
  id,
  application_id: app,
  name: "Tech screen",
  status: "scheduled",
  starts_at: "2026-11-14T10:00:00.000Z",
  ends_at: "2026-11-14T11:00:00.000Z",
  duration_minutes: 60,
  applications: { user_info: { full_name: "Ada Lovelace" }, company_candidates: null },
  ...over,
});

const seat = (interview_id: string, author_user_id: string, author_name: string, status: string | null) => ({
  interview_id,
  author_user_id,
  author_name,
  status,
  response: "accepted",
  content_visible: false,
  overall: "strong_yes",
  overall_note: "hidden",
  ratings: {},
  submitted_at: null,
});

describe("listJobInterviews (IVT-082)", () => {
  it("lists the job's open interviews with who still owes a scorecard, from one scorecard read per application", async () => {
    const db = createSupabaseMock();
    db.queue("scheduled_interviews", {
      data: [
        row("i1", "a1"),
        row("i2", "a1", { status: "scheduled", starts_at: "2026-11-20T10:00:00.000Z", name: "Onsite" }),
        row("i3", "a2", {
          status: "awaiting_candidate",
          starts_at: null,
          applications: { user_info: { full_name: "Ada" }, company_candidates: { full_name: "Grace Hopper" } },
        }),
      ],
      error: null,
    });
    db.queueRpc("list_interview_scorecards", {
      data: [seat("i1", ME, "Me", "submitted"), seat("i1", ADA, "Ada", "draft"), seat("i2", ADA, "Ada", null)],
      error: null,
    });
    db.queueRpc("list_interview_scorecards", { data: [], error: null });

    const list = await listJobInterviews(db.client, JOB, { now: NOW });
    expect(list.map((i) => [i.id, i.candidateName, i.feedbackOwedBy])).toEqual([
      ["i1", "Ada Lovelace", ["Ada"]],
      // Not started: nobody owes feedback yet.
      ["i2", "Ada Lovelace", []],
      // The company's own record wins, as applicationPerson does.
      ["i3", "Grace Hopper", []],
    ]);
    expect(list[0].panel).toEqual([
      { userId: ME, name: "Me", response: "accepted", scorecardStatus: "submitted" },
      { userId: ADA, name: "Ada", response: "accepted", scorecardStatus: "draft" },
    ]);
    // Status only: never a scorecard's content.
    expect(JSON.stringify(list)).not.toMatch(/strong_yes|hidden/);
    expect(db.callsFor("list_interview_scorecards").map((c) => c.chain[0].args[1])).toEqual([
      { p_application_id: "a1" },
      { p_application_id: "a2" },
    ]);

    const query = db.callsFor("scheduled_interviews")[0].chain;
    expect(query).toContainEqual({ method: "eq", args: ["job_post_id", JOB] });
    expect(query).toContainEqual({ method: "is", args: ["applications.merged_into_application_id", null] });
    expect(query).toContainEqual({
      method: "or",
      args: ["status.in.(awaiting_candidate,scheduled),and(status.eq.completed,ends_at.gt.2026-11-07T12:00:00.000Z)"],
    });
  });

  it("is empty without interviews (or without access) and reads no scorecards", async () => {
    const db = createSupabaseMock();
    db.queue("scheduled_interviews", { data: [], error: null });
    expect(await listJobInterviews(db.client, JOB, { now: NOW })).toEqual([]);
    expect(db.callsFor("list_interview_scorecards")).toHaveLength(0);
  });
});
