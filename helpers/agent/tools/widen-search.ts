/**
 * What the agent's job searches do when every filter together finds nothing
 * (agent chat review 2026-11-14/15, problem 3). Left to itself, the model
 * dropped every filter and showed the newest jobs of any kind. The tools
 * instead relax filters in a fixed order and stop at the first step that
 * finds jobs. They never drop the role keywords, the location or the
 * company: those change what the user asked for, so the model asks first.
 */

/** The searchJobs filters, as the tool's input names them. */
export type WidenableFilters = {
  keywords?: string[];
  locations?: string[];
  jobTypes?: string[];
  minSalary?: number;
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
  { names: ["minSalary"], apply: (f) => without(f, "minSalary") },
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
      const next = without(f, "minExperience", "maxExperience");
      if (f.minExperience !== undefined && f.minExperience - EXPERIENCE_WIDEN_YEARS > 0) {
        next.minExperience = f.minExperience - EXPERIENCE_WIDEN_YEARS;
      }
      if (f.maxExperience !== undefined) {
        next.maxExperience = f.maxExperience + EXPERIENCE_WIDEN_YEARS;
      }
      return next;
    },
  },
];

/** Whether a search names a role or a company, so widening it stays on topic. */
export const hasRoleOrCompany = (filters: WidenableFilters) =>
  (filters.keywords?.length ?? 0) > 0 || (filters.companies?.length ?? 0) > 0;

/**
 * The searches to try after an empty one, each with every name relaxed so
 * far. Steps whose filters weren't set are skipped, so they cost no query.
 * Empty when the search has no keywords or company: relaxing it would find
 * unrelated jobs.
 */
export function widenedSearches(
  filters: WidenableFilters,
): { filters: WidenableFilters; dropped: WidenStepName[] }[] {
  if (!hasRoleOrCompany(filters)) return [];

  const searches: { filters: WidenableFilters; dropped: WidenStepName[] }[] = [];
  let current = filters;
  let dropped: WidenStepName[] = [];
  for (const step of WIDEN_STEPS) {
    const relaxed = step.names.filter((name) => isSet(current, name));
    if (relaxed.length === 0) continue;
    current = step.apply(current);
    dropped = [...dropped, ...relaxed];
    searches.push({ filters: current, dropped });
  }
  return searches;
}

const DROPPED_LABELS: Record<WidenStepName, string> = {
  postedWithinDays: "the posting date",
  minSalary: "the minimum salary",
  visaRequirements: "the visa requirement",
  platforms: "the job sources",
  jobTypes: "the job type",
  experience: `the experience range (widened by ${EXPERIENCE_WIDEN_YEARS} years)`,
};

export const describeDropped = (dropped: WidenStepName[]) =>
  dropped.map((name) => DROPPED_LABELS[name]).join(", ");

/** For a result the tool widened: what the model tells the user. */
export const widenedMessage = (dropped: WidenStepName[]) =>
  `No jobs matched every filter. These jobs match after relaxing ${describeDropped(dropped)}. Tell the user what you relaxed before listing them.`;

/** For a search that still found nothing: what the model does next. */
export const stillEmptyMessage = (dropped: WidenStepName[]) =>
  `${
    dropped.length > 0
      ? `No jobs found, even after relaxing ${describeDropped(dropped)}.`
      : "No jobs found."
  } Don't search again without job-title keywords. Tell the user, and offer related job titles or other locations. Ask before searching another location or role.`;
