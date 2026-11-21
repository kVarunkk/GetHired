import { describe, expect, it } from "vitest";
import { experienceFloor, needsProfileYears, resolveExperience, userExperienceRange } from "./experience-range";

describe("userExperienceRange", () => {
  it("caps a junior at one year above their own, with no floor", () => {
    expect(userExperienceRange(2)).toEqual({ maxExperience: 3 });
    expect(userExperienceRange(0)).toEqual({ maxExperience: 1 });
  });

  it("leaves out jobs far below a senior's level", () => {
    expect(userExperienceRange(8)).toEqual({ minExperience: 5, maxExperience: 9 });
  });
});

describe("resolveExperience", () => {
  it("turns experienceYears into the range", () => {
    expect(resolveExperience({ keywords: ["backend"], experienceYears: 2 }, null)).toEqual({
      keywords: ["backend"],
      maxExperience: 3,
    });
  });

  it("keeps an explicit min or max over experienceYears", () => {
    expect(resolveExperience({ experienceYears: 8, maxExperience: 12 }, null)).toEqual({
      minExperience: 5,
      maxExperience: 12,
    });
  });

  // Trace 0ca86f53 (2026-11-20): a 2-year profile searched with minExperience 1
  // and got a 7+ years job.
  it("caps a min-only range at the profile's years", () => {
    expect(resolveExperience({ minExperience: 1 }, 2)).toEqual({ minExperience: 1, maxExperience: 3 });
  });

  it("leaves a min above the profile's years open-ended, as a level the user asked for", () => {
    expect(resolveExperience({ minExperience: 5 }, 2)).toEqual({ minExperience: 5 });
  });

  it("leaves a min-only range alone without profile years", () => {
    expect(resolveExperience({ minExperience: 1 }, null)).toEqual({ minExperience: 1 });
  });

  it("leaves a full range alone", () => {
    expect(resolveExperience({ minExperience: 2, maxExperience: 5 }, 3)).toEqual({
      minExperience: 2,
      maxExperience: 5,
    });
  });
});

describe("needsProfileYears", () => {
  it("is true only for a min-only range", () => {
    expect(needsProfileYears({ minExperience: 1 })).toBe(true);
    expect(needsProfileYears({ minExperience: 1, maxExperience: 3 })).toBe(false);
    expect(needsProfileYears({ minExperience: 1, experienceYears: 2 })).toBe(false);
    expect(needsProfileYears({})).toBe(false);
  });
});

describe("experienceFloor", () => {
  it("sets a floor one year below a min-only range", () => {
    expect(experienceFloor({ minExperience: 5 })).toBe(4);
  });

  it("has none with a max, without a min, or when it would be 0", () => {
    expect(experienceFloor({ minExperience: 5, maxExperience: 8 })).toBeUndefined();
    expect(experienceFloor({ maxExperience: 2 })).toBeUndefined();
    expect(experienceFloor({ minExperience: 1 })).toBeUndefined();
  });
});
