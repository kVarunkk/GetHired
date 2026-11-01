// The Stage column (BI-REQ-015a): its distinct values, each matched to one of
// the company's stages. Client-safe.

import type { MappedRow } from "./map-columns";

/** Their value → a stage id, or null for the import's destination stage. */
export type StageChoices = Record<string, string | null>;

/** The Stage column's distinct values, trimmed, in first-seen order. Case variants count once. */
export function stageValues(rows: readonly MappedRow[]): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = row.stage?.trim();
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()];
}

/**
 * Preselects each value: the saved choice when it's still an open stage,
 * else the stage with the same name (case-insensitive, trimmed), else the
 * destination stage.
 */
export function matchStages(
  values: readonly string[],
  stages: readonly { id: string; name: string }[],
  saved: Record<string, string> = {},
): StageChoices {
  const ids = new Set(stages.map((s) => s.id));
  const byName = new Map(stages.map((s) => [s.name.trim().toLowerCase(), s.id]));
  const savedByKey = new Map(Object.entries(saved).map(([k, v]) => [k.trim().toLowerCase(), v]));
  return Object.fromEntries(
    values.map((value) => {
      const key = value.trim().toLowerCase();
      const fromSaved = savedByKey.get(key);
      return [value, fromSaved && ids.has(fromSaved) ? fromSaved : (byName.get(key) ?? null)];
    }),
  );
}

/** What the confirm action takes: only the values that don't go to the destination stage. */
export function stageMapOf(choices: StageChoices): Record<string, string> | undefined {
  const entries = Object.entries(choices).filter((e): e is [string, string] => e[1] !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
