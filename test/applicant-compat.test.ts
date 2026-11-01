// BIT-000 (bulk import, BI-CON-001): imported applications have no
// applicant_user_id, so every applicant-side read must filter by the user and
// never pick one up. These pins must stay green through every phase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendEmail } from "@/utils/email";
import { flushAfter } from "@/test/utils/after";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { readSource } from "@/test/utils/source";
import { GET as remindApplicants } from "@/app/api/updates/applicants/applications/route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/email", () => ({ sendEmail: vi.fn(), sendEmailForStatusUpdate: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret", deploymentUrl: () => "http://localhost:3000" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-internal-secret": "test-secret" }) }));
vi.mock("react-email", () => ({ render: vi.fn(async () => "<p>reminder</p>") }));

/** Each `.from("applications")` statement in `source`, up to the end of its chain. */
function applicationQueries(source: string): string[] {
  return [...source.matchAll(/\.from\("applications"\)/g)].map((m) => {
    const rest = source.slice(m.index!);
    const end = rest.search(/;|\n\s*(supabase|serviceSupabase)\b|\n\s*\/\//);
    return end === -1 ? rest : rest.slice(0, end);
  });
}

describe("applicant reads of applications filter by the user (BI-CON-001)", () => {
  it.each([
    ["app/dashboard/page.tsx", /\.eq\("applicant_user_id", user\.id\)/],
    ["helpers/user/get-profile.ts", /\.eq\("applicant_user_id", user\.id\)/],
    ["helpers/agent/tools/applications.ts", /applicant_user_id"?[,:]\s*ctx\.user\.id/],
    ["app/api/updates/applicants/favorites/route.tsx", /\.in\("applicant_user_id", userIds\)/],
  ])("%s", (file, filter) => {
    const queries = applicationQueries(readSource(file));
    expect(queries.length, file).toBeGreaterThan(0);
    for (const query of queries) expect(query, `${file}:\n${query}`).toMatch(filter);
  });
});

describe("the weekly application reminder skips imported applications", () => {
  let db: SupabaseMock;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createSupabaseMock();
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  });

  it("emails the applicant and nobody for a row with no applicant_user_id", async () => {
    const job = { id: "j1", job_name: "Engineer", company_name: "Acme", locations: [], job_type: "Fulltime", salary_range: "" };
    db.queue("applications", {
      data: [
        {
          id: "a1",
          created_at: "2026-10-20T00:00:00.000Z",
          status: "submitted",
          applicant_user_id: PUBLIC_APPLICANT.id,
          user_info: { email: "ada@example.com", full_name: "Ada", user_id: PUBLIC_APPLICANT.id },
          all_jobs: job,
        },
        {
          id: "a2",
          created_at: "2026-10-20T00:00:00.000Z",
          status: "submitted",
          applicant_user_id: null,
          user_info: null,
          all_jobs: { ...job, id: "j2" },
        },
      ],
      error: null,
    });

    const res = await remindApplicants();
    await flushAfter();

    expect(res.status).toBe(200);
    expect(vi.mocked(sendEmail).mock.calls.map(([args]) => args.toEmail)).toEqual(["ada@example.com"]);
  });
});
