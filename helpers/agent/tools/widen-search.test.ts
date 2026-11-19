import { describe, expect, it } from "vitest";
import { stillEmptyMessage, widenedMessage, widenedSearches } from "./widen-search";

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

  it("widens a fresher's range instead of removing it", () => {
    const [search] = widenedSearches({ keywords: ["react"], maxExperience: 1 });

    expect(search).toEqual({ filters: { keywords: ["react"], maxExperience: 3 }, dropped: ["experience"] });
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

describe("messages", () => {
  it("names what was relaxed", () => {
    expect(widenedMessage(["postedWithinDays", "minSalary"])).toContain(
      "relaxing the posting date, the minimum salary",
    );
  });

  it("tells the model not to drop the keywords when still empty", () => {
    expect(stillEmptyMessage(["postedWithinDays"])).toContain("even after relaxing the posting date");
    expect(stillEmptyMessage([])).toMatch(/^No jobs found\. Don't search again without job-title keywords/);
  });
});
