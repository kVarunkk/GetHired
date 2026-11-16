// The interview plan editor's state (IVT-013, IV-REQ-001–004). Pure, so every
// event is tested in interview-plan-machine.test.ts. Saving, copying and
// drafting stay in InterviewPlanEditor, which dispatches their results here.
//
// Each item and competency has a client `key` for React and the events; `id`
// is the saved row's, sent back on save so competency ids stay stable
// (IV-REQ-003).

import { PANEL_MAX, PLAN_LIMITS } from "@/helpers/interviews/config";
import type { PlanDraftItem, PlanItemInput } from "@/helpers/interviews/plan-schema";

export type DraftCompetency = {
  key: string;
  id?: string;
  name: string;
  description: string;
  questions: string[];
};

export type DraftItem = {
  key: string;
  id?: string;
  stage_id: string;
  name: string;
  duration_minutes: number;
  instructions: string;
  default_interviewer_ids: string[];
  competencies: DraftCompetency[];
};

/** A saved plan item, as `loadInterviewPlan` returns it. */
export type SavedPlanItem = {
  id: string;
  stage_id: string;
  name: string;
  duration_minutes: number;
  instructions: string;
  default_interviewer_ids: string[];
  competencies: { id: string; name: string; description: string; questions: string[] }[];
};

export type PlanEditorState = {
  items: DraftItem[];
  /** What was last saved or loaded, to tell whether there are changes. */
  saved: DraftItem[];
  seq: number;
};

type ItemPatch = Partial<Pick<DraftItem, "name" | "duration_minutes" | "instructions" | "default_interviewer_ids" | "stage_id">>;
type CompetencyPatch = Partial<Pick<DraftCompetency, "name" | "description">>;

export type PlanEditorEvent =
  | { type: "reset"; plan: SavedPlanItem[] }
  /** An AI draft (IV-REQ-050) replaces the items; `saved` stays, so it's unsaved until Save. */
  | { type: "applyDraft"; items: PlanDraftItem[] }
  | { type: "addItem"; stageId: string }
  | { type: "updateItem"; key: string; patch: ItemPatch }
  | { type: "removeItem"; key: string }
  | { type: "moveItem"; key: string; direction: -1 | 1 }
  | { type: "addCompetency"; itemKey: string }
  | { type: "updateCompetency"; itemKey: string; key: string; patch: CompetencyPatch }
  | { type: "removeCompetency"; itemKey: string; key: string }
  | { type: "moveCompetency"; itemKey: string; key: string; direction: -1 | 1 }
  | { type: "addQuestion"; itemKey: string; competencyKey: string }
  | { type: "updateQuestion"; itemKey: string; competencyKey: string; index: number; text: string }
  | { type: "removeQuestion"; itemKey: string; competencyKey: string; index: number };

function fromSaved(plan: SavedPlanItem[], seq: number): { items: DraftItem[]; seq: number } {
  let n = seq;
  const items = plan.map((item) => {
    n += 1;
    const itemKey = `i${n}`;
    return {
      key: itemKey,
      id: item.id,
      stage_id: item.stage_id,
      name: item.name,
      duration_minutes: item.duration_minutes,
      instructions: item.instructions ?? "",
      default_interviewer_ids: [...(item.default_interviewer_ids ?? [])],
      competencies: item.competencies.map((c) => {
        n += 1;
        return {
          key: `c${n}`,
          id: c.id,
          name: c.name,
          description: c.description ?? "",
          questions: [...(c.questions ?? [])],
        };
      }),
    };
  });
  return { items, seq: n };
}

export function initialPlanState(plan: SavedPlanItem[]): PlanEditorState {
  const { items, seq } = fromSaved(plan, 0);
  return { items, saved: items, seq };
}

const move = <T>(list: T[], from: number, to: number): T[] => {
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
};

function mapItem(state: PlanEditorState, key: string, fn: (item: DraftItem) => DraftItem): PlanEditorState {
  if (!state.items.some((i) => i.key === key)) return state;
  return { ...state, items: state.items.map((i) => (i.key === key ? fn(i) : i)) };
}

function mapCompetency(
  item: DraftItem,
  key: string,
  fn: (c: DraftCompetency) => DraftCompetency,
): DraftItem {
  return { ...item, competencies: item.competencies.map((c) => (c.key === key ? fn(c) : c)) };
}

export function planEditorReducer(state: PlanEditorState, event: PlanEditorEvent): PlanEditorState {
  switch (event.type) {
    case "reset": {
      const { items, seq } = fromSaved(event.plan, state.seq);
      return { items, saved: items, seq };
    }
    case "applyDraft": {
      let n = state.seq;
      const items: DraftItem[] = event.items.slice(0, PLAN_LIMITS.items).map((item) => {
        n += 1;
        const itemKey = `i${n}`;
        return {
          key: itemKey,
          stage_id: item.stage_id,
          name: item.name,
          duration_minutes: item.duration_minutes,
          instructions: item.instructions,
          default_interviewer_ids: [],
          competencies: item.competencies.map((c) => {
            n += 1;
            return {
              key: `c${n}`,
              name: c.name,
              description: c.description,
              questions: c.questions.length > 0 ? [...c.questions] : [""],
            };
          }),
        };
      });
      return { ...state, items, seq: n };
    }
    case "addItem": {
      if (state.items.length >= PLAN_LIMITS.items) return state;
      const seq = state.seq + 2;
      const item: DraftItem = {
        key: `i${seq - 1}`,
        stage_id: event.stageId,
        name: "",
        duration_minutes: PLAN_LIMITS.durationDefault,
        instructions: "",
        default_interviewer_ids: [],
        competencies: [{ key: `c${seq}`, name: "", description: "", questions: [""] }],
      };
      return { ...state, seq, items: [...state.items, item] };
    }
    case "updateItem":
      return mapItem(state, event.key, (item) => {
        const patch = { ...event.patch };
        if (patch.default_interviewer_ids) {
          patch.default_interviewer_ids = [...new Set(patch.default_interviewer_ids)].slice(0, PANEL_MAX);
        }
        return { ...item, ...patch };
      });
    case "removeItem":
      return { ...state, items: state.items.filter((i) => i.key !== event.key) };
    case "moveItem": {
      // Within the item's stage: swap with the neighbouring item of the same stage.
      const index = state.items.findIndex((i) => i.key === event.key);
      if (index < 0) return state;
      const stage = state.items[index].stage_id;
      const sameStage = state.items
        .map((item, i) => ({ item, i }))
        .filter(({ item }) => item.stage_id === stage)
        .map(({ i }) => i);
      const at = sameStage.indexOf(index);
      const target = sameStage[at + event.direction];
      if (target === undefined) return state;
      const items = [...state.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...state, items };
    }
    case "addCompetency": {
      const item = state.items.find((i) => i.key === event.itemKey);
      if (!item || item.competencies.length >= PLAN_LIMITS.competenciesMax) return state;
      const seq = state.seq + 1;
      return {
        ...mapItem(state, event.itemKey, (i) => ({
          ...i,
          competencies: [...i.competencies, { key: `c${seq}`, name: "", description: "", questions: [""] }],
        })),
        seq,
      };
    }
    case "updateCompetency":
      return mapItem(state, event.itemKey, (item) =>
        mapCompetency(item, event.key, (c) => ({ ...c, ...event.patch })),
      );
    case "removeCompetency":
      return mapItem(state, event.itemKey, (item) => ({
        ...item,
        competencies: item.competencies.filter((c) => c.key !== event.key),
      }));
    case "moveCompetency":
      return mapItem(state, event.itemKey, (item) => {
        const index = item.competencies.findIndex((c) => c.key === event.key);
        return { ...item, competencies: move(item.competencies, index, index + event.direction) };
      });
    case "addQuestion":
      return mapItem(state, event.itemKey, (item) =>
        mapCompetency(item, event.competencyKey, (c) =>
          c.questions.length >= PLAN_LIMITS.questions ? c : { ...c, questions: [...c.questions, ""] },
        ),
      );
    case "updateQuestion":
      return mapItem(state, event.itemKey, (item) =>
        mapCompetency(item, event.competencyKey, (c) => ({
          ...c,
          questions: c.questions.map((q, i) => (i === event.index ? event.text : q)),
        })),
      );
    case "removeQuestion":
      return mapItem(state, event.itemKey, (item) =>
        mapCompetency(item, event.competencyKey, (c) => ({
          ...c,
          questions: c.questions.filter((_, i) => i !== event.index),
        })),
      );
  }
}

/**
 * The items in save order: by their stage's position in the pipeline, keeping
 * their order inside a stage. Items whose stage isn't in `stageOrder` go last.
 */
export function orderedItems(state: PlanEditorState, stageOrder: string[]): DraftItem[] {
  const rank = (stageId: string) => {
    const i = stageOrder.indexOf(stageId);
    return i < 0 ? stageOrder.length : i;
  };
  return state.items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.stage_id) - rank(b.item.stage_id) || a.i - b.i)
    .map(({ item }) => item);
}

/** What Save sends, in `orderedItems` order. Validation is the action's (`planInputSchema`). */
export function toPlanInput(state: PlanEditorState, stageOrder: string[]): PlanItemInput[] {
  return orderedItems(state, stageOrder).map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    stage_id: item.stage_id,
    name: item.name,
    duration_minutes: item.duration_minutes,
    instructions: item.instructions,
    default_interviewer_ids: item.default_interviewer_ids,
    competencies: item.competencies.map((c) => ({
      ...(c.id ? { id: c.id } : {}),
      name: c.name,
      description: c.description,
      questions: c.questions,
    })),
  }));
}

// Keys are client-only, so they don't count as a change.
const strip = (items: DraftItem[]) =>
  JSON.stringify(items, (field, value) => (field === "key" ? undefined : value));

/** Whether there are changes since the last load or save. */
export const isPlanDirty = (state: PlanEditorState) => strip(state.items) !== strip(state.saved);
