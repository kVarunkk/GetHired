import { describe, expect, it } from "vitest";
import { stageOf } from "./pipeline";
import { COMPANY_A } from "./recruiter";
import { JOB_A1, MEMBER_A, OWNER_A } from "./team";
import {
  APPLICATION_ID,
  competencyOf,
  interviewOf,
  panelOf,
  planItemOf,
  scorecardOf,
  snapshotOf,
} from "./interviews";

describe("interview fixtures (IVT-001)", () => {
  it("makes a 45-minute plan item of JOB_A1 under Screening", () => {
    const item = planItemOf();
    expect(item).toMatchObject({
      company_id: COMPANY_A.id,
      job_post_id: JOB_A1,
      stage_id: stageOf("screening").id,
      duration_minutes: 45,
      default_interviewer_ids: [],
    });
    expect(item.id).toMatch(/^1a000000-0000-4000-8000-[0-9a-f]{12}$/);
  });

  it("gives each call its own id and applies overrides", () => {
    expect(planItemOf().id).not.toBe(planItemOf().id);
    expect(competencyOf().id).not.toBe(competencyOf().id);
    expect(planItemOf({ duration_minutes: 90 }).duration_minutes).toBe(90);
    expect(competencyOf({ questions: [] }).questions).toEqual([]);
  });

  it("snapshots a plan item with its competencies keyed by id", () => {
    const item = planItemOf();
    const c = competencyOf({ plan_item_id: item.id });
    expect(snapshotOf(item, [c])).toMatchObject({
      plan_item_id: item.id,
      competencies: [{ id: c.id, name: c.name, questions: c.questions }],
    });
  });

  it("makes a scheduled manual interview whose end follows the duration", () => {
    const start = new Date("2026-12-01T10:00:00.000Z");
    const i = interviewOf({ startsAt: start, duration_minutes: 60 });
    expect(i).toMatchObject({ status: "scheduled", source: "manual", application_id: APPLICATION_ID });
    expect(i.starts_at).toBe(start.toISOString());
    expect(i.ends_at).toBe("2026-12-01T11:00:00.000Z");
    expect(interviewOf({ status: "completed" }).status).toBe("completed");
  });

  it("makes panel seats and scorecards on an interview", () => {
    const i = interviewOf();
    expect(panelOf(i, [OWNER_A.user.id, MEMBER_A.user.id]).map((p) => p.user_id)).toEqual([
      OWNER_A.user.id,
      MEMBER_A.user.id,
    ]);
    expect(scorecardOf(i, MEMBER_A.user.id)).toMatchObject({ status: "draft", overall: null, submitted_at: null });
    expect(scorecardOf(i, MEMBER_A.user.id, { submitted: true })).toMatchObject({
      status: "submitted",
      overall: "yes",
      application_id: i.application_id,
    });
    expect(scorecardOf(i, MEMBER_A.user.id, { submitted: true, overall: "strong_no" }).overall).toBe("strong_no");
  });
});
