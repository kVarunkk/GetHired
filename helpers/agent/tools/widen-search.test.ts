import { describe, expect, it } from "vitest";
import {
  fewResultsMessage,
  narrowWidened,
  restoreFilter,
  stillEmptyMessage,
  widenedMessage,
  widenedSearches,
  type WidenableFilters,
} from "./widen-search";

const ALL = {
  keywords: ["frontend"],
  locations: ["Bengaluru"],
  companies: ["Acme"],
  postedWithinDays: 7,
  minSalary: 1500000,
  visaRequirements: ["Will Sponsor"],
  platforms: ["greenhouse"],
  jobTypes: ["Fulltime"],
  minExperience: 3,
  maxExperience: 5,
};

describe("widenedSearches", () => {
  it("relaxes date, salary, visa and sources, job type, then experience, one more each step", () => {
    const searches = widenedSearches(ALL);

    expect(searches.map((s) => s.dropped)).toEqual([
      ["postedWithinDays"],
      ["postedWithinDays", "minSalary"],
      ["postedWithinDays", "minSalary", "visaRequirements", "platforms"],
      ["postedWithinDays", "minSalary", "visaRequirements", "platforms", "jobTypes"],
      ["postedWithinDays", "minSalary", "visaRequirements", "platforms", "jobTypes", "experience"],
    ]);
    expect(searches[0].filters).not.toHaveProperty("postedWithinDays");
    expect(searches[0].filters).toMatchObject({ minSalary: 1500000 });
    expect(searches.at(-1)!.filters).toEqual({
      keywords: ["frontend"],
      locations: ["Bengaluru"],
      companies: ["Acme"],
      minExperience: 1,
      maxExperience: 7,
    });
  });

  it("never drops keywords, locations or companies", () => {
    for (const { filters } of widenedSearches(ALL)) {
      expect(filters).toMatchObject({ keywords: ["frontend"], locations: ["Bengaluru"], companies: ["Acme"] });
    }
  });

  it("skips filters that weren't set, so they cost no query", () => {
    const searches = widenedSearches({ keywords: ["react"], postedWithinDays: 7, jobTypes: ["Intern"] });

    expect(searches.map((s) => s.dropped)).toEqual([["postedWithinDays"], ["postedWithinDays", "jobTypes"]]);
  });

  // Review 2026-11-20, turn 3: +2 showed a fresher 3–6 year jobs.
  it("widens a junior's range by one year only", () => {
    const [fresher] = widenedSearches({ keywords: ["react"], maxExperience: 1 });
    const [junior] = widenedSearches({ keywords: ["react"], minExperience: 1, maxExperience: 2 });

    expect(fresher).toEqual({ filters: { keywords: ["react"], maxExperience: 2 }, dropped: ["experience"] });
    expect(junior.filters).toEqual({ keywords: ["react"], maxExperience: 3 });
  });

  it("widens a range above junior by two years", () => {
    const [search] = widenedSearches({ keywords: ["react"], maxExperience: 3 });

    expect(search.filters).toEqual({ keywords: ["react"], maxExperience: 5 });
  });

  it("never widens experience when the user named a level", () => {
    const searches = widenedSearches(
      { keywords: ["react"], maxExperience: 1, postedWithinDays: 7 },
      { keepExperience: true },
    );

    expect(searches).toEqual([{ filters: { keywords: ["react"], maxExperience: 1 }, dropped: ["postedWithinDays"] }]);
  });

  it("drops a minimum experience the widening takes to zero", () => {
    const [search] = widenedSearches({ keywords: ["react"], minExperience: 2 });

    expect(search.filters).toEqual({ keywords: ["react"] });
  });

  it("has nothing to try with only keywords and a location", () => {
    expect(widenedSearches({ keywords: ["react"], locations: ["Pune"] })).toEqual([]);
  });

  it("never widens a search with no keywords or company", () => {
    expect(widenedSearches({ locations: ["Pune"], postedWithinDays: 7 })).toEqual([]);
  });

  it("widens a company search", () => {
    expect(widenedSearches({ companies: ["Acme"], postedWithinDays: 7 })).toHaveLength(1);
  });
});

describe("restoreFilter", () => {
  it("puts back a filter's keys as they were, and removes ones that weren't set", () => {
    const original = { keywords: ["ai"], minSalary: 1500000, salaryCurrency: "INR", maxExperience: 2 };
    const current: WidenableFilters = { keywords: ["ai"], maxExperience: 3 };

    expect(restoreFilter(current, original, "minSalary")).toEqual({ ...current, minSalary: 1500000, salaryCurrency: "INR" });
    expect(restoreFilter(current, original, "experience")).toEqual({ keywords: ["ai"], maxExperience: 2 });
    expect(restoreFilter({ ...current, jobTypes: ["Intern"] }, current, "jobTypes")).toEqual(current);
  });
});

describe("narrowWidened", () => {
  // Review 2026-11-20, turn 5: only the visa filter blocked the search, but
  // salary went first and the user was told it was relaxed.
  it("puts back every relaxed filter the jobs don't need", async () => {
    const original = {
      keywords: ["ai engineer"],
      minSalary: 1500000,
      salaryCurrency: "INR",
      visaRequirements: ["Will Sponsor"],
    };
    const [, widened] = widenedSearches(original);
    const tried: object[] = [];
    const run = async (filters: typeof original) => {
      tried.push(filters);
      return filters.visaRequirements ? null : "jobs";
    };

    const narrowed = await narrowWidened(original, { ...widened, result: "first" }, run);

    expect(widened.dropped).toEqual(["minSalary", "visaRequirements"]);
    expect(narrowed).toEqual({
      filters: { keywords: ["ai engineer"], minSalary: 1500000, salaryCurrency: "INR" },
      dropped: ["visaRequirements"],
      result: "jobs",
    });
    // The most important first: visa, then salary.
    expect(tried).toHaveLength(2);
    expect(tried[0]).toHaveProperty("visaRequirements");
  });

  it("keeps everything relaxed when each one is needed", async () => {
    const original = { keywords: ["ai"], postedWithinDays: 7, jobTypes: ["Intern"] };
    const [, widened] = widenedSearches(original);

    const narrowed = await narrowWidened(original, { ...widened, result: 1 }, async () => null);

    expect(narrowed).toEqual({ ...widened, result: 1 });
  });
});

describe("messages", () => {
  it("names what was relaxed", () => {
    expect(widenedMessage(["postedWithinDays", "minSalary"])).toContain(
      "relaxing only the posting date, the minimum salary",
    );
  });

  it("says what the experience range became", () => {
    expect(widenedMessage(["experience"], { maxExperience: 2 })).toContain("the experience range (now up to 2 years)");
    expect(widenedMessage(["experience"], { minExperience: 1, maxExperience: 4 })).toContain("(now 1–4 years)");
  });

  it("tells the model to list exact matches apart from the relaxed ones", () => {
    expect(fewResultsMessage(1, ["minSalary"])).toMatch(/^Only 1 job matches every filter.*relaxing only the minimum salary/);
  });

  it("tells the model not to drop the keywords when still empty", () => {
    expect(stillEmptyMessage(["postedWithinDays"])).toContain("even after relaxing the posting date");
    expect(stillEmptyMessage([])).toMatch(/^No jobs found\. Don't search again without job-title keywords/);
  });
});
