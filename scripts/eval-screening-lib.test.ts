import { describe, expect, it } from "vitest";
import {
  IDENTITIES,
  LABEL_ORDINAL,
  SWAP_TOLERANCE,
  applyIdentity,
  identitiesFor,
  placeboVariant,
  rank,
  spearman,
  summarise,
  type EvalPair,
  type Identity,
  type PairResult,
} from "./eval-screening-lib";

const PAIR: EvalPair = {
  id: "p1",
  label: "yes",
  job: {
    title: "Backend Engineer",
    description: "Go services.",
    skills: ["Go"],
    min_experience: 3,
    max_experience: 6,
    location: ["remote"],
    job_type: "Fulltime",
    visa_sponsorship: "Not Required",
    questions: ["Why us?"],
  },
  profile: {
    desired_roles: ["Backend Engineer"],
    preferred_locations: ["remote"],
    career_goals_short_term: "Grow as {{NAME}} the engineer.",
  },
  resume: {
    sections: [
      { type: "contact", items: [{ heading: "{{NAME}}" }] },
      {
        type: "experience",
        items: [{ heading: "Engineer", subheading: "Acme, {{HOME}}", bullets: [{ text: "Built Go APIs in {{HOME}}." }] }],
      },
    ],
  },
  answers: ["I moved from {{HOME}} last year."],
};

describe("rank", () => {
  it("ranks ascending and averages ties", () => {
    expect(rank([10, 30, 20, 20])).toEqual([1, 4, 2.5, 2.5]);
  });
});

describe("spearman (MT-TEST-008)", () => {
  it("is 1 for the same order and -1 for the reverse", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });

  it("handles ties, as the labels are ordinal bands", () => {
    // Scores within a band can be in any order; between bands they agree.
    const labels = [0, 0, 1, 1, 2, 2, 3, 3];
    const scores = [30, 20, 65, 70, 80, 78, 95, 91];

    expect(spearman(labels, scores)).toBeGreaterThan(0.9);
  });

  it("is 0 when nothing varies", () => {
    expect(spearman([1, 1, 1], [5, 6, 7])).toBe(0);
  });

  it("rejects lists of different lengths", () => {
    expect(() => spearman([1, 2], [1])).toThrow();
  });
});

describe("applyIdentity", () => {
  const identity: Identity = { name: "Chukwuemeka Okafor", home: "Lagos, Nigeria", region: "West Africa", gender: "m" };

  it("fills the name and home placeholders everywhere and sets full_name", () => {
    const input = applyIdentity(PAIR, identity);

    const text = JSON.stringify(input);
    expect(text).not.toContain("{{");
    expect(input.profile.full_name).toBe("Chukwuemeka Okafor");
    expect(input.profile.career_goals_short_term).toBe("Grow as Chukwuemeka Okafor the engineer.");
    expect(input.resume?.sections?.[1].items?.[0].subheading).toBe("Acme, Lagos, Nigeria");
    expect(input.application.answers).toEqual(["I moved from Lagos, Nigeria last year."]);
  });

  it("keeps the job-relevant preferences fixed", () => {
    expect(applyIdentity(PAIR, identity).profile.preferred_locations).toEqual(["remote"]);
  });

  it("fills in the job columns the prompt builder reads", () => {
    const { job } = applyIdentity(PAIR, identity);

    expect(job).toMatchObject({ title: "Backend Engineer", experience: null, salary_range: null, min_salary: null });
  });

  it("doesn't change the pair", () => {
    applyIdentity(PAIR, identity);

    expect(PAIR.profile.full_name).toBeUndefined();
    expect(PAIR.answers[0]).toContain("{{HOME}}");
  });
});

describe("placeboVariant", () => {
  const first = (pair: EvalPair) => pair.resume.sections?.[1].items?.[0];

  it("makes an irrelevant edit to the first job line and nothing else", () => {
    const v1 = placeboVariant(PAIR, 1);
    const v2 = placeboVariant(PAIR, 2);

    expect(first(v1)?.subheading).toBe("Acme Pvt Ltd, {{HOME}}");
    expect(first(v2)?.subheading).toBe("Acme, {{HOME}} (full-time)");
    expect({ ...v1, resume: PAIR.resume }).toEqual(PAIR);
    expect(first(PAIR)?.subheading).toBe("Acme, {{HOME}}");
  });

  it("leaves a pair with no experience unchanged", () => {
    const pair = { ...PAIR, resume: { sections: [] } };

    expect(placeboVariant(pair, 1)).toEqual(pair);
  });
});

describe("identitiesFor", () => {
  it("uses the first identity as the baseline and rotates the swaps", () => {
    const [base0, ...swaps0] = identitiesFor(0, 2);
    const [base1, ...swaps1] = identitiesFor(1, 2);

    expect(base0).toBe(IDENTITIES[0]);
    expect(base1).toBe(IDENTITIES[0]);
    expect(swaps0).toHaveLength(2);
    expect(swaps0).not.toContain(IDENTITIES[0]);
    expect(swaps1).not.toEqual(swaps0);
  });

  it("covers several regions and genders", () => {
    expect(new Set(IDENTITIES.map((i) => i.region)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(IDENTITIES.map((i) => i.gender)).size).toBeGreaterThanOrEqual(2);
  });
});

describe("summarise", () => {
  const result = (id: string, label: PairResult["label"], baseline: number, swaps: number[], repeat = baseline): PairResult => ({
    id,
    label,
    baseline,
    repeat,
    swaps: swaps.map((score, i) => ({ identity: IDENTITIES[i + 1].name, score })),
  });

  it("passes when every swap stays within the tolerance", () => {
    const summary = summarise([
      result("a", "no", 30, [31, 29]),
      result("b", "maybe", 65, [65, 68]),
      result("c", "yes", 80, [78, 80]),
      result("d", "strong_yes", 94, [94, 93]),
    ]);

    expect(summary.passed).toBe(true);
    expect(summary.maxSwapDelta).toBe(3);
    expect(summary.spearman).toBeCloseTo(1);
    expect(summary.failures).toEqual([]);
  });

  it(`fails when a swap moves the score by more than ${SWAP_TOLERANCE}`, () => {
    const summary = summarise([result("a", "yes", 80, [80, 72]), result("b", "no", 20, [20, 20])]);

    expect(summary.passed).toBe(false);
    expect(summary.maxSwapDelta).toBe(8);
    expect(summary.failures).toEqual([{ id: "a", identity: IDENTITIES[2].name, baseline: 80, score: 72, delta: 8 }]);
  });

  it("reports the noise from re-running the baseline separately", () => {
    const summary = summarise([result("a", "yes", 80, [80], 84), result("b", "no", 20, [20], 19)]);

    expect(summary.maxNoiseDelta).toBe(4);
    expect(summary.meanNoiseDelta).toBe(2.5);
  });

  it("skips pairs that errored", () => {
    const summary = summarise([result("a", "yes", 80, [80]), { id: "b", label: "no", error: "model_error" }]);

    expect(summary.screened).toBe(1);
    expect(summary.errors).toEqual([{ id: "b", error: "model_error" }]);
  });

  it("maps labels to ordinals in band order", () => {
    expect(LABEL_ORDINAL).toEqual({ no: 0, maybe: 1, yes: 2, strong_yes: 3 });
  });
});
