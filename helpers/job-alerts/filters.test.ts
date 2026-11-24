import { describe, expect, it } from "vitest";
import {
  alertFilterKeys,
  alertFiltersFromSearchParams,
  alertJobsPath,
  alertSearchString,
  filtersKey,
} from "./filters";

const key = (search: string) => {
  const filters = alertFiltersFromSearchParams(search);
  return filters ? filtersKey(filters) : null;
};

describe("alertFiltersFromSearchParams (JAT-011, JA-TST-001)", () => {
  it("keeps the alertable filters", () => {
    expect(
      alertFiltersFromSearchParams(
        "jobTitleKeywords=Frontend|React&location=Bangalore|Remote&jobType=Fulltime&platform=greenhouse&companyName=Acme&minSalary=2000000&salaryCurrency=INR&minExperience=2&maxExperience=5",
      ),
    ).toEqual({
      jobTitleKeywords: ["frontend", "react"],
      location: ["bangalore", "remote"],
      jobType: ["Fulltime"],
      platform: ["greenhouse"],
      companyName: ["Acme"],
      minSalary: 2000000,
      salaryCurrency: "INR",
      minExperience: 2,
      maxExperience: 5,
    });
  });

  it("gives one key for any param order, case, `|` order and duplicates", () => {
    const a = key("location=Bangalore|remote&jobTitleKeywords=Frontend");
    expect(key("jobTitleKeywords=frontend&location=Remote|bangalore")).toBe(a);
    expect(key("jobTitleKeywords=FRONTEND|frontend&location=remote|Bangalore|bangalore")).toBe(a);
    expect(key("jobTitleKeywords=%20frontend%20&location=remote|%20Bangalore")).toBe(a);
  });

  it.each([
    ["sortBy=created_at"],
    ["sortOrder=asc"],
    ["createdAfter=7"],
    ["tab=saved"],
    ["tab=applied"],
    ["applicationStatus=submitted"],
    ["jobId=abc"],
    ["cursor=xyz"],
    ["limit=10"],
    ["userId=u1"],
    ["somethingElse=1"],
  ])("drops %s", (dropped) => {
    expect(alertFiltersFromSearchParams(`location=pune&${dropped}`)).toEqual({ location: ["pune"] });
    expect(alertFiltersFromSearchParams(dropped)).toBeNull();
  });

  it("keeps a relevance-sorted search's filters (JA-DEC-004)", () => {
    expect(alertFiltersFromSearchParams("sortBy=relevance&jobTitleKeywords=backend")).toEqual({
      jobTitleKeywords: ["backend"],
    });
  });

  it("is null when nothing alertable is left", () => {
    expect(alertFiltersFromSearchParams("")).toBeNull();
    expect(alertFiltersFromSearchParams("tab=saved")).toBeNull();
    expect(alertFiltersFromSearchParams("location=&jobTitleKeywords=|%20|")).toBeNull();
    expect(alertFiltersFromSearchParams("minSalary=0")).toBeNull();
  });

  it("drops invalid values one at a time, as the schema does", () => {
    expect(alertFiltersFromSearchParams("jobType=Fulltime|Gig&location=pune")).toEqual({ location: ["pune"] });
    expect(alertFiltersFromSearchParams("platform=myspace&minSalary=abc&minExperience=-1&location=pune")).toEqual({
      location: ["pune"],
    });
    expect(alertFiltersFromSearchParams("salaryCurrency=₹&location=pune")).toEqual({ location: ["pune"] });
  });

  it("reads a full URL, URLSearchParams and Next's searchParams object", () => {
    expect(alertFiltersFromSearchParams("/jobs?location=pune")).toEqual({ location: ["pune"] });
    expect(alertFiltersFromSearchParams(new URLSearchParams("location=pune"))).toEqual({ location: ["pune"] });
    expect(alertFiltersFromSearchParams({ location: ["pune", "goa"], tab: "all" })).toEqual({ location: ["pune"] });
  });

  it("orders a reversed experience range", () => {
    expect(alertFiltersFromSearchParams("minExperience=5&maxExperience=2")).toEqual({
      minExperience: 2,
      maxExperience: 5,
    });
  });
});

describe("alertSearchString", () => {
  it("round-trips without a sort", () => {
    const filters = alertFiltersFromSearchParams("sortBy=relevance&location=pune|goa&minSalary=100&salaryCurrency=USD")!;
    const search = alertSearchString(filters);
    expect(search).not.toContain("sortBy");
    expect(alertFiltersFromSearchParams(search)).toEqual(filters);
    expect(alertJobsPath(filters)).toBe(`/jobs?${search}`);
  });
});

describe("filtersKey", () => {
  it("compares company names case-insensitively but keeps their case in the filters", () => {
    const a = alertFiltersFromSearchParams("companyName=Acme")!;
    const b = alertFiltersFromSearchParams("companyName=acme")!;
    expect(a.companyName).toEqual(["Acme"]);
    expect(filtersKey(a)).toBe(filtersKey(b));
  });

  it("differs when a filter differs", () => {
    expect(key("location=pune")).not.toBe(key("location=goa"));
    expect(key("location=pune&minSalary=1")).not.toBe(key("location=pune"));
  });

  it("names the filters used, never the values", () => {
    expect(alertFilterKeys({ location: ["pune"], minSalary: 5 })).toEqual(["location", "minSalary"]);
  });
});
