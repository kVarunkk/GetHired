import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { OWNER_A } from "@/test/utils/team";
import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { loadApplicationFrame } from "./application-page";

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/companies/get-my-company", () => ({ getMyCompany: vi.fn() }));

const APP_ID = "ea000000-0000-4000-8000-000000000001";
const CANDIDATE_ID = "cc000000-0000-4000-8000-000000000001";

const DIRECT_ID = "e0000000-0000-4000-8000-000000000001";

/** A direct application's frame row; override for imported or claimed. */
function directRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DIRECT_ID,
    applicant_user_id: "00000000-0000-4000-8000-000000000009",
    company_candidate_id: null,
    merged_into_application_id: null,
    source: "direct",
    created_at: "2026-10-25T00:00:00.000Z",
    status: "submitted",
    stage_id: null,
    job_post_id: "b0000000-0000-4000-8000-000000000001",
    user_info: { full_name: "Meera Iyer" },
    company_candidates: null,
    job_postings: { id: "b0000000-0000-4000-8000-000000000001", title: "Backend", company_id: COMPANY_A.id },
    ...overrides,
  };
}

let db: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  vi.mocked(createClient).mockResolvedValue(db.client);
  vi.mocked(getMyCompany).mockResolvedValue(OWNER_A.myCompany);
});

describe("loadApplicationFrame (BI-REQ-030)", () => {
  it("resolves an imported application's person from its company candidate", async () => {
    db.queue("applications", {
      data: {
        id: APP_ID,
        applicant_user_id: null,
        company_candidate_id: CANDIDATE_ID,
        merged_into_application_id: null,
        source: "imported",
        created_at: "2026-10-25T00:00:00.000Z",
        status: "submitted",
        stage_id: null,
        job_post_id: "b0000000-0000-4000-8000-000000000001",
        user_info: null,
        company_candidates: { id: CANDIDATE_ID, full_name: "Meera Iyer", email: "meera@mail.test", resume_path: null },
        job_postings: { id: "b0000000-0000-4000-8000-000000000001", title: "Backend", company_id: COMPANY_A.id },
      },
      error: null,
    });

    const frame = await loadApplicationFrame(APP_ID);

    expect(frame?.person).toMatchObject({
      kind: "candidate",
      name: "Meera Iyer",
      href: `/company/candidates/${CANDIDATE_ID}`,
      imported: true,
      hasResume: false,
    });
    const select = db.callsFor("applications")[0].chain.find((m) => m.method === "select")?.args[0];
    expect(select).toContain("company_candidates(id, full_name, email, resume_path)");
    expect(select).toContain("merged_into_application_id");
    expect(frame?.mergedInto).toBeNull();
  });

  it("names the imported applications merged into this one, and the one this was merged into (BIT-065)", async () => {
    const DIRECT = "ea000000-0000-4000-8000-000000000002";
    db.queue("applications", {
      data: {
        id: DIRECT,
        applicant_user_id: "00000000-0000-4000-8000-000000000009",
        company_candidate_id: null,
        merged_into_application_id: null,
        source: "direct",
        created_at: "2026-10-25T00:00:00.000Z",
        status: "submitted",
        stage_id: null,
        job_post_id: "b0000000-0000-4000-8000-000000000001",
        user_info: { full_name: "Meera Iyer" },
        company_candidates: null,
        job_postings: { id: "b0000000-0000-4000-8000-000000000001", title: "Backend", company_id: COMPANY_A.id },
      },
      error: null,
    });
    db.queue("applications", { data: [{ id: APP_ID, company_candidate_id: CANDIDATE_ID }], error: null });

    const frame = await loadApplicationFrame(DIRECT);

    expect(frame?.mergedFrom).toEqual([APP_ID]);
    expect(frame?.mergedInto).toBeNull();
    expect(db.callsFor("applications")[1].chain).toContainEqual({
      method: "eq",
      args: ["merged_into_application_id", DIRECT],
    });
  });

  it("names an imported application's own company record", async () => {
    db.queue("applications", { data: directRow({ applicant_user_id: null, company_candidate_id: CANDIDATE_ID, source: "imported" }), error: null });
    expect((await loadApplicationFrame(APP_ID))?.importedCandidateIds).toEqual([CANDIDATE_ID]);
  });

  it("keeps a claimed application's own record, not its merges (BIT-101)", async () => {
    db.queue("applications", { data: directRow({ company_candidate_id: CANDIDATE_ID, source: "imported" }), error: null });
    expect((await loadApplicationFrame(APP_ID))?.importedCandidateIds).toEqual([CANDIDATE_ID]);
  });

  // BIT-102: the merged import's candidate is unclaimed when the person
  // applied (BI-REQ-044) and claimed when they used the claim link (BI-REQ-042);
  // either way the merged import has no user, and the direct one names it.
  it.each([
    ["merged on apply", [{ id: APP_ID, company_candidate_id: CANDIDATE_ID }]],
    [
      "merged on claim",
      [
        { id: APP_ID, company_candidate_id: CANDIDATE_ID },
        { id: "ea000000-0000-4000-8000-000000000003", company_candidate_id: CANDIDATE_ID },
      ],
    ],
  ])("names the merged imports' company record on the direct application (%s, BIT-102)", async (_case, merged) => {
    db.queue("applications", { data: directRow(), error: null });
    db.queue("applications", { data: merged, error: null });

    const frame = await loadApplicationFrame(DIRECT_ID);

    expect(frame?.importedCandidateIds).toEqual([CANDIDATE_ID]);
    expect(frame?.person).toMatchObject({ kind: "user", imported: false });
    expect(db.callsFor("applications")[1].chain.find((m) => m.method === "select")?.args[0]).toContain(
      "company_candidate_id",
    );
  });

  it("names no record for a direct application with no merges", async () => {
    db.queue("applications", { data: directRow(), error: null });
    expect((await loadApplicationFrame(DIRECT_ID))?.importedCandidateIds).toEqual([]);
  });

  it("is null for a bad id or a missing application", async () => {
    expect(await loadApplicationFrame("nope")).toBeNull();
    db.queue("applications", { data: null, error: null });
    expect(await loadApplicationFrame(APP_ID)).toBeNull();
  });
});
