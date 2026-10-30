import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, MEMBER_A, type MemberFixture } from "@/test/utils/team";
import { batchOf } from "@/test/utils/candidates";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  previewAgentAddCandidateAction,
  previewAgentDeleteCandidatesAction,
  previewAgentImportAction,
} from "./preview-agent-import";

// RMT-021: pins the three import previews before their core moves into a
// helper the MCP server can call (RMT-024).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const c = (n: number) => `cc000000-0000-4000-8000-00000000000${n}`;
const r = (n: number) => `f1000000-0000-4000-8000-00000000000${n}`;
const STAGE = "5a000000-0000-4000-8000-000000000002";
const LIST = "70000000-0000-4000-8000-000000000001";
let rls: SupabaseMock;
let admin: SupabaseMock;

async function signIn(member: MemberFixture) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

function row(n: number, status: string, fields: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  return {
    id: r(n),
    file_name: `row-${n}`,
    row_number: n,
    status,
    error_code: null,
    extracted: fields ? { fields } : null,
    edited: null,
    warnings: [],
    duplicate_of: null,
    duplicate_action: null,
    created_at: "2026-10-25T00:00:00.000Z",
    ...extra,
  };
}

const batchRow = (overrides: Parameters<typeof batchOf>[1] = {}) => {
  const b = batchOf(COMPANY_A, overrides);
  return { ...b, job_postings: null };
};

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
  await signIn(ADMIN_A);
});

describe("previewAgentImportAction (RMT-021)", () => {
  it("counts a spreadsheet's rows going to a job, by status, with the destination by name", async () => {
    const batch = batchRow({ file_name: "people.csv" });
    rls.queue("candidate_import_batches", { data: batch, error: null });
    rls.queue("candidate_import_rows", {
      data: [
        row(1, "parsed", { full_name: "Asha", email: "asha@mail.test" }),
        row(2, "parsed", { full_name: "Ben", email: "ben@mail.test" }),
        row(3, "parsed", { full_name: "Chen", email: "chen@mail.test" }),
        row(4, "parsed", { full_name: "Dev" }),
        row(5, "parsed", { full_name: "Esi", email: "not an email" }),
        row(6, "queued", null),
      ],
      error: null,
    });
    admin.queue("company_candidates", { data: [{ id: c(1), email: "ben@mail.test" }], error: null });
    rls.queueRpc("match_known_applicants", {
      data: [{ email: "chen@mail.test", user_id: "u-chen", full_name: "Chen" }],
      error: null,
    });
    rls.queue("job_postings", { data: { title: "Backend Engineer" }, error: null });
    rls.queue("pipeline_stages", { data: { name: "Phone screen" }, error: null });
    rls.queue("talent_lists", { data: { name: "Shortlist" }, error: null });

    const result = await previewAgentImportAction({
      batchId: batch.id,
      jobPostId: JOB_A1,
      stageId: STAGE,
      talentListId: LIST,
    });

    expect(result).toEqual({
      ok: true,
      kind: "spreadsheet",
      fileName: "people.csv",
      importing: 4,
      known: 1,
      existing: 1,
      leftOut: 2,
      noEmailForJob: 1,
      missingEmail: 0,
      reading: 1,
      jobTitle: "Backend Engineer",
      stageName: "Phone screen",
      listName: "Shortlist",
      newList: false,
    });
    const text = JSON.stringify(result);
    for (const email of ["asha@mail.test", "ben@mail.test", "chen@mail.test"]) expect(text).not.toContain(email);
    expect(rls.callsFor("candidate_import_batches")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    for (const table of ["job_postings", "pipeline_stages", "talent_lists"]) {
      expect(rls.callsFor(table)[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    }
  });

  it("counts resumes going to a job that still need an email, and names a new list", async () => {
    const batch = batchRow({ kind: "resumes", job_post_id: JOB_A1, file_name: null });
    rls.queue("candidate_import_batches", { data: batch, error: null });
    rls.queue("candidate_import_rows", {
      data: [
        row(1, "parsed", { full_name: "Asha", email: "asha@mail.test" }),
        row(2, "parsed", { full_name: "Ben" }),
        row(3, "failed", null, { error_code: "no_text" }),
      ],
      error: null,
    });
    rls.queue("job_postings", { data: { title: "Backend Engineer" }, error: null });

    const result = await previewAgentImportAction({ batchId: batch.id, jobPostId: JOB_A1, newListName: "Autumn" });

    expect(result).toEqual({
      ok: true,
      kind: "resumes",
      fileName: null,
      importing: 2,
      known: 0,
      existing: 0,
      leftOut: 1,
      noEmailForJob: 0,
      missingEmail: 1,
      reading: 0,
      jobTitle: "Backend Engineer",
      stageName: null,
      listName: "Autumn",
      newList: true,
    });
    expect(rls.callsFor("pipeline_stages")).toHaveLength(0);
    expect(rls.callsFor("talent_lists")).toHaveLength(0);
  });

  it("into the pool only: no job counts and no destination names", async () => {
    const batch = batchRow();
    rls.queue("candidate_import_batches", { data: batch, error: null });
    rls.queue("candidate_import_rows", { data: [row(1, "parsed", { full_name: "Dev" })], error: null });

    expect(await previewAgentImportAction({ batchId: batch.id, jobPostId: null })).toMatchObject({
      ok: true,
      importing: 1,
      noEmailForJob: 0,
      missingEmail: 0,
      jobTitle: null,
      stageName: null,
      listName: null,
      newList: false,
    });
    expect(rls.callsFor("job_postings")).toHaveLength(0);
  });

  it("refuses another company's batch, a confirmed one, a foreign job or list, a bad input and no applicants.import", async () => {
    rls.queue("candidate_import_batches", { data: null, error: null });
    expect(await previewAgentImportAction({ batchId: c(9) })).toEqual({ ok: false, error: "Import not found." });

    await signIn(ADMIN_A);
    const confirmed = batchRow({ status: "confirmed" });
    rls.queue("candidate_import_batches", { data: confirmed, error: null });
    rls.queue("candidate_import_rows", { data: [], error: null });
    expect(await previewAgentImportAction({ batchId: confirmed.id })).toEqual({
      ok: false,
      error: "This import was already confirmed.",
    });

    await signIn(ADMIN_A);
    const batch = batchRow();
    rls.queue("candidate_import_batches", { data: batch, error: null });
    rls.queue("candidate_import_rows", { data: [], error: null });
    rls.queue("job_postings", { data: null, error: null });
    expect(await previewAgentImportAction({ batchId: batch.id, jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: "Job post not found.",
    });

    await signIn(ADMIN_A);
    rls.queue("candidate_import_batches", { data: batch, error: null });
    rls.queue("candidate_import_rows", { data: [], error: null });
    rls.queue("talent_lists", { data: null, error: null });
    expect(await previewAgentImportAction({ batchId: batch.id, talentListId: LIST })).toEqual({
      ok: false,
      error: "Talent list not found.",
    });

    await signIn(ADMIN_A);
    expect(await previewAgentImportAction({ batchId: "nope" })).toEqual({ ok: false, error: "Couldn't read this request." });

    await signIn(HIRING_MANAGER_A);
    expect(await previewAgentImportAction({ batchId: batch.id })).toMatchObject({ ok: false });
    expect(rls.callsFor("candidate_import_batches")).toHaveLength(0);
  });
});

describe("previewAgentAddCandidateAction (RMT-021)", () => {
  it("names the person and the destination", async () => {
    rls.queue("job_postings", { data: { title: "Backend Engineer" }, error: null });
    rls.queue("pipeline_stages", { data: { name: "Phone screen" }, error: null });
    expect(
      await previewAgentAddCandidateAction({ full_name: "Asha Rao", jobPostId: JOB_A1, stageId: STAGE, newListName: "Autumn" }),
    ).toEqual({
      ok: true,
      name: "Asha Rao",
      jobTitle: "Backend Engineer",
      stageName: "Phone screen",
      listName: "Autumn",
      newList: true,
    });
  });

  it("into the pool with no name given", async () => {
    expect(await previewAgentAddCandidateAction({})).toEqual({
      ok: true,
      name: "",
      jobTitle: null,
      stageName: null,
      listName: null,
      newList: false,
    });
  });

  it("refuses a foreign stage, a bad input and no applicants.import", async () => {
    rls.queue("job_postings", { data: { title: "Backend Engineer" }, error: null });
    rls.queue("pipeline_stages", { data: null, error: null });
    expect(await previewAgentAddCandidateAction({ jobPostId: JOB_A1, stageId: STAGE })).toEqual({
      ok: false,
      error: "Pick one of your pipeline stages.",
    });

    await signIn(ADMIN_A);
    expect(await previewAgentAddCandidateAction({ jobPostId: "nope" })).toEqual({
      ok: false,
      error: "Couldn't read this request.",
    });

    await signIn(HIRING_MANAGER_A);
    expect(await previewAgentAddCandidateAction({ full_name: "Asha" })).toMatchObject({ ok: false });
  });
});

describe("previewAgentDeleteCandidatesAction (RMT-021)", () => {
  it("names each candidate with how many jobs they're in, and counts the rest as not found", async () => {
    rls.queue("company_candidates", {
      data: [
        { id: c(1), full_name: "Meera", applications: [{ count: 2 }] },
        { id: c(2), full_name: "Ravi", applications: [] },
      ],
      error: null,
    });

    const result = await previewAgentDeleteCandidatesAction({ candidateIds: [c(1), c(2), c(3), c(1)] });

    expect(result).toEqual({
      ok: true,
      candidates: [
        { id: c(1), name: "Meera", jobs: 2 },
        { id: c(2), name: "Ravi", jobs: 0 },
      ],
      notFound: 1,
    });
    const chain = rls.callsFor("company_candidates")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chain).toContainEqual({ method: "in", args: ["id", [c(1), c(2), c(3)]] });
    expect(chain.find((s) => s.method === "select")?.args[0]).not.toMatch(/email|phone|links/);
  });

  it("refuses an import permission scoped to jobs, no permission, a bad input and a failed read", async () => {
    await signIn(MEMBER_A);
    expect(await previewAgentDeleteCandidatesAction({ candidateIds: [c(1)] })).toMatchObject({ ok: false });

    await signIn(HIRING_MANAGER_A);
    expect(await previewAgentDeleteCandidatesAction({ candidateIds: [c(1)] })).toMatchObject({ ok: false });
    expect(rls.callsFor("company_candidates")).toHaveLength(0);

    await signIn(ADMIN_A);
    expect(await previewAgentDeleteCandidatesAction({ candidateIds: [] })).toEqual({
      ok: false,
      error: "Couldn't read this request.",
    });

    await signIn(ADMIN_A);
    rls.queue("company_candidates", { data: null, error: { message: "boom" } });
    expect(await previewAgentDeleteCandidatesAction({ candidateIds: [c(1)] })).toEqual({
      ok: false,
      error: "Couldn't load the candidates.",
    });
  });
});
