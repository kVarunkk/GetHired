import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICATION_ID, competencyOf, interviewOf, planItemOf, snapshotOf } from "@/test/utils/interviews";
import { stageOf } from "@/test/utils/pipeline";
import { ADMIN_A, MEMBER_A, OWNER_A } from "@/test/utils/team";
import {
  cancelInterview,
  listApplicationInterviews,
  markInterview,
  openPlanItemIds,
  recordInterview,
  updateInterview,
} from "./interviews";

vi.mock("server-only", () => ({}));

let db: SupabaseMock;
const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const START = "2026-12-01T10:00:00.000Z";

beforeEach(() => {
  db = createSupabaseMock();
});

describe("recordInterview (IVT-016)", () => {
  it("sends a plan interview without a name or length", async () => {
    const item = planItemOf();
    db.queueRpc("record_interview", {
      data: { ok: true, id: INTERVIEW, application_id: APPLICATION_ID, status: "scheduled" },
      error: null,
    });

    const result = await recordInterview(db.client, {
      applicationId: APPLICATION_ID,
      planItemId: item.id,
      name: "ignored",
      panel: [OWNER_A.user.id, OWNER_A.user.id, ADMIN_A.user.id],
      startsAt: START,
      meetingUrl: "https://meet.example/abc",
    });

    expect(result).toEqual({ ok: true, id: INTERVIEW, applicationId: APPLICATION_ID, status: "scheduled" });
    expect(rpcArgs("record_interview")[0]).toEqual({
      p_application_id: APPLICATION_ID,
      p_panel: [OWNER_A.user.id, ADMIN_A.user.id],
      p_starts_at: START,
      p_plan_item_id: item.id,
      p_meeting_url: "https://meet.example/abc",
    });
  });

  it("sends an ad-hoc interview's name and length", async () => {
    db.queueRpc("record_interview", { data: { ok: true, application_id: APPLICATION_ID, status: "completed" }, error: null });
    await recordInterview(db.client, {
      applicationId: APPLICATION_ID,
      name: "Coffee chat",
      durationMinutes: 30,
      panel: [OWNER_A.user.id],
      startsAt: START,
    });
    expect(rpcArgs("record_interview")[0]).toEqual({
      p_application_id: APPLICATION_ID,
      p_panel: [OWNER_A.user.id],
      p_starts_at: START,
      p_name: "Coffee chat",
      p_duration_minutes: 30,
    });
  });

  it.each([
    [{ panel: [] }, "Pick 1 to 6 interviewers."],
    [{ name: undefined }, "Give the interview a name."],
    [{ startsAt: "tomorrow" }, "Pick when the interview starts."],
    [{ meetingUrl: "javascript:alert(1)" }, "Use a meeting link that starts with https://."],
  ])("refuses %o before the RPC", async (patch, error) => {
    const result = await recordInterview(db.client, {
      applicationId: APPLICATION_ID,
      name: "Chat",
      durationMinutes: 30,
      panel: [OWNER_A.user.id],
      startsAt: START,
      ...patch,
    });
    expect(result).toMatchObject({ ok: false, error });
    expect(rpcArgs("record_interview")).toHaveLength(0);
  });

  it.each([
    ["closed", "This application is in a Rejected or Hired stage. Move it back to an open stage first."],
    ["forbidden", "Your role can't schedule interviews for this job."],
    ["invalid_panel", "Pick 1 to 6 interviewers from your team."],
    ["new_reason", "Something went wrong. Please try again."],
  ])("maps the %s reason", async (reason, error) => {
    db.queueRpc("record_interview", { data: { ok: false, reason }, error: null });
    const result = await recordInterview(db.client, {
      applicationId: APPLICATION_ID,
      name: "Chat",
      durationMinutes: 30,
      panel: [OWNER_A.user.id],
      startsAt: START,
    });
    expect(result).toEqual({ ok: false, error });
  });
});

describe("updateInterview / cancelInterview / markInterview (IVT-016)", () => {
  it("sends only what changes", async () => {
    db.queueRpc("update_interview", { data: { ok: true, application_id: APPLICATION_ID, status: "scheduled" }, error: null });
    await updateInterview(db.client, { interviewId: INTERVIEW, panel: [MEMBER_A.user.id] });
    expect(rpcArgs("update_interview")[0]).toEqual({ p_id: INTERVIEW, p_panel: [MEMBER_A.user.id] });
  });

  it("clears the meeting link with null", async () => {
    db.queueRpc("update_interview", { data: { ok: true, application_id: APPLICATION_ID, status: "scheduled" }, error: null });
    await updateInterview(db.client, { interviewId: INTERVIEW, meetingUrl: null });
    expect(rpcArgs("update_interview")[0]).toEqual({ p_id: INTERVIEW, p_clear_meeting_url: true });
  });

  it("refuses an update with nothing in it", async () => {
    expect(await updateInterview(db.client, { interviewId: INTERVIEW })).toMatchObject({ ok: false, error: "Nothing to change." });
  });

  it("cancels and maps a refusal", async () => {
    db.queueRpc("cancel_interview", { data: { ok: false, reason: "invalid_status" }, error: null });
    expect(await cancelInterview(db.client, INTERVIEW)).toEqual({
      ok: false,
      error: "This interview can't be changed in its current state.",
    });
    expect(rpcArgs("cancel_interview")[0]).toEqual({ p_id: INTERVIEW });
  });

  it("marks a no-show, and maps too_late", async () => {
    db.queueRpc("mark_interview", { data: { ok: false, reason: "too_late" }, error: null });
    expect(await markInterview(db.client, { interviewId: INTERVIEW, status: "no_show" })).toEqual({
      ok: false,
      error: "No-shows can only be marked within 7 days of the interview.",
    });
    expect(rpcArgs("mark_interview")[0]).toEqual({ p_id: INTERVIEW, p_status: "no_show" });
  });

  it("refuses another status before the RPC", async () => {
    const result = await markInterview(db.client, { interviewId: INTERVIEW, status: "cancelled" as "completed" });
    expect(result.ok).toBe(false);
    expect(rpcArgs("mark_interview")).toHaveLength(0);
  });

  it("throws on an RPC error", async () => {
    db.queueRpc("cancel_interview", { data: null, error: { message: "boom" } });
    await expect(cancelInterview(db.client, INTERVIEW)).rejects.toThrow(/boom/);
  });
});

describe("listApplicationInterviews (IVT-018)", () => {
  const item = planItemOf({ stage_id: stageOf("interview").id });
  const comps = [competencyOf({ plan_item_id: item.id }), competencyOf({ plan_item_id: item.id, position: 1 })];
  const seat = (author: string, over: Record<string, unknown>) => ({
    interview_id: "",
    author_user_id: author,
    author_name: author === OWNER_A.user.id ? "Owen" : "Ada",
    response: "needs_action",
    scorecard_id: null,
    status: "none",
    submitted_at: null,
    locked_at: null,
    content_visible: false,
    overall: null,
    overall_note: null,
    ratings: null,
    ...over,
  });

  function queue(interviews: ReturnType<typeof interviewOf>[], seats: ReturnType<typeof seat>[]) {
    db.queue("scheduled_interviews", { data: interviews, error: null });
    db.queueRpc("list_interview_scorecards", { data: seats, error: null });
    db.queue("pipeline_stages", {
      data: [
        { id: stageOf("screening").id, name: "Screening", position: 1 },
        { id: stageOf("interview").id, name: "Interview", position: 2 },
      ],
      error: null,
    });
  }

  it("groups by stage in pipeline order, with each seat's state", async () => {
    const onsite = interviewOf({ stage_id: stageOf("interview").id, plan_snapshot: snapshotOf(item, comps) });
    const screen = interviewOf({ stage_id: stageOf("screening").id });
    queue(
      [onsite, screen],
      [
        seat(OWNER_A.user.id, {
          interview_id: onsite.id,
          status: "submitted",
          content_visible: true,
          overall: "yes",
          overall_note: "Solid",
          ratings: { [comps[0].id]: { rating: "strong_yes", note: "" } },
        }),
        seat(ADMIN_A.user.id, { interview_id: onsite.id, status: "submitted", content_visible: true, overall: "no",
          ratings: { [comps[0].id]: { rating: "yes", note: "" }, [comps[1].id]: { rating: "no", note: "x" } } }),
        seat(OWNER_A.user.id, { interview_id: screen.id }),
      ],
    );

    const groups = await listApplicationInterviews(db.client, APPLICATION_ID);

    expect(groups.map((g) => g.stageName)).toEqual(["Screening", "Interview"]);
    const got = groups[1].interviews[0];
    expect(got.competencies.map((c) => c.id)).toEqual(comps.map((c) => c.id));
    expect(got.submitted).toBe(2);
    expect(got.hidden).toBe(0);
    expect(got.panel[0]).toMatchObject({ name: "Owen", scorecardStatus: "submitted", overall: "yes", overallNote: "Solid" });
    expect(got.summary[0].counts).toEqual({ strong_no: 0, no: 0, yes: 1, strong_yes: 1 });
    expect(got.summary[1].counts).toEqual({ strong_no: 0, no: 1, yes: 0, strong_yes: 0 });
    expect(groups[0].interviews[0].panel[0].scorecardStatus).toBe("none");
  });

  it("a blind reader gets counts only: no content and no summary", async () => {
    const onsite = interviewOf({ stage_id: stageOf("interview").id, plan_snapshot: snapshotOf(item, comps) });
    queue(
      [onsite],
      [
        // The RPC already nulls hidden content; the helper must not trust it anyway.
        seat(OWNER_A.user.id, { interview_id: onsite.id, status: "submitted", content_visible: false, overall: "strong_yes",
          ratings: { [comps[0].id]: { rating: "strong_yes", note: "" } } }),
        seat(ADMIN_A.user.id, { interview_id: onsite.id, status: "draft", content_visible: true, overall: "no" }),
      ],
    );

    const [group] = await listApplicationInterviews(db.client, APPLICATION_ID);
    const got = group.interviews[0];

    expect(got.submitted).toBe(1);
    expect(got.hidden).toBe(1);
    expect(got.panel[0]).toMatchObject({ visible: false, overall: null, ratings: null, overallNote: null });
    expect(got.summary.every((s) => Object.values(s.counts).every((n) => n === 0))).toBe(true);
    // Their own draft is shown to them.
    expect(got.panel[1]).toMatchObject({ visible: true, overall: "no", scorecardStatus: "draft" });
  });

  it("returns nothing without interviews", async () => {
    db.queue("scheduled_interviews", { data: [], error: null });
    db.queueRpc("list_interview_scorecards", { data: [], error: null });
    expect(await listApplicationInterviews(db.client, APPLICATION_ID)).toEqual([]);
    expect(db.callsFor("pipeline_stages")).toHaveLength(0);
  });
});

describe("openPlanItemIds", () => {
  it("returns the plan items with an open interview for the application", async () => {
    db.queue("scheduled_interviews", {
      data: [{ plan_item_id: "p1" }, { plan_item_id: "p2" }, { plan_item_id: "p1" }],
      error: null,
    });

    const ids = await openPlanItemIds(db.client, APPLICATION_ID);

    expect(ids).toEqual(new Set(["p1", "p2"]));
    const chain = db.callsFor("scheduled_interviews")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["application_id", APPLICATION_ID] });
    expect(chain).toContainEqual({ method: "in", args: ["status", ["awaiting_candidate", "scheduled"]] });
    expect(chain).toContainEqual({ method: "not", args: ["plan_item_id", "is", null] });
  });

  it("is empty when the read fails", async () => {
    db.queue("scheduled_interviews", { data: null, error: { message: "boom" } });
    expect(await openPlanItemIds(db.client, APPLICATION_ID)).toEqual(new Set());
  });
});
