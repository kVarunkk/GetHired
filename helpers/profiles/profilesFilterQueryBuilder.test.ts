import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, FORBIDDEN_CANDIDATE_COLUMNS } from "@/test/utils/recruiter";
import { buildProfileQuery, sanitizeSearchTerm } from "./profilesFilterQueryBuilder";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const JOB_POSTING_ID = "b0000000-0000-4000-8000-000000000001";

const BASE = {
  searchQuery: null,
  jobRoles: null,
  jobTypes: null,
  locations: null,
  minExperience: null,
  maxExperience: null,
  minSalary: null,
  maxSalary: null,
  skills: null,
  workStyle: null,
  companySize: null,
  industry: null,
  sortBy: "created_at",
  sortOrder: "desc",
  isFavoriteTabActive: false,
  jobEmbedding: null,
  cursor: null,
  limit: 20,
  relevanceSearchType: null,
  jobId: null,
  companyId: COMPANY_A.id,
  isInternalCall: false,
} satisfies Parameters<typeof buildProfileQuery>[0];

let supabase: SupabaseMock;

/** The top-level user_info columns of a select string (joins removed). */
function topLevelColumns(call: RecordedCall) {
  const select = String(call.chain.find((c) => c.method === "select")?.args[0] ?? "");
  let depth = 0;
  let flat = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (depth === 0) flat += ch;
    if (ch === ")") depth--;
  }
  return flat
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The one profiles query (it also returns the total). */
const dataQuery = () => supabase.callsFor("user_info")[0];

beforeEach(() => {
  vi.clearAllMocks();
  supabase = createSupabaseMock();
  supabase.queueRpc("match_user_profiles", { data: [{ user_id: "a1" }], error: null });
  vi.mocked(createClient).mockResolvedValue(supabase.client);
});

describe("buildProfileQuery column exposure (RS-SEC-004)", () => {
  it.each([
    ["the default listing", {}],
    ["favorites", { isFavoriteTabActive: true }],
    ["standard relevance", { relevanceSearchType: "standard" as const, jobId: JOB_POSTING_ID }],
    ["AI relevance (digest)", { relevanceSearchType: "digest" as const, jobEmbedding: "[0.1]" }],
  ])("selects no forbidden column for %s", async (_, overrides) => {
    await buildProfileQuery({ ...BASE, ...overrides });

    const columns = topLevelColumns(dataQuery()!);
    expect(columns).toContain("user_id");
    for (const forbidden of FORBIDDEN_CANDIDATE_COLUMNS) expect(columns).not.toContain(forbidden);
    expect(columns.filter((c) => /embedding/.test(c) || c === "*")).toEqual([]);
  });

  it("keeps the default listing to public, filled profiles", async () => {
    await buildProfileQuery(BASE);

    const { chain } = dataQuery()!;
    expect(chain).toContainEqual({ method: "eq", args: ["is_public", true] });
    expect(chain).toContainEqual({ method: "eq", args: ["filled", true] });
  });
});

describe("buildProfileQuery talent list filter (PLT-090)", () => {
  const LIST_ID = "a1000000-0000-4000-8000-00000000000a";

  it("shows a list's members instead of everyone or the favorites", async () => {
    await buildProfileQuery({ ...BASE, talentListId: LIST_ID });

    const { chain } = dataQuery()!;
    const select = String(chain.find((c) => c.method === "select")?.args[0]);
    expect(select).toContain("talent_list_members!inner(list_id)");
    expect(select).not.toContain("company_favorites");
    expect(chain).toContainEqual({ method: "eq", args: ["talent_list_members.list_id", LIST_ID] });
    expect(chain).toContainEqual({ method: "eq", args: ["is_public", true] });
    for (const forbidden of FORBIDDEN_CANDIDATE_COLUMNS) expect(topLevelColumns(dataQuery()!)).not.toContain(forbidden);
  });

  it("shows everyone without a list", async () => {
    await buildProfileQuery({ ...BASE });

    const select = String(dataQuery()!.chain.find((c) => c.method === "select")?.args[0]);
    expect(select).not.toContain("talent_list_members");
  });
});

describe("buildProfileQuery total", () => {
  it("counts the filtered tab itself, not every profile", async () => {
    supabase.queue("user_info", { data: [], error: null, count: 3 });

    const result = await buildProfileQuery({
      ...BASE,
      talentListId: "a1000000-0000-4000-8000-00000000000a",
      skills: "react",
    });

    expect(supabase.callsFor("user_info")).toHaveLength(1);
    const select = dataQuery()!.chain.find((c) => c.method === "select")!;
    expect(select.args[1]).toEqual({ count: "exact" });
    expect(result.count).toBe(3);
  });

  it("doesn't count again on later pages", async () => {
    await buildProfileQuery({ ...BASE, cursor: Buffer.from("2026-10-01_u1").toString("base64") });

    const select = dataQuery()!.chain.find((c) => c.method === "select")!;
    expect(select.args[1]).toBeUndefined();
  });
});

describe("buildProfileQuery match columns (MT-TASK-002)", () => {
  const selectOf = (call: RecordedCall) =>
    String(call.chain.find((c) => c.method === "select")?.args[0] ?? "");

  it("selects the match score and explanation in job context", async () => {
    await buildProfileQuery({ ...BASE, relevanceSearchType: "standard", jobId: JOB_POSTING_ID });

    const select = selectOf(dataQuery()!);
    expect(select).toMatch(/job_relevant_profiles!inner\([^)]*match_score[^)]*\)/);
    expect(select).toMatch(/job_relevant_profiles!inner\([^)]*explanation[^)]*\)/);
    expect(select).toMatch(/job_relevant_profiles!inner\([^)]*relevance_rank[^)]*\)/);
    expect(select).not.toContain("job_relevant_profiles!inner(*)");
  });

  it.each([
    ["the default listing", {}],
    ["favorites", { isFavoriteTabActive: true }],
    ["AI relevance (digest)", { relevanceSearchType: "digest" as const, jobEmbedding: "[0.1]" }],
  ])("doesn't select them for %s", async (_, overrides) => {
    await buildProfileQuery({ ...BASE, ...overrides });

    const select = selectOf(dataQuery()!);
    expect(select).not.toContain("match_score");
    expect(select).not.toContain("explanation");
  });
});

describe("buildProfileQuery budget (RAT-022)", () => {
  it("keeps candidates whose minimum salary fits the budget", async () => {
    await buildProfileQuery({ ...BASE, budget: 4000000 });

    expect(dataQuery()!.chain).toContainEqual({ method: "lte", args: ["min_salary", 4000000] });
  });

  it("adds no salary filter without a budget", async () => {
    await buildProfileQuery(BASE);

    expect(dataQuery()!.chain.some((c) => c.args[0] === "min_salary")).toBe(false);
  });
});

describe("buildProfileQuery search", () => {
  it("matches the term against name and career goals", async () => {
    await buildProfileQuery({ ...BASE, searchQuery: "  Priya  Sharma " });

    expect(dataQuery()!.chain).toContainEqual({
      method: "or",
      args: [
        'full_name.ilike."%Priya Sharma%",career_goals_short_term.ilike."%Priya Sharma%",career_goals_long_term.ilike."%Priya Sharma%"',
      ],
    });
  });

  it("adds no search filter for a blank or symbols-only term", async () => {
    await buildProfileQuery({ ...BASE, searchQuery: ' ,()"% ' });

    expect(dataQuery()!.chain.some((c) => c.method === "or")).toBe(false);
  });
});

describe("buildProfileQuery array filters", () => {
  const FILTERS = {
    jobRoles: "Backend|Data Engineer",
    skills: "react",
    workStyle: "Remote",
    industry: "FinTech",
  };

  it("overlaps exact values by default", async () => {
    await buildProfileQuery({ ...BASE, ...FILTERS });

    const { chain } = dataQuery()!;
    expect(chain).toContainEqual({ method: "overlaps", args: ["desired_roles", ["Backend", "Data Engineer"]] });
    expect(chain).toContainEqual({ method: "overlaps", args: ["top_skills", ["react"]] });
    expect(chain).toContainEqual({ method: "overlaps", args: ["work_style_preferences", ["Remote"]] });
    expect(chain).toContainEqual({ method: "overlaps", args: ["industry_preferences", ["FinTech"]] });
    expect(chain.some((c) => c.method === "or")).toBe(false);
  });

  it("matches any term by lowercased substring with matchText", async () => {
    await buildProfileQuery({ ...BASE, ...FILTERS, matchText: true });

    const { chain } = dataQuery()!;
    expect(chain).toContainEqual({
      method: "or",
      args: ['desired_roles_search.ilike."%backend%",desired_roles_search.ilike."%data engineer%"'],
    });
    expect(chain).toContainEqual({ method: "or", args: ['top_skills_search.ilike."%react%"'] });
    expect(chain).toContainEqual({ method: "or", args: ['work_style_preferences_search.ilike."%remote%"'] });
    expect(chain).toContainEqual({ method: "or", args: ['industry_preferences_search.ilike."%fintech%"'] });
    expect(chain.some((c) => c.method === "overlaps")).toBe(false);
  });

  it("sanitizes terms and skips ones left empty", async () => {
    await buildProfileQuery({ ...BASE, skills: 'C++),id.eq.(x|%|Node', matchText: true });

    expect(dataQuery()!.chain.filter((c) => c.method === "or")).toEqual([
      { method: "or", args: ['top_skills_search.ilike."%c++ id.eq. x%",top_skills_search.ilike."%node%"'] },
    ]);
  });
});

describe("sanitizeSearchTerm", () => {
  it("strips characters that would break out of the or() filter", () => {
    expect(sanitizeSearchTerm('a"),user_id.eq.(x')).toBe("a user id.eq. x");
  });

  it("strips ilike wildcards and caps the length", () => {
    expect(sanitizeSearchTerm("50%_off*")).toBe("50 off");
    expect(sanitizeSearchTerm("x".repeat(500))).toHaveLength(100);
  });

  it("returns an empty string for null", () => {
    expect(sanitizeSearchTerm(null)).toBe("");
  });
});
