import { describe, expect, it } from "vitest";
import { PANEL_MAX, PLAN_LIMITS } from "./config";
import { planInputSchema, screenPlanFairness, type PlanInput } from "./plan-schema";

const STAGE = "5a000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000001";

const item = (overrides: Record<string, unknown> = {}) => ({
  stage_id: STAGE,
  name: "System design",
  duration_minutes: 60,
  instructions: "",
  default_interviewer_ids: [],
  competencies: [{ name: "Architecture", description: "", questions: ["Design a URL shortener."] }],
  ...overrides,
});

const parse = (items: unknown) => planInputSchema.safeParse(items);
const firstIssue = (items: unknown) => {
  const result = parse(items);
  if (result.success) throw new Error("expected a failure");
  return result.error.issues[0];
};

describe("planInputSchema (IVT-012, IV-REQ-001–003)", () => {
  it("accepts a plan, trimming text, defaulting duration and dropping blank questions", () => {
    const result = parse([
      item({
        name: "  System design ",
        duration_minutes: undefined,
        instructions: undefined,
        competencies: [{ name: " Architecture ", questions: ["  ", "Why?"] }],
      }),
    ]);
    expect(result.success).toBe(true);
    expect(result.data![0]).toMatchObject({
      name: "System design",
      duration_minutes: PLAN_LIMITS.durationDefault,
      instructions: "",
      competencies: [{ name: "Architecture", description: "", questions: ["Why?"] }],
    });
  });

  it("keeps sent ids so competency ids stay stable", () => {
    const id = "1a000000-0000-4000-8000-000000000001";
    const cid = "1c000000-0000-4000-8000-000000000001";
    const result = parse([item({ id, competencies: [{ id: cid, name: "A" }] })]);
    expect(result.data![0].id).toBe(id);
    expect(result.data![0].competencies[0].id).toBe(cid);
  });

  it("dedupes default interviewers", () => {
    expect(parse([item({ default_interviewer_ids: [USER, USER] })]).data![0].default_interviewer_ids).toEqual([USER]);
  });

  it("is strict: unknown keys are refused", () => {
    expect(parse([item({ company_id: "x" })]).success).toBe(false);
    expect(parse([item({ competencies: [{ name: "A", rating: 3 }] })]).success).toBe(false);
  });

  it.each([
    ["too many items", Array.from({ length: PLAN_LIMITS.items + 1 }, () => item())],
    ["an empty name", [item({ name: "  " })]],
    ["a long name", [item({ name: "x".repeat(PLAN_LIMITS.name + 1) })]],
    ["a short duration", [item({ duration_minutes: PLAN_LIMITS.durationMin - 1 })]],
    ["a long duration", [item({ duration_minutes: PLAN_LIMITS.durationMax + 1 })]],
    ["a fractional duration", [item({ duration_minutes: 30.5 })]],
    ["long instructions", [item({ instructions: "x".repeat(PLAN_LIMITS.instructions + 1) })]],
    ["no competencies", [item({ competencies: [] })]],
    [
      "too many competencies",
      [item({ competencies: Array.from({ length: PLAN_LIMITS.competenciesMax + 1 }, (_, i) => ({ name: `C${i}` })) })],
    ],
    ["a long competency name", [item({ competencies: [{ name: "x".repeat(PLAN_LIMITS.competencyName + 1) }] })]],
    [
      "a long description",
      [item({ competencies: [{ name: "A", description: "x".repeat(PLAN_LIMITS.competencyDescription + 1) }] })],
    ],
    [
      "too many questions",
      [item({ competencies: [{ name: "A", questions: Array.from({ length: PLAN_LIMITS.questions + 1 }, () => "Q?") }] })],
    ],
    ["a long question", [item({ competencies: [{ name: "A", questions: ["x".repeat(PLAN_LIMITS.question + 1)] }] })]],
    ["a bad stage id", [item({ stage_id: "screening" })]],
    ["too many interviewers", [item({ default_interviewer_ids: Array.from({ length: PANEL_MAX + 1 }, (_, i) => `a1000000-0000-4000-8000-00000000000${i}`) })]],
  ])("refuses %s", (_label, items) => {
    expect(parse(items).success).toBe(false);
  });

  it("points the issue at the field, with readable copy", () => {
    const issue = firstIssue([item({ competencies: [] })]);
    expect(issue.path).toEqual([0, "competencies"]);
    expect(issue.message).toBe("Add at least one competency.");
    expect(firstIssue([item({ name: "" })]).message).toBe("Give the interview a name.");
  });
});

describe("screenPlanFairness (IV-SEC: plan text is candidate_filter)", () => {
  const plan = (overrides: Record<string, unknown> = {}) => planInputSchema.parse([item(overrides)]) as PlanInput;

  it("passes ordinary plan text", () => {
    expect(screenPlanFairness(plan())).toEqual({ ok: true });
  });

  it("refuses a question about a protected characteristic, naming the field", () => {
    const result = screenPlanFairness(
      plan({ competencies: [{ name: "Culture", questions: ["Are you planning to get pregnant soon?"] }] }),
    );
    expect(result).toMatchObject({ ok: false, field: "0.competencies.0.questions.0" });
    expect((result as { error: string }).error).toMatch(/^Interview plans can't ask about /);
  });

  it("checks names, instructions and descriptions too", () => {
    expect(screenPlanFairness(plan({ name: "Native English speaker check" }))).toMatchObject({ ok: false, field: "0.name" });
    expect(screenPlanFairness(plan({ instructions: "Ask about their religion." }))).toMatchObject({
      ok: false,
      field: "0.instructions",
    });
    expect(
      screenPlanFairness(plan({ competencies: [{ name: "Fit", description: "Prefer candidates under 30 years old" }] })),
    ).toMatchObject({ ok: false, field: "0.competencies.0.description" });
  });
});
