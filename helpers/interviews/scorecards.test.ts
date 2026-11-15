import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICATION_ID } from "@/test/utils/interviews";
import { loadInterviewKit, saveScorecardDraft, submitScorecard } from "./scorecards";

vi.mock("server-only", () => ({}));

let db: SupabaseMock;
const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const COMP = "1c000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  db = createSupabaseMock();
});

describe("saveScorecardDraft (IVT-017)", () => {
  it("sends the ratings by competency id, the overall and the note", async () => {
    db.queueRpc("save_scorecard_draft", {
      data: { ok: true, id: "5c", application_id: APPLICATION_ID, status: "draft", updated_at: "t", locked_at: null },
      error: null,
    });
    const result = await saveScorecardDraft(db.client, {
      interviewId: INTERVIEW,
      ratings: { [COMP]: { rating: "yes", note: "Clear" } },
      overall: "strong_yes",
      overallNote: "Hire",
    });
    expect(result).toEqual({ ok: true, id: "5c", applicationId: APPLICATION_ID, status: "draft", updatedAt: "t", lockedAt: null });
    expect(rpcArgs("save_scorecard_draft")[0]).toEqual({
      p_interview_id: INTERVIEW,
      p_ratings: { [COMP]: { rating: "yes", note: "Clear" } },
      p_overall: "strong_yes",
      p_overall_note: "Hire",
    });
  });

  it("leaves the overall out when there's none yet", async () => {
    db.queueRpc("save_scorecard_draft", { data: { ok: true, id: "5c", status: "draft" }, error: null });
    await saveScorecardDraft(db.client, { interviewId: INTERVIEW, ratings: {}, overall: null });
    expect(rpcArgs("save_scorecard_draft")[0]).not.toHaveProperty("p_overall");
  });

  it("refuses a rating that isn't on the scale, and a key that isn't an id", async () => {
    expect(
      (await saveScorecardDraft(db.client, {
        interviewId: INTERVIEW,
        ratings: { [COMP]: { rating: "maybe" as "yes", note: "" } },
        overall: null,
      })).ok,
    ).toBe(false);
    expect((await saveScorecardDraft(db.client, { interviewId: INTERVIEW, ratings: { x: { rating: null, note: "" } }, overall: null })).ok).toBe(false);
    expect(rpcArgs("save_scorecard_draft")).toHaveLength(0);
  });

  it.each([
    ["ratings_locked", "Your ratings were locked when you submitted."],
    ["locked", "Your scorecard is locked. Notes can only be edited for 24 hours after you submit."],
    ["not_found", "You're not on this interview's panel."],
  ])("maps %s", async (reason, error) => {
    db.queueRpc("save_scorecard_draft", { data: { ok: false, reason }, error: null });
    expect(await saveScorecardDraft(db.client, { interviewId: INTERVIEW, ratings: {}, overall: null })).toEqual({ ok: false, error });
  });
});

describe("submitScorecard (IVT-017)", () => {
  it("returns when the notes lock", async () => {
    db.queueRpc("submit_scorecard", {
      data: { ok: true, id: "5c", application_id: APPLICATION_ID, submitted_at: "s", locked_at: "l" },
      error: null,
    });
    expect(await submitScorecard(db.client, INTERVIEW)).toEqual({
      ok: true,
      id: "5c",
      applicationId: APPLICATION_ID,
      submittedAt: "s",
      lockedAt: "l",
    });
  });

  it("maps missing_overall", async () => {
    db.queueRpc("submit_scorecard", { data: { ok: false, reason: "missing_overall" }, error: null });
    expect(await submitScorecard(db.client, INTERVIEW)).toEqual({
      ok: false,
      error: "Pick an overall recommendation before you submit.",
    });
  });
});

describe("loadInterviewKit (IVT-019)", () => {
  it("maps the full kit", async () => {
    db.queueRpc("get_interview_kit", {
      data: {
        ok: true,
        access: "kit",
        interview: {
          id: INTERVIEW,
          application_id: APPLICATION_ID,
          name: "System design",
          status: "scheduled",
          source: "manual",
          starts_at: "a",
          ends_at: "b",
          duration_minutes: 60,
          meeting_url: null,
          instructions: "Go deep",
          competencies: [{ id: COMP, name: "Architecture", description: "", questions: ["Q1"] }],
          panel: [{ user_id: "u1", name: "Rita" }],
        },
        job: { id: "j", title: "Backend", questions: null },
        candidate: { name: "One", has_resume: true },
        application: { answers: null, answers_v2: null, form_snapshot: null },
        scorecard: null,
      },
      error: null,
    });

    const result = await loadInterviewKit(db.client, INTERVIEW);

    expect(result.ok && result.kit.access).toBe("kit");
    if (!result.ok || result.kit.access !== "kit") throw new Error("expected a kit");
    expect(result.kit.interview).toMatchObject({ instructions: "Go deep", panel: [{ userId: "u1", name: "Rita" }] });
    expect(result.kit.interview.competencies[0].questions).toEqual(["Q1"]);
    expect(result.kit.candidate).toEqual({ name: "One", hasResume: true });
    expect(result.kit.scorecard).toBeNull();
  });

  it("maps scorecard-only access", async () => {
    db.queueRpc("get_interview_kit", {
      data: {
        ok: true,
        access: "scorecard_only",
        interview: { id: INTERVIEW, name: "X", status: "completed", competencies: [] },
        scorecard: {
          id: "5c", status: "submitted", overall: "yes", overall_note: "", ratings: {}, submitted_at: "s", locked_at: "l", updated_at: "u",
        },
      },
      error: null,
    });
    const result = await loadInterviewKit(db.client, INTERVIEW);
    expect(result).toMatchObject({ ok: true, kit: { access: "scorecard_only", scorecard: { overall: "yes" } } });
  });

  it.each(["not_found", "expired"] as const)("returns %s", async (reason) => {
    db.queueRpc("get_interview_kit", { data: { ok: false, reason }, error: null });
    expect(await loadInterviewKit(db.client, INTERVIEW)).toMatchObject({ ok: false, reason });
  });
});
