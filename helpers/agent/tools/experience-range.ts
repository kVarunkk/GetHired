/**
 * The experience filter of the agent's job searches, in the user's terms.
 *
 * The search keeps a job when its experience range overlaps the user's
 * (helpers/jobs/filterQueryBuilder.ts): `minExperience` drops jobs whose
 * range ends below it, `maxExperience` drops jobs that start above it. An
 * open-ended job ("7+ years") has no end, so `minExperience` alone never
 * drops it: only `maxExperience` keeps out jobs above the user's level.
 * The model kept setting only `minExperience` for the user's own years
 * (trace 0ca86f53, 2026-11-20: a 2-year profile, `minExperience: 1`, and a
 * 7+ years job shown as a match), so the tools take the user's years as
 * `experienceYears` and build the range here, and cap a min-only range by
 * the profile's years.
 */

/** Years above the user's own that a job may still ask for. */
export const EXPERIENCE_STRETCH_YEARS = 1;

/** Jobs ending more than this many years below the user's level are left out. */
export const EXPERIENCE_BELOW_YEARS = 3;

/**
 * A min-only range (a level the user asked for, e.g. senior) also leaves out
 * jobs starting more than this many years below it. Without it, "3+ years"
 * jobs passed `minExperience: 5`, since their range is open-ended (agent
 * chat review 2026-11-20, turn 4).
 */
export const EXPERIENCE_FLOOR_BELOW_YEARS = 1;

/** The lowest `experience_min` a min-only search keeps, or undefined for no floor. */
export function experienceFloor(filters: ExperienceFilters): number | undefined {
  if (filters.minExperience === undefined || filters.maxExperience !== undefined) return undefined;
  const floor = filters.minExperience - EXPERIENCE_FLOOR_BELOW_YEARS;
  return floor > 0 ? floor : undefined;
}

export type ExperienceFilters = {
  experienceYears?: number;
  minExperience?: number;
  maxExperience?: number;
};

/** The range of jobs open to someone with `years` of experience. */
export function userExperienceRange(years: number): { minExperience?: number; maxExperience: number } {
  const min = years - EXPERIENCE_BELOW_YEARS;
  return {
    ...(min > 0 ? { minExperience: min } : {}),
    maxExperience: years + EXPERIENCE_STRETCH_YEARS,
  };
}

/** Whether `resolveExperience` would use the profile's years, so the caller only loads them then. */
export const needsProfileYears = (filters: ExperienceFilters) =>
  filters.experienceYears === undefined &&
  filters.minExperience !== undefined &&
  filters.maxExperience === undefined;

/**
 * The filters with `experienceYears` turned into min/max (an explicit min or
 * max wins), and a min-only range capped at the profile's years when the
 * min is within them. A min above the profile's years is a level the user
 * asked for ("senior roles"), so it stays open-ended.
 */
export function resolveExperience<F extends ExperienceFilters>(
  filters: F,
  profileYears: number | null,
): Omit<F, "experienceYears"> {
  const { experienceYears, ...rest } = filters;
  const out: Omit<F, "experienceYears"> & ExperienceFilters = { ...rest };

  if (experienceYears !== undefined) {
    const range = userExperienceRange(experienceYears);
    if (out.minExperience === undefined && range.minExperience !== undefined) {
      out.minExperience = range.minExperience;
    }
    if (out.maxExperience === undefined) out.maxExperience = range.maxExperience;
    return out;
  }

  if (
    out.minExperience !== undefined &&
    out.maxExperience === undefined &&
    profileYears != null &&
    profileYears >= out.minExperience
  ) {
    out.maxExperience = Math.floor(profileYears) + EXPERIENCE_STRETCH_YEARS;
  }
  return out;
}
