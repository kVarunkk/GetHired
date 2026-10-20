import { describe, expect, it } from "vitest";
import { z } from "zod";
import { configSnapshotSchema, transcriptTurnSchema } from "@/helpers/interview/screening/schemas";
import { CASES, INJECTION_CASE_IDS, INJECTION_LINE } from "./transcripts";
import { buildTurns, snapshotOf, speechNoise } from "./variants";

// The eval data, checked without calling a model (the evals themselves run with `npm run eval:screening`).

describe("screening eval data (SI-TEST-040/041)", () => {
  it("has 20 cases with unique ids and every injection case present", () => {
    expect(CASES).toHaveLength(20);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(20);
    for (const id of INJECTION_CASE_IDS) expect(CASES.map((c) => c.id)).toContain(id);
  });

  it.each(CASES.map((c) => [c.id, c] as const))("%s is a valid snapshot and transcript in every variant", (_, c) => {
    expect(configSnapshotSchema.safeParse(snapshotOf(c)).success).toBe(true);
    for (const variant of ["original", "swapped", "noisy", "injected"] as const) {
      const turns = buildTurns(c, variant);
      expect(z.array(transcriptTurnSchema).safeParse(turns).success).toBe(true);
      expect(JSON.stringify(turns)).not.toMatch(/\{(name|they|them|their)\}/i);
      // Enough to count as a completed session (>= 3 answers).
      expect(turns.filter((t) => t.user.trim()).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("swaps the name and pronouns, and nothing else", () => {
    const c = CASES.find((x) => x.id === "backend-strong")!;
    const a = JSON.stringify(buildTurns(c, "original"));
    const b = JSON.stringify(buildTurns(c, "swapped"));
    expect(a).toContain("Priya");
    expect(b).toContain("Kwame");
    expect(b.replaceAll("Kwame", "Priya").replace(/\bhim\b/g, "her").replace(/\bHe\b/g, "She").replace(/\bhe\b/g, "she")).toBe(a);
  });

  it("adds speech noise deterministically and only to answers", () => {
    expect(speechNoise("Their SQL cache, it's fast. I was there.")).toBe("there sequel cash its fast i were um there");
    const c = CASES[0];
    const noisy = buildTurns(c, "noisy");
    expect(noisy[0].user).toBe("Hi, yes, I'm ready.");
    expect(noisy[1].user).toContain("um");
    expect(noisy[1].assistant).toBe(buildTurns(c, "original")[1].assistant);
    expect(buildTurns(c, "noisy")).toEqual(noisy);
  });

  it("puts the injection in a candidate answer", () => {
    const turns = buildTurns(CASES[1], "injected");
    expect(turns.filter((t) => t.user.includes(INJECTION_LINE))).toHaveLength(1);
  });
});
