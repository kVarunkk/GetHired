/** Bounds of user_info.weekly_application_goal (the column's check constraint). */
export const WEEKLY_GOAL_MIN = 1;
export const WEEKLY_GOAL_MAX = 100;

/** One-tap choices offered when setting a goal. */
export const WEEKLY_GOAL_PRESETS = [3, 5, 10] as const;

export function isValidWeeklyGoal(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= WEEKLY_GOAL_MIN && (value as number) <= WEEKLY_GOAL_MAX;
}
