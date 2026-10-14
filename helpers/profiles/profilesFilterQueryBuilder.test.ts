import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type RecordedCall, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, FORBIDDEN_CANDIDATE_COLUMNS } from "@/test/utils/recruiter";
import { buildProfileQuery } from "./profilesFilterQueryBuilder";

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

const dataQuery = () =>
  supabase.callsFor("user_info").find((c) => !c.chain.some((m) => m.method === "select" && m.args[1]));

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
