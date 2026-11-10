import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";
import { REVIEW_STATES, reviewStatus } from "./review-status";

describe("reviewStatus", () => {
  it.each([
    // status, analysis_failed, expected
    ["completed", false, "completed"],
    ["completed", null, "completed"],
    ["completed", true, "failed"],
    ["draft", null, "draft"],
    ["draft", true, "failed"],
    ["processing", false, "processing"],
    ["processing", true, "failed"],
    ["failed", true, "failed"],
    ["failed", false, "failed"],
    [null, false, "completed"],
    [null, null, "completed"],
    [null, true, "failed"],
  ] as const)("status %s with analysis_failed %s reads %s", (status, failed, expected) => {
    expect(reviewStatus({ status, analysis_failed: failed })).toBe(expected);
  });

  it("an unknown stored status reads completed, so the union holds", () => {
    expect(reviewStatus({ status: "archived", analysis_failed: false })).toBe("completed");
  });

  it("lists the states the lifecycle_checks migration allows", () => {
    const migration = readSource("supabase/migrations/20261110160000_lifecycle_checks.sql");
    const check = /resume_reviews_status_check\s+check \(status in \(([^)]*)\)\)/.exec(migration);
    const allowed = check![1].split(",").map((state) => state.trim().replace(/'/g, ""));
    expect([...REVIEW_STATES].sort()).toEqual(allowed.sort());
  });
});

// SM-REQ-009: reviewStatus is the one place that combines the two columns.
// Selecting the column to hand the row over is fine; reading it isn't.
const ALLOWED: Record<string, string> = {
  "helpers/resume-review/review-status.ts": "the one reader",
};

const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const readsAnalysisFailed = (source: string) =>
  /(\.|\?\.)analysis_failed\b|\[\s*["']analysis_failed["']\s*\]|\{[^}:]*\banalysis_failed\b[^}:]*\}\s*(=|\))/.test(source);

describe("readers of resume_reviews.analysis_failed", () => {
  it("only reviewStatus reads it", () => {
    const readers = sourceFiles(["app", "components", "helpers", "lib", "utils", "hooks"])
      .filter((file) => file !== "utils/types/database.types.ts")
      .filter((file) => readsAnalysisFailed(code(readSource(file))));

    expect(readers.filter((file) => !(file in ALLOWED))).toEqual([]);
    expect(Object.keys(ALLOWED).filter((file) => !readers.includes(file))).toEqual([]);
  });
});
