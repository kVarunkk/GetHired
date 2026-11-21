/**
 * What the agent's job searches do when every filter together finds nothing
 * (agent chat review 2026-11-14/15, problem 3). Left to itself, the model
 * dropped every filter and showed the newest jobs of any kind. The tools
 * instead relax filters in a fixed order and stop at the first step that
 * finds jobs. They never drop the role keywords, the location or the
 * company: those change what the user asked for, so the model asks first.
 *
 * Agent chat review 2026-11-20: the steps add up, so a search blocked only
 * by the visa filter also lost its salary and the user was told so
 * (`narrowWidened` puts back what wasn't needed); a fresher's range grew by
 * two years (`experienceWidenYears`); and a search that found one or two
 * jobs was never widened at all (`FEW_RESULTS`).
 */

/** The searchJobs filters, as the tool's input names them. */
export type WidenableFilters = {
  keywords?: string[];
  locations?: string[];
  jobTypes?: string[];
  minSalary?: number;
  salaryCurrency?: string;
  minExperience?: number;
  maxExperience?: number;
  visaRequirements?: string[];
  platforms?: string[];
  companies?: string[];
  postedWithinDays?: number;
};

/** What a step relaxed, as the result's `widened.dropped` names it. */
export type WidenStepName =
  | "postedWithinDays"
  | "minSalary"
  | "visaRequirements"
  | "platforms"
  | "jobTypes"
  | "experience";

/** Years added to each end of the experience range by the last step. */
export const EXPERIENCE_WIDEN_YEARS = 2;

/** A range ending at or below this many years is a junior's: it widens by one year only. */
export const JUNIOR_MAX_YEARS = 2;

/**
 * A first page with fewer jobs than this and no next page is widened too,
 * and the extra jobs are returned apart from the exact matches.
 */
export const FEW_RESULTS = 3;

/** How many years the experience step widens a range by. */
export const experienceWidenYears = (filters: WidenableFilters) =>
  filters.maxExperience !== undefined && filters.maxExperience <= JUNIOR_MAX_YEARS
    ? 1
    : EXPERIENCE_WIDEN_YEARS;

/** The input keys each name stands for, so a dropped filter can be put back. */
const FILTER_KEYS: Record<WidenStepName, (keyof WidenableFilters)[]> = {
  postedWithinDays: ["postedWithinDays"],
  minSalary: ["minSalary", "salaryCurrency"],
  visaRequirements: ["visaRequirements"],
  platforms: ["platforms"],
  jobTypes: ["jobTypes"],
  experience: ["minExperience", "maxExperience"],
};

type WidenStep = {
  /** The names it relaxes, reported only when the filter was set. */
  names: WidenStepName[];
  apply: (filters: WidenableFilters) => WidenableFilters;
};

const without = (filters: WidenableFilters, ...keys: (keyof WidenableFilters)[]) => {
  const next = { ...filters };
  for (const key of keys) delete next[key];
  return next;
};

const isSet = (filters: WidenableFilters, name: WidenStepName) => {
  if (name === "experience") {
    return filters.minExperience !== undefined || filters.maxExperience !== undefined;
  }
  const value = filters[name];
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
};

/** In order, least important to the user first. Keywords, locations and companies are never here. */
export const WIDEN_STEPS: readonly WidenStep[] = [
  { names: ["postedWithinDays"], apply: (f) => without(f, "postedWithinDays") },
  { names: ["minSalary"], apply: (f) => without(f, "minSalary", "salaryCurrency") },
  {
    names: ["visaRequirements", "platforms"],
    apply: (f) => without(f, "visaRequirements", "platforms"),
  },
  { names: ["jobTypes"], apply: (f) => without(f, "jobTypes") },
  {
    // Widened, not removed: a fresher shown 4+ years roles is the problem
    // this module exists for.
    names: ["experience"],
    apply: (f) => {
      const years = experienceWidenYears(f);
      const next = without(f, "minExperience", "maxExperience");
      if (f.minExperience !== undefined && f.minExperience - years > 0) {
        next.minExperience = f.minExperience - years;
      }
      if (f.maxExperience !== undefined) {
        next.maxExperience = f.maxExperience + years;
      }
      return next;
    },
  },
];

/** Whether a search names a role or a company, so widening it stays on topic. */
export const hasRoleOrCompany = (filters: WidenableFilters) =>
  (filters.keywords?.length ?? 0) > 0 || (filters.companies?.length ?? 0) > 0;

export type WidenOptions = {
  /**
   * The user named a level ("fresher roles", "senior jobs"), so the
   * experience range is what they asked for and is never widened.
   */
  keepExperience?: boolean;
};

/**
 * The searches to try after an empty one, each with every name relaxed so
 * far. Steps whose filters weren't set are skipped, so they cost no query.
 * Empty when the search has no keywords or company: relaxing it would find
 * unrelated jobs.
 */
export function widenedSearches<F extends WidenableFilters>(
  filters: F,
  { keepExperience = false }: WidenOptions = {},
): { filters: F; dropped: WidenStepName[] }[] {
  if (!hasRoleOrCompany(filters)) return [];

  // Every step only removes or narrows a filter's value, so the input's type holds.
  const searches: { filters: F; dropped: WidenStepName[] }[] = [];
  let current: F = filters;
  let dropped: WidenStepName[] = [];
  for (const step of WIDEN_STEPS) {
    if (keepExperience && step.names.includes("experience")) continue;
    const relaxed = step.names.filter((name) => isSet(current, name));
    if (relaxed.length === 0) continue;
    current = step.apply(current) as F;
    dropped = [...dropped, ...relaxed];
    searches.push({ filters: current, dropped });
  }
  return searches;
}

/** `current` with `name`'s filters as they were in `original`. */
export function restoreFilter<F extends WidenableFilters>(current: F, original: F, name: WidenStepName): F {
  const next = { ...current };
  for (const key of FILTER_KEYS[name]) {
    if (original[key] === undefined) delete next[key];
    else (next as WidenableFilters)[key] = original[key] as never;
  }
  return next;
}

/**
 * Puts back each dropped filter that the search doesn't need, most
 * important first (the reverse of the widening order), so only the filters
 * that really blocked it stay dropped. `run` searches and returns the
 * result when it found what the caller wants, else null. Costs one search
 * per dropped name.
 */
export async function narrowWidened<F extends WidenableFilters, R>(
  original: F,
  widened: { filters: F; dropped: WidenStepName[]; result: R },
  run: (filters: F) => Promise<R | null>,
): Promise<{ filters: F; dropped: WidenStepName[]; result: R }> {
  let { filters, dropped, result } = widened;
  for (const name of [...widened.dropped].reverse()) {
    const candidate = restoreFilter(filters, original, name);
    const found = await run(candidate);
    if (found === null) continue;
    filters = candidate;
    dropped = dropped.filter((d) => d !== name);
    result = found;
  }
  return { filters, dropped, result };
}

const experienceRange = (filters: WidenableFilters) => {
  const { minExperience: min, maxExperience: max } = filters;
  if (min !== undefined && max !== undefined) return `${min}–${max} years`;
  if (max !== undefined) return `up to ${max} years`;
  if (min !== undefined) return `${min}+ years`;
  return "any";
};

const DROPPED_LABELS: Record<WidenStepName, string> = {
  postedWithinDays: "the posting date",
  minSalary: "the minimum salary",
  visaRequirements: "the visa requirement",
  platforms: "the job sources",
  jobTypes: "the job type",
  experience: "the experience range",
};

/** The relaxed filters in words; with the search that ran, the experience range says what it became. */
export const describeDropped = (dropped: WidenStepName[], searchedWith?: WidenableFilters) =>
  dropped
    .map((name) =>
      name === "experience" && searchedWith
        ? `${DROPPED_LABELS.experience} (now ${experienceRange(searchedWith)})`
        : DROPPED_LABELS[name],
    )
    .join(", ");

/** For a result the tool widened: what the model tells the user. */
export const widenedMessage = (dropped: WidenStepName[], searchedWith?: WidenableFilters) =>
  `No jobs matched every filter. These jobs match after relaxing only ${describeDropped(dropped, searchedWith)}; every other filter still applies. Tell the user exactly what you relaxed before listing them.`;

/** For a search that found a few jobs, and more after relaxing some filters. */
export const fewResultsMessage = (
  exactCount: number,
  dropped: WidenStepName[],
  searchedWith?: WidenableFilters,
) =>
  `Only ${exactCount} ${exactCount === 1 ? "job matches" : "jobs match"} every filter (jobs). The jobs in moreAfterRelaxing.jobs match after relaxing only ${describeDropped(dropped, searchedWith)}. List the exact matches first, then the others under a note saying what they don't meet. Later pages of those need moreAfterRelaxing.searchedWith and its nextCursor.`;

/** For a search that still found nothing: what the model does next. */
export const stillEmptyMessage = (dropped: WidenStepName[]) =>
  `${
    dropped.length > 0
      ? `No jobs found, even after relaxing ${describeDropped(dropped)}.`
      : "No jobs found."
  } Don't search again without job-title keywords. Tell the user, and offer related job titles or other locations. Ask before searching another location or role.`;
