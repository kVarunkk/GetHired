import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { POOL_MATCH_CEILING, POOL_MATCH_FLOOR, POOL_MATCH_MIN_SIMILARITY } from "@/helpers/matching/config";
import { POOL_MATCH_LABEL, poolMatchScore } from "./pool-match";

describe("poolMatchScore (CPT-051, CP-REQ-051)", () => {
  it("maps the floor to 0 and the ceiling to 100", () => {
    expect(poolMatchScore(POOL_MATCH_FLOOR)).toBe(0);
    expect(poolMatchScore(POOL_MATCH_CEILING)).toBe(100);
    expect(poolMatchScore((POOL_MATCH_FLOOR + POOL_MATCH_CEILING) / 2)).toBe(50);
  });

  it("clamps and rounds", () => {
    expect(poolMatchScore(0)).toBe(0);
    expect(poolMatchScore(-1)).toBe(0);
    expect(poolMatchScore(1)).toBe(100);
    expect(Number.isInteger(poolMatchScore(0.6123))).toBe(true);
  });

  it("never goes down as the similarity goes up", () => {
    let last = -1;
    for (let s = 0; s <= 1; s += 0.01) {
      const score = poolMatchScore(s);
      expect(score).toBeGreaterThanOrEqual(last);
      last = score;
    }
  });

  it("is labelled Similarity, not Fit", () => {
    expect(POOL_MATCH_LABEL).toBe("Similarity");
  });

  it("uses the RPC's default threshold", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const fn of ["match_company_candidates", "match_jobs_for_company_candidate"]) {
      // The last definition wins. Anchored on `create`, and kept inside one
      // statement, so a later `revoke ... ${fn}(...)` can't run on into
      // another function's `returns`.
      const defs = [
        ...sql.matchAll(new RegExp(`create or replace function public\\.${fn}\\(([^;]*?)\\)\\s*returns`, "g")),
      ];
      expect(defs.length, fn).toBeGreaterThan(0);
      const args = defs[defs.length - 1][1];
      expect(args.match(/p_min_similarity real default ([\d.]+)/)?.[1], fn).toBe(String(POOL_MATCH_MIN_SIMILARITY));
    }
  });
});
