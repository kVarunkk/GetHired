import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { expandLocations } from "@/helpers/locations/aliases";
import {
  createSupabaseMock,
  type SupabaseMock,
} from "@/test/utils/supabase-mock";
import {
  buildQuery,
  titleKeywordConditions,
  titleWords,
} from "./filterQueryBuilder";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({
  getUserFromRequest: vi.fn(),
}));
vi.mock("@/helpers/locations/aliases", () => ({ expandLocations: vi.fn() }));

const BASE_ARGS = {
  jobType: null,
  visaRequirement: null,
  location: null,
  minSalary: null,
  minExperience: null,
  maxExperience: null,
  platform: null,
  companyName: null,
  cursor: null,
  limit: 10,
  sortBy: "created_at",
  sortOrder: "desc",
  jobTitleKeywords: null,
  isFavoriteTabActive: false,
  isAppliedJobsTabActive: false,
  userEmbedding: null,
  applicationStatus: null,
  createdAfter: null,
  isInternalCall: false,
  jobEmbedding: null,
  relevanceSearchType: null,
  userId: null,
} as const;

let supabase: SupabaseMock;

const overlapsCall = () =>
  supabase
    .callsFor("all_jobs")[0]
    ?.chain.find((step) => step.method === "overlaps");

beforeEach(() => {
  supabase = createSupabaseMock();
  supabase.queue("all_jobs", { data: [], error: null, count: 0 });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
  vi.mocked(getUserFromRequest).mockResolvedValue(null);
});

describe("buildQuery: location filter", () => {
  it("filters on the expanded alias group, so every spelling of a place matches", async () => {
    vi.mocked(expandLocations).mockResolvedValue([
      "bangalore",
      "bengaluru",
      "remote",
    ]);

    await buildQuery({ ...BASE_ARGS, location: "Bengaluru|Remote" });

    expect(expandLocations).toHaveBeenCalledWith(["Bengaluru", "Remote"]);
    expect(overlapsCall()).toEqual({
      method: "overlaps",
      args: ["normalized_locations", ["bangalore", "bengaluru", "remote"]],
    });
  });

  it("adds no location filter when none is requested", async () => {
    await buildQuery({ ...BASE_ARGS });

    expect(expandLocations).not.toHaveBeenCalled();
    expect(overlapsCall()).toBeUndefined();
  });
});

describe("buildQuery: total", () => {
  const selectOf = () =>
    supabase
      .callsFor("all_jobs")[0]
      .chain.find((step) => step.method === "select")!;

  it("counts the filtered query itself, not every job", async () => {
    supabase = createSupabaseMock();
    supabase.queue("all_jobs", { data: [], error: null, count: 12 });
    vi.mocked(createClient).mockResolvedValue(supabase.client);

    const result = await buildQuery({ ...BASE_ARGS, jobType: "Fulltime" });

    expect(supabase.callsFor("all_jobs")).toHaveLength(1);
    expect(selectOf().args[1]).toEqual({ count: "exact" });
    expect(result.count).toBe(12);
  });

  it("doesn't count again on later pages", async () => {
    await buildQuery({
      ...BASE_ARGS,
      cursor: Buffer.from("2026-10-01_j1").toString("base64"),
    });

    expect(selectOf().args[1]).toBeUndefined();
  });
});

describe("buildQuery: cursor", () => {
  const cursorOf = (value: string, id: string) =>
    Buffer.from(`${value}_${id}`).toString("base64");
  const chain = () => supabase.callsFor("all_jobs")[0]!.chain;

  it("continues after the last row, ties by id, then the nulls", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "salary_min",
      sortOrder: "desc",
      cursor: cursorOf("50000", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "or",
      args: [
        'salary_min.lt."50000",and(salary_min.eq."50000",id.lt.j9),salary_min.is.null',
      ],
    });
  });

  it("breaks ties by id in the sort direction when ascending", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "salary_min",
      sortOrder: "asc",
      cursor: cursorOf("50000", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "or",
      args: [
        'salary_min.gt."50000",and(salary_min.eq."50000",id.gt.j9),salary_min.is.null',
      ],
    });
  });

  it("only returns later nulls once the last row was null, so no row repeats", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "salary_min",
      sortOrder: "desc",
      cursor: cursorOf("null", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "is",
      args: ["salary_min", null],
    });
    expect(chain()).toContainEqual({
      method: "filter",
      args: ["id", "lt", "j9"],
    });
    expect(chain().filter((step) => step.method === "or")).toEqual([]);
  });

  it("quotes values with commas and keeps non-ASCII text", async () => {
    await buildQuery({
      ...BASE_ARGS,
      sortBy: "company_name",
      sortOrder: "asc",
      cursor: cursorOf("Acme, Inc_Café", "j9"),
    });

    expect(chain()).toContainEqual({
      method: "or",
      args: [
        'company_name.gt."Acme, Inc_Café",and(company_name.eq."Acme, Inc_Café",id.gt.j9),company_name.is.null',
      ],
    });
  });
});

describe("buildQuery: experience filter", () => {
  const experienceCalls = () =>
    supabase
      .callsFor("all_jobs")[0]
      ?.chain.filter((step) => String(step.args[0]).startsWith("experience_"));

  it("matches jobs whose range overlaps the applicant's, open-ended jobs included", async () => {
    await buildQuery({ ...BASE_ARGS, minExperience: "1", maxExperience: "3" });

    expect(experienceCalls()).toEqual([
      { method: "not", args: ["experience_min", "is", null] },
      { method: "or", args: ["experience_max.gte.1,experience_max.is.null"] },
      { method: "lte", args: ["experience_min", 3] },
    ]);
  });

  it("applies a max on its own", async () => {
    await buildQuery({ ...BASE_ARGS, maxExperience: "0" });

    expect(experienceCalls()).toEqual([
      { method: "not", args: ["experience_min", "is", null] },
      { method: "lte", args: ["experience_min", 0] },
    ]);
  });

  it("adds no experience filter when none is requested", async () => {
    await buildQuery({ ...BASE_ARGS });

    expect(experienceCalls()).toEqual([]);
  });
});

describe("titleKeywordConditions", () => {
  // The column value, as public.job_title_search_text builds it in SQL.
  const searchText = (title: string) => {
    const words = titleWords(title);
    if (words.length === 0) return "";
    const pairs = words.slice(1).map((word, i) => words[i] + word);
    return `${words.join(" ")} | ${pairs.join(" ")}`;
  };
  // Reads each PostgREST condition back into a regex, the way imatch runs it.
  const matchers = (keyword: string) =>
    titleKeywordConditions(keyword).map((condition) => {
      const quoted = condition.replace(/^job_name_search\.imatch\./, "");
      const pattern = quoted.slice(1, -1).replace(/\\(["\\])/g, "$1");
      return new RegExp(pattern, "i");
    });
  const matches = (keyword: string, titles: string[]) =>
    titles.filter((title) =>
      matchers(keyword).some((re) => re.test(searchText(title))),
    );

  it("builds the column value the way the SQL function does", () => {
    expect(searchText("Full-Stack Developer (React/Node.js)")).toBe(
      "full stack developer react node js | fullstack stackdeveloper developerreact reactnode nodejs",
    );
    expect(searchText("C++ / C# Engineer")).toBe(
      "c++ c# engineer | c++c# c#engineer",
    );
    expect(searchText("Engineer")).toBe("engineer | ");
  });

  it("matches every spelling of a compound word", () => {
    const titles = [
      "Fullstack Developer",
      "FullStack Engineer",
      "Full Stack Developer",
      "Full-Stack Engineer",
      "Stack Engineer",
    ];
    const allButLast = titles.slice(0, 4);
    expect(matches("fullstack", titles)).toEqual(allButLast);
    expect(matches("full stack", titles)).toEqual(allButLast);
    expect(matches("Full-Stack", titles)).toEqual(allButLast);
    expect(
      matches("frontend", ["Front End Engineer", "Front-end Dev", "Frontend"]),
    ).toHaveLength(3);
    expect(
      matches("nodejs", ["Node.js Developer", "NodeJS Engineer", "Node Dev"]),
    ).toEqual(["Node.js Developer", "NodeJS Engineer"]);
  });

  it("matches short keywords as whole words only", () => {
    expect(
      matches("ai", [
        "AI Engineer",
        "Senior Gen AI Developer",
        "AI/ML Engineer",
        "Airspace Information Center (AIC) Training Supervisor",
        "Air Traffic Control (ATC) Facility Chief",
      ]),
    ).toEqual(["AI Engineer", "Senior Gen AI Developer", "AI/ML Engineer"]);
    expect(
      matches("rag", ["RAG Engineer", "Storage Admin", "Leverage Lead"]),
    ).toEqual(["RAG Engineer"]);
  });

  it("matches longer keywords at the start of a word", () => {
    expect(
      matches("developer", [
        "Python Developers",
        "Senior Developer",
        "Redeveloper",
      ]),
    ).toEqual(["Python Developers", "Senior Developer"]);
    expect(
      matches("script", ["Script Writer", "JavaScript Developer"]),
    ).toEqual(["Script Writer"]);
  });

  it("handles symbols in keywords", () => {
    expect(matches("c++", ["C++ Developer", "C Developer"])).toEqual([
      "C++ Developer",
    ]);
    expect(
      matches("c#", ["C# Developer", "C#/.NET Lead", "C Developer"]),
    ).toEqual(["C# Developer", "C#/.NET Lead"]);
    expect(
      matches(".net", [
        ".NET Engineer",
        "ASP.NET Developer",
        "Network Engineer",
      ]),
    ).toEqual([".NET Engineer", "ASP.NET Developer"]);
    expect(
      matches("node.js", ["Node.js Developer", "NodeJS Engineer", "Node Dev"]),
    ).toEqual(["Node.js Developer", "NodeJS Engineer"]);
  });

  it("escapes and quotes the pattern for the or filter", () => {
    expect(titleKeywordConditions("ai")).toEqual([
      'job_name_search.imatch."(^| )ai( |$)"',
    ]);
    expect(titleKeywordConditions("C++")).toEqual([
      'job_name_search.imatch."(^| )c\\\\+\\\\+( |$)"',
    ]);
    expect(titleKeywordConditions("full-stack")).toEqual([
      'job_name_search.imatch."(^| )full stack"',
      'job_name_search.imatch."(^| )fullstack"',
    ]);
  });

  it("returns nothing for a keyword with no words", () => {
    expect(titleKeywordConditions(" - / ")).toEqual([]);
  });
});

describe("buildQuery: title keywords", () => {
  it("ors every keyword's conditions together", async () => {
    await buildQuery({ ...BASE_ARGS, jobTitleKeywords: "ai|full stack" });

    expect(supabase.callsFor("all_jobs")[0]?.chain).toContainEqual({
      method: "or",
      args: [
        [
          ...titleKeywordConditions("ai"),
          ...titleKeywordConditions("full stack"),
        ].join(","),
      ],
    });
  });

  it("adds no title filter when the keywords have no words", async () => {
    await buildQuery({ ...BASE_ARGS, jobTitleKeywords: "-" });

    const orCalls = supabase
      .callsFor("all_jobs")[0]
      ?.chain.filter((step) => step.method === "or");
    expect(orCalls).toEqual([]);
  });
});
