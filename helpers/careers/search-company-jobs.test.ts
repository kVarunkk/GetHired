import { describe, expect, it } from "vitest";
import { CAREERS_PAGE_SIZE, parseCareersFilters, searchCompanyJobs, serializeCareersFilters, type CareersJob } from "./search-company-jobs";

let n = 0;
const job = (overrides: Partial<CareersJob>): CareersJob => {
  n += 1;
  return {
    id: `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    allJobsId: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Job ${n}`,
    description: "",
    locations: ["bengaluru"],
    jobType: "Fulltime",
    department: null,
    workplaceType: null,
    salaryCurrency: "₹",
    salaryRange: null,
    minSalary: null,
    maxSalary: null,
    minExperience: null,
    maxExperience: null,
    experience: null,
    createdAt: `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`,
    ...overrides,
  };
};

const JOBS = [
  job({ title: "Backend Engineer", description: "Go and Postgres", department: "Engineering", workplaceType: "remote", minSalary: 2000000, maxSalary: 3000000, minExperience: 3 }),
  job({ title: "Product Designer", department: "Design", workplaceType: "onsite", locations: ["mumbai"], jobType: "Contract", maxSalary: 1500000, minExperience: 1 }),
  job({ title: "Frontend Engineer", department: "Engineering", workplaceType: "hybrid", maxSalary: 2500000, minExperience: 5 }),
  job({ title: "Office Manager", department: null, jobType: "Intern" }),
];

const titles = (r: ReturnType<typeof searchCompanyJobs>) => r.jobs.map((j) => j.title);

describe("searchCompanyJobs (CP-REQ-005, CP-GUD-002)", () => {
  it("lists newest first by default, with department counts", () => {
    const r = searchCompanyJobs(JOBS, parseCareersFilters(new URLSearchParams()));
    expect(titles(r)).toEqual(["Office Manager", "Frontend Engineer", "Product Designer", "Backend Engineer"]);
    expect(r.total).toBe(4);
    expect(r.departments).toEqual([
      { name: "Engineering", count: 2 },
      { name: "Design", count: 1 },
      { name: "Other", count: 1 },
    ]);
  });

  it("searches title and description, ignoring case", () => {
    expect(titles(searchCompanyJobs(JOBS, parseCareersFilters(new URLSearchParams("q=postgres"))))).toEqual(["Backend Engineer"]);
    expect(titles(searchCompanyJobs(JOBS, parseCareersFilters(new URLSearchParams("q=ENGINEER"))))).toEqual([
      "Frontend Engineer",
      "Backend Engineer",
    ]);
  });

  it.each([
    ["department=Engineering", ["Frontend Engineer", "Backend Engineer"]],
    ["department=Engineering&department=Design", ["Frontend Engineer", "Product Designer", "Backend Engineer"]],
    ["workplace=remote", ["Backend Engineer"]],
    ["location=mumbai", ["Product Designer"]],
    ["jobType=Contract", ["Product Designer"]],
    ["minSalary=2200000", ["Frontend Engineer", "Backend Engineer"]],
    ["experience=4", ["Backend Engineer", "Product Designer", "Office Manager"].reverse()],
  ])("filters by %s", (query, expected) => {
    expect(titles(searchCompanyJobs(JOBS, parseCareersFilters(new URLSearchParams(query))))).toEqual(expected);
  });

  it("sorts by title", () => {
    expect(titles(searchCompanyJobs(JOBS, parseCareersFilters(new URLSearchParams("sort=title"))))).toEqual([
      "Backend Engineer",
      "Frontend Engineer",
      "Office Manager",
      "Product Designer",
    ]);
  });

  it("pages results", () => {
    const many = Array.from({ length: CAREERS_PAGE_SIZE + 3 }, (_, i) => job({ title: `Role ${i}` }));
    const first = searchCompanyJobs(many, parseCareersFilters(new URLSearchParams()));
    expect(first.jobs).toHaveLength(CAREERS_PAGE_SIZE);
    expect(first.hasMore).toBe(true);
    const second = searchCompanyJobs(many, parseCareersFilters(new URLSearchParams("page=2")));
    expect(second.jobs).toHaveLength(3);
    expect(second.hasMore).toBe(false);
  });

  it("offers the locations, job types and departments that exist", () => {
    const r = searchCompanyJobs(JOBS, parseCareersFilters(new URLSearchParams()));
    expect(r.options).toEqual({
      locations: ["bengaluru", "mumbai"],
      jobTypes: ["Contract", "Fulltime", "Intern"],
      departments: ["Design", "Engineering"],
      workplaces: ["onsite", "hybrid", "remote"],
    });
  });

  it("ignores bad parameters and round-trips through the URL", () => {
    const filters = parseCareersFilters(new URLSearchParams("q=go&workplace=moon&minSalary=abc&page=-3&sort=random&ref=linkedin"));
    expect(filters).toEqual({ q: "go", locations: [], jobTypes: [], departments: [], workplaces: [], minSalary: null, experience: null, sort: "newest", page: 1 });
    const back = parseCareersFilters(new URLSearchParams(serializeCareersFilters({ ...filters, departments: ["Design"], page: 2 })));
    expect(back).toEqual({ ...filters, departments: ["Design"], page: 2 });
  });
});
