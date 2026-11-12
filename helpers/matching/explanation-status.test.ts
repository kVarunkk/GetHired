import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { EXPLANATION_STATES, isExplanationReady, type ExplanationStatus } from "./explanation-status";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/** The states in the latest migration that sets the explanation_status check. */
function constraintStates(): string[] {
  const latest = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(MIGRATIONS, file), "utf8"))
    .filter((sql) => /check \(explanation_status in \(/.test(sql))
    .at(-1)!;
  const list = latest.match(/check \(explanation_status in \(([^)]*)\)\)/)![1];
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("explanation states (SMT-022, SM-ISS-003)", () => {
  it("lists the same states as the database's check constraint", () => {
    expect([...EXPLANATION_STATES].sort()).toEqual(constraintStates().sort());
  });

  it("has a running state", () => {
    expectTypeOf<"processing">().toMatchTypeOf<ExplanationStatus>();
    expect(EXPLANATION_STATES).toContain("processing");
  });

  it.each(EXPLANATION_STATES.filter((s) => s !== "completed"))("reads %s as not ready", (status) => {
    expect(isExplanationReady(status)).toBe(false);
  });

  it("reads completed as ready, and a missing row as not", () => {
    expect(isExplanationReady("completed")).toBe(true);
    expect(isExplanationReady(null)).toBe(false);
    expect(isExplanationReady(undefined)).toBe(false);
  });
});
