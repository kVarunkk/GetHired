// Client-safe (IVT-072, D8): after a move into a stage with plan interviews,
// the board and the stage picker offer "Schedule <names>", which opens the
// application's schedule page on that interview. Nothing is sent
// automatically.

export type PromptItem = { id: string; name: string };
/** Plan interviews by the stage they belong to. */
export type StagePlanItems = Record<string, PromptItem[]>;

/** The schedule page's query parameter for the plan interview to start on. */
export const SCHEDULE_PARAM = "item";

export function planItemsByStage(plan: { id: string; name: string; stage_id: string }[]): StagePlanItems {
  const byStage: StagePlanItems = {};
  for (const item of plan) (byStage[item.stage_id] ??= []).push({ id: item.id, name: item.name });
  return byStage;
}

/** The schedule page under an application's Interviews section, optionally on a plan interview. */
export const schedulePath = (applicationId: string, planItemId?: string | null) =>
  `/company/applications/${applicationId}/interviews/schedule` +
  (planItemId ? `?${SCHEDULE_PARAM}=${encodeURIComponent(planItemId)}` : "");

/** The scheduler and the record form start on the first item: put the asked-for one there. */
export function withItemFirst<T extends { id: string }>(items: T[], id: string | null | undefined): { items: T[]; found: boolean } {
  const index = id ? items.findIndex((i) => i.id === id) : -1;
  if (index < 0) return { items, found: false };
  return { items: [items[index], ...items.slice(0, index), ...items.slice(index + 1)], found: true };
}
