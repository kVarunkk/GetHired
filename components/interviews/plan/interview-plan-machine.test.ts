import { describe, expect, it } from "vitest";
import { PANEL_MAX, PLAN_LIMITS } from "@/helpers/interviews/config";
import { planInputSchema } from "@/helpers/interviews/plan-schema";
import {
  initialPlanState,
  isPlanDirty,
  planEditorReducer,
  toPlanInput,
  type PlanEditorEvent,
  type PlanEditorState,
  type SavedPlanItem,
} from "./interview-plan-machine";

const SCREEN = "51000000-0000-4000-8000-000000000001";
const ONSITE = "51000000-0000-4000-8000-000000000002";
const USER_1 = "c1000000-0000-4000-8000-000000000001";
const USER_2 = "c1000000-0000-4000-8000-000000000002";

const SAVED: SavedPlanItem[] = [
  {
    id: "1a000000-0000-4000-8000-000000000001",
    stage_id: ONSITE,
    name: "System design",
    duration_minutes: 60,
    instructions: "Go deep.",
    default_interviewer_ids: [USER_1],
    competencies: [
      { id: "1c000000-0000-4000-8000-000000000001", name: "Architecture", description: "", questions: ["Design X."] },
    ],
  },
  {
    id: "1a000000-0000-4000-8000-000000000002",
    stage_id: SCREEN,
    name: "Phone screen",
    duration_minutes: 30,
    instructions: "",
    default_interviewer_ids: [],
    competencies: [
      { id: "1c000000-0000-4000-8000-000000000002", name: "Motivation", description: "Why us", questions: [] },
    ],
  },
];

const run = (state: PlanEditorState, ...events: PlanEditorEvent[]) => events.reduce(planEditorReducer, state);
const keys = (state: PlanEditorState) => state.items.map((i) => i.name);

describe("interview plan editor reducer (IVT-013)", () => {
  it("loads a saved plan, clean", () => {
    const state = initialPlanState(SAVED);
    expect(keys(state)).toEqual(["System design", "Phone screen"]);
    expect(state.items[0].id).toBe(SAVED[0].id);
    expect(isPlanDirty(state)).toBe(false);
  });

  it("addItem adds a blank interview under the stage with one competency and the default length", () => {
    const state = run(initialPlanState([]), { type: "addItem", stageId: SCREEN });
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ stage_id: SCREEN, name: "", duration_minutes: PLAN_LIMITS.durationDefault });
    expect(state.items[0].competencies).toHaveLength(1);
    expect(isPlanDirty(state)).toBe(true);
  });

  it("addItem stops at the plan limit", () => {
    let state = initialPlanState([]);
    for (let i = 0; i < PLAN_LIMITS.items + 2; i++) state = run(state, { type: "addItem", stageId: SCREEN });
    expect(state.items).toHaveLength(PLAN_LIMITS.items);
  });

  it("gives every new item and competency a unique key", () => {
    const state = run(
      initialPlanState(SAVED),
      { type: "addItem", stageId: SCREEN },
      { type: "addItem", stageId: SCREEN },
    );
    const all = state.items.flatMap((i) => [i.key, ...i.competencies.map((c) => c.key)]);
    expect(new Set(all).size).toBe(all.length);
    const withComp = run(state, { type: "addCompetency", itemKey: state.items[2].key });
    const all2 = withComp.items.flatMap((i) => [i.key, ...i.competencies.map((c) => c.key)]);
    expect(new Set(all2).size).toBe(all2.length);
  });

  it("updateItem patches fields and dedupes and caps default interviewers", () => {
    const start = initialPlanState(SAVED);
    const key = start.items[0].key;
    const many = Array.from({ length: PANEL_MAX + 2 }, (_, i) => `c1000000-0000-4000-8000-00000000010${i}`);
    const state = run(
      start,
      { type: "updateItem", key, patch: { name: "Design", duration_minutes: 90 } },
      { type: "updateItem", key, patch: { default_interviewer_ids: [USER_2, USER_2, ...many] } },
    );
    expect(state.items[0]).toMatchObject({ name: "Design", duration_minutes: 90 });
    expect(state.items[0].default_interviewer_ids).toHaveLength(PANEL_MAX);
    expect(state.items[0].default_interviewer_ids[0]).toBe(USER_2);
  });

  it("removeItem drops it; an unknown key changes nothing", () => {
    const start = initialPlanState(SAVED);
    expect(run(start, { type: "removeItem", key: start.items[0].key }).items).toHaveLength(1);
    expect(run(start, { type: "updateItem", key: "nope", patch: { name: "x" } })).toBe(start);
  });

  it("moveItem reorders only among the same stage's items", () => {
    let state = run(initialPlanState(SAVED), { type: "addItem", stageId: ONSITE });
    const newKey = state.items[2].key;
    state = run(state, { type: "updateItem", key: newKey, patch: { name: "Coding" } });
    // Coding sits after Phone screen in the array, but moves up past System design only.
    state = run(state, { type: "moveItem", key: newKey, direction: -1 });
    expect(keys(state)).toEqual(["Coding", "Phone screen", "System design"]);
    // Already first in its stage.
    expect(run(state, { type: "moveItem", key: newKey, direction: -1 })).toBe(state);
  });

  it("adds, edits, moves and removes competencies, capped", () => {
    const start = initialPlanState(SAVED);
    const itemKey = start.items[0].key;
    let state = run(start, { type: "addCompetency", itemKey });
    const added = state.items[0].competencies[1].key;
    state = run(
      state,
      { type: "updateCompetency", itemKey, key: added, patch: { name: "Trade-offs", description: "Costs" } },
      { type: "moveCompetency", itemKey, key: added, direction: -1 },
    );
    expect(state.items[0].competencies.map((c) => c.name)).toEqual(["Trade-offs", "Architecture"]);
    state = run(state, { type: "removeCompetency", itemKey, key: added });
    expect(state.items[0].competencies.map((c) => c.name)).toEqual(["Architecture"]);

    for (let i = 0; i < PLAN_LIMITS.competenciesMax + 2; i++) state = run(state, { type: "addCompetency", itemKey });
    expect(state.items[0].competencies).toHaveLength(PLAN_LIMITS.competenciesMax);
  });

  it("adds, edits and removes questions, capped", () => {
    const start = initialPlanState(SAVED);
    const itemKey = start.items[0].key;
    const competencyKey = start.items[0].competencies[0].key;
    let state = run(
      start,
      { type: "addQuestion", itemKey, competencyKey },
      { type: "updateQuestion", itemKey, competencyKey, index: 1, text: "Scale it." },
    );
    expect(state.items[0].competencies[0].questions).toEqual(["Design X.", "Scale it."]);
    state = run(state, { type: "removeQuestion", itemKey, competencyKey, index: 0 });
    expect(state.items[0].competencies[0].questions).toEqual(["Scale it."]);
    for (let i = 0; i < PLAN_LIMITS.questions + 2; i++) state = run(state, { type: "addQuestion", itemKey, competencyKey });
    expect(state.items[0].competencies[0].questions).toHaveLength(PLAN_LIMITS.questions);
  });

  it("reset replaces the plan and is clean again", () => {
    const dirty = run(initialPlanState(SAVED), { type: "addItem", stageId: SCREEN });
    const state = run(dirty, { type: "reset", plan: [SAVED[1]] });
    expect(keys(state)).toEqual(["Phone screen"]);
    expect(isPlanDirty(state)).toBe(false);
  });

  it("applyDraft replaces the items with the AI draft, unsaved (IV-REQ-050)", () => {
    const draft = [
      {
        stage_id: SCREEN,
        name: "Recruiter screen",
        duration_minutes: 30,
        instructions: "Short and friendly.",
        competencies: [
          { name: "Motivation", description: "Why this job", questions: ["Why us?"] },
          { name: "Logistics", description: "", questions: [] },
        ],
      },
    ];
    const before = initialPlanState(SAVED);
    const state = run(before, { type: "applyDraft", items: draft });

    expect(keys(state)).toEqual(["Recruiter screen"]);
    expect(isPlanDirty(state)).toBe(true);
    expect(state.saved).toBe(before.saved);
    const [item] = state.items;
    // New rows: no ids, no default interviewers, fresh keys.
    expect(item.id).toBeUndefined();
    expect(item.default_interviewer_ids).toEqual([]);
    expect(item.competencies.every((c) => c.id === undefined)).toBe(true);
    const allKeys = [item.key, ...item.competencies.map((c) => c.key), ...before.items.map((i) => i.key)];
    expect(new Set(allKeys).size).toBe(allKeys.length);
    // A competency with no questions gets one blank field to type into, as addCompetency does.
    expect(item.competencies.map((c) => c.questions)).toEqual([["Why us?"], [""]]);
    expect(planInputSchema.safeParse(toPlanInput(state, [SCREEN, ONSITE])).success).toBe(true);
  });
});

describe("toPlanInput", () => {
  it("orders by the pipeline's stages, keeps ids, and passes the schema", () => {
    const input = toPlanInput(initialPlanState(SAVED), [SCREEN, ONSITE]);
    expect(input.map((i) => i.name)).toEqual(["Phone screen", "System design"]);
    expect(input[1]).toMatchObject({ id: SAVED[0].id, competencies: [{ id: SAVED[0].competencies[0].id }] });
    expect(planInputSchema.safeParse(input).success).toBe(true);
  });

  it("sends no id for new items and competencies", () => {
    const state = run(initialPlanState([]), { type: "addItem", stageId: SCREEN });
    const [item] = toPlanInput(state, [SCREEN]);
    expect(item).not.toHaveProperty("id");
    expect(item.competencies[0]).not.toHaveProperty("id");
  });
});
