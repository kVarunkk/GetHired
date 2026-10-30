import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, memberOf, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { getImportMappingAction } from "./import-mapping";
import { checkImportEmailsAction } from "./check-import-emails";
import { startImportAction } from "./start-import";
import { confirmSpreadsheetImportAction, type ConfirmSpreadsheetImportInput } from "./confirm-spreadsheet-import";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));

const BATCH = "cb000000-0000-4000-8000-000000000001";
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const LIST = "71000000-0000-4000-8000-000000000001";
const STAGE = "90000000-0000-4000-8000-000000000001";
const ONSITE = "90000000-0000-4000-8000-000000000002";
const OTHER_STAGE = "90000000-0000-4000-8000-0000000000ff";
const KNOWN_USER = "a0000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
/** Member template, assigned to JOB_A1: applicants.import for that job only. */
const ASSIGNED_MEMBER = memberOf(COMPANY_A, "member", { assignedJobIds: [JOB_A1] });

let rls: SupabaseMock;
let admin: SupabaseMock;

async function signIn(member: MemberFixture = OWNER_A) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

const rpcArgs = (fn: string, i = 0) => rls.callsFor(fn)[i]?.chain[0].args[1] as Record<string, unknown>;
const noEmailQueued = () => {
  expect(rls.calls.filter((c) => c.schema === "pgmq_public")).toEqual([]);
  expect(admin.calls.filter((c) => c.schema === "pgmq_public")).toEqual([]);
};

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) =>
    names.map((n) => (n.toLowerCase() === "bangalore" ? "bengaluru" : n)),
  );
  await signIn();
});

describe("getImportMappingAction (BI-REQ-011)", () => {
  it("loads the company's mapping for a header hash", async () => {
    rls.queue("candidate_import_mappings", {
      data: { mapping: { columns: ["full_name", "stage"], stageMap: { Onsite: ONSITE } } },
      error: null,
    });
    expect(await getImportMappingAction({ headerHash: HASH })).toEqual({
      ok: true,
      mapping: { columns: ["full_name", "stage"], stageMap: { Onsite: ONSITE } },
    });
    const [read] = rls.callsFor("candidate_import_mappings");
    expect(read.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(read.chain).toContainEqual({ method: "eq", args: ["header_hash", HASH] });
  });

  it("reads a broken saved mapping as none, and refuses a bad hash", async () => {
    rls.queue("candidate_import_mappings", { data: { mapping: { columns: ["password"] } }, error: null });
    expect(await getImportMappingAction({ headerHash: HASH })).toEqual({ ok: true, mapping: null });
    expect(await getImportMappingAction({ headerHash: "nope" })).toMatchObject({ ok: false });
    expect(await getImportMappingAction({ headerHash: HASH, companyId: COMPANY_A.id } as never)).toMatchObject({
      ok: false,
    });
  });

  it("needs applicants.import", async () => {
    await signIn(HIRING_MANAGER_A);
    expect(await getImportMappingAction({ headerHash: HASH })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import"),
    });
    expect(rls.callsFor("candidate_import_mappings")).toHaveLength(0);
  });
});

describe("checkImportEmailsAction (BI-REQ-014/019)", () => {
  it("returns the company's candidates and the known GetHired users", async () => {
    admin.queue("company_candidates", { data: [{ id: CANDIDATE, email: "ben@mail.test" }], error: null });
    rls.queueRpc("match_known_applicants", {
      data: [{ email: "cid@mail.test", user_id: KNOWN_USER, full_name: "Cid" }],
      error: null,
    });

    expect(
      await checkImportEmailsAction({ emails: ["Ben@Mail.test", "cid@mail.test", "ben@mail.test", "", "nope"] }),
    ).toEqual({
      ok: true,
      existing: [{ email: "ben@mail.test", id: CANDIDATE }],
      known: [{ email: "cid@mail.test", userId: KNOWN_USER, fullName: "Cid" }],
    });
    const [lookup] = admin.callsFor("company_candidates");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(lookup.chain).toContainEqual({ method: "in", args: ["email", ["ben@mail.test", "cid@mail.test"]] });
    expect(rpcArgs("match_known_applicants")).toEqual({ p_emails: ["ben@mail.test", "cid@mail.test"] });
  });

  it("looks up a whole file in chunks, and refuses more than 5,000 emails", async () => {
    const emails = Array.from({ length: 400 }, (_, i) => `p${i}@mail.test`);
    await checkImportEmailsAction({ emails });
    expect(admin.callsFor("company_candidates")).toHaveLength(3);
    expect(rls.callsFor("match_known_applicants")).toHaveLength(1);

    expect(await checkImportEmailsAction({ emails: Array(5001).fill("a@b.co") })).toMatchObject({ ok: false });
  });

  it("works for a member scoped to one job, and not without the permission", async () => {
    await signIn(ASSIGNED_MEMBER);
    expect(await checkImportEmailsAction({ emails: [] })).toEqual({ ok: true, existing: [], known: [] });
    await signIn(HIRING_MANAGER_A);
    expect(await checkImportEmailsAction({ emails: ["a@b.co"] })).toMatchObject({ ok: false });
    expect(admin.callsFor("company_candidates")).toHaveLength(0);
  });
});

describe("startImportAction (BI-SEC-008)", () => {
  it("starts a draft spreadsheet batch named after the file", async () => {
    rls.queueRpc("start_candidate_import", { data: { ok: true, batch_id: BATCH }, error: null });
    expect(await startImportAction({ fileName: " people.csv " })).toEqual({ ok: true, batchId: BATCH });
    expect(rpcArgs("start_candidate_import")).toEqual({ p_kind: "spreadsheet", p_file_name: "people.csv" });
  });

  it("says when the hourly or daily limit is reached", async () => {
    rls.queueRpc("start_candidate_import", { data: { ok: false, reason: "import_limit_hour" }, error: null });
    expect(await startImportAction({ fileName: "a.csv" })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.import_limit_hour,
    });
    await signIn();
    rls.queueRpc("start_candidate_import", { data: { ok: false, reason: "import_limit_day" }, error: null });
    expect(await startImportAction({ fileName: "a.csv" })).toEqual({ ok: false, error: IMPORT_MESSAGES.import_limit_day });
  });

  it("needs applicants.import at some scope, and a file name", async () => {
    await signIn(HIRING_MANAGER_A);
    expect(await startImportAction({ fileName: "a.csv" })).toMatchObject({ ok: false });
    await signIn();
    expect(await startImportAction({ fileName: "" })).toEqual({ ok: false, error: IMPORT_MESSAGES.invalid });
    expect(rls.callsFor("start_candidate_import")).toHaveLength(0);
  });
});

describe("confirmSpreadsheetImportAction (BI-REQ-015/016/017)", () => {
  const base: ConfirmSpreadsheetImportInput = {
    batchId: BATCH,
    rows: [
      { full_name: "Asha Rao", email: "Asha@Mail.test", location: "Bangalore", skills: "Go; Rust", phone: "" },
      { full_name: "Ben", email: "ben@mail.test", duplicate_action: "overwrite" },
    ],
    attested: true,
  };
  const confirms = (counts: Record<string, number> = { created: 1, updated: 1 }) =>
    rls.queueRpc("confirm_candidate_import", { data: { ok: true, batch_id: BATCH, counts }, error: null });
  const stages = (ids = [STAGE, ONSITE]) =>
    rls.queue("pipeline_stages", { data: ids.map((id) => ({ id })), error: null });

  it("confirms into the pool with the rows validated again, and nobody emailed", async () => {
    confirms();
    const result = await confirmSpreadsheetImportAction({
      ...base,
      lawfulBasisNote: "consented in our old ATS",
      mapping: { headerHash: HASH, columns: ["full_name", "email", "location", "skills", "phone"] },
    });

    expect(result).toEqual({
      ok: true,
      batchId: BATCH,
      counts: expect.objectContaining({ created: 1, updated: 1, added_to_job: 0 }),
      newList: null,
    });
    expect(rpcArgs("confirm_candidate_import")).toEqual({
      p_batch_id: BATCH,
      p_rows: [
        { full_name: "Asha Rao", email: "asha@mail.test", location: "bengaluru", skills: ["Go", "Rust"], phone: null },
        { full_name: "Ben", email: "ben@mail.test", duplicate_action: "overwrite" },
      ],
      p_options: { attested: true, duplicate_action: "skip", lawful_basis_note: "consented in our old ATS" },
    });
    // The mapping is remembered for the next file with these headers.
    const [saved] = admin.callsFor("candidate_import_mappings");
    expect(saved.chain[0]).toEqual({
      method: "upsert",
      args: [
        expect.objectContaining({
          company_id: COMPANY_A.id,
          header_hash: HASH,
          mapping: { columns: ["full_name", "email", "location", "skills", "phone"] },
        }),
        { onConflict: "company_id,header_hash" },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/company/profiles");
    noEmailQueued();
  });

  it("confirms into a job with a stage, a stage map and auto-invite", async () => {
    stages();
    confirms({ created: 2, added_to_job: 2 });
    const result = await confirmSpreadsheetImportAction({
      ...base,
      rows: [{ full_name: "Asha", email: "asha@mail.test", stage: "Onsite" }],
      jobPostId: JOB_A1,
      stageId: STAGE,
      stageMap: { Onsite: ONSITE },
      autoInvite: true,
      duplicateAction: "fill",
      mapping: { headerHash: HASH, columns: ["full_name", "email", "stage"] },
    });

    expect(result).toMatchObject({ ok: true, counts: { created: 2, added_to_job: 2 } });
    expect(rpcArgs("confirm_candidate_import")).toMatchObject({
      p_rows: [{ full_name: "Asha", email: "asha@mail.test", stage: "Onsite" }],
      p_options: {
        attested: true,
        duplicate_action: "fill",
        job_post_id: JOB_A1,
        stage_id: STAGE,
        stage_map: { Onsite: ONSITE },
        auto_invite: true,
      },
    });
    expect(admin.callsFor("candidate_import_mappings")[0].chain[0].args[0]).toMatchObject({
      mapping: { columns: ["full_name", "email", "stage"], stageMap: { Onsite: ONSITE } },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}/applications`);
    noEmailQueued();
  });

  it("refuses a stage that isn't one of the company's open stages", async () => {
    stages();
    expect(
      await confirmSpreadsheetImportAction({ ...base, jobPostId: JOB_A1, stageMap: { Onsite: OTHER_STAGE } }),
    ).toEqual({ ok: false, error: IMPORT_MESSAGES.invalid_stage });
    await signIn();
    stages();
    expect(await confirmSpreadsheetImportAction({ ...base, jobPostId: JOB_A1, stageId: OTHER_STAGE })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.invalid_stage,
    });
    // A stage only makes sense with a job.
    await signIn();
    expect(await confirmSpreadsheetImportAction({ ...base, stageId: STAGE })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.invalid,
    });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("refuses forged rows that fail the schema, with their positions", async () => {
    const result = await confirmSpreadsheetImportAction({
      ...base,
      rows: [
        { full_name: "Fine", email: "fine@mail.test" },
        { full_name: "", email: "x@mail.test" },
        { full_name: "Link", linkedin_url: "javascript:alert(1)" },
        { full_name: "Extra", email_opted_out_at: "2026-01-01" },
        { full_name: "Stage", stage: "Onsite" },
        { full_name: "Action", duplicate_action: "merge" },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/rows aren't valid/),
      rowErrors: [
        { row: 1, errors: { full_name: "Add a name." } },
        { row: 2, errors: { linkedin_url: expect.stringMatching(/http/) } },
        { row: 3, errors: { email_opted_out_at: "Not a candidate field." } },
        // No job destination: no stage.
        { row: 4, errors: { stage: "Not a candidate field." } },
        { row: 5, errors: { duplicate_action: "Not a duplicate action." } },
      ],
    });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("refuses without the attestation, and more than 5,000 rows", async () => {
    expect(await confirmSpreadsheetImportAction({ ...base, attested: false })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.not_attested,
    });
    const rows = Array.from({ length: 5001 }, (_, i) => ({ full_name: `P${i}` }));
    await signIn();
    expect(await confirmSpreadsheetImportAction({ ...base, rows })).toEqual({ ok: false, error: IMPORT_MESSAGES.invalid });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("adds to an existing list, or creates one, which needs talent_lists.manage", async () => {
    confirms({ created: 2, added_to_list: 2 });
    await confirmSpreadsheetImportAction({ ...base, talentListId: LIST });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ talent_list_id: LIST });

    await signIn();
    rls.queue("talent_lists", { data: { id: LIST, name: "Old ATS", slug: "old-ats" }, error: null });
    confirms();
    expect(await confirmSpreadsheetImportAction({ ...base, newListName: "Old ATS" })).toMatchObject({
      ok: true,
      newList: { id: LIST, slug: "old-ats", name: "Old ATS" },
    });
    expect(rls.callsFor("talent_lists")[0].chain[0]).toEqual({
      method: "insert",
      args: [{ company_id: COMPANY_A.id, name: "Old ATS", slug: "old-ats" }],
    });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ talent_list_id: LIST });

    // The list goes again when the import is refused.
    await signIn();
    rls.queue("talent_lists", { data: { id: LIST, name: "Old ATS", slug: "old-ats" }, error: null });
    rls.queueRpc("confirm_candidate_import", { data: { ok: false, reason: "already_confirmed" }, error: null });
    expect(await confirmSpreadsheetImportAction({ ...base, newListName: "Old ATS" })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.already_confirmed,
    });
    expect(rls.callsFor("talent_lists").map((c) => c.chain[0].method)).toEqual(["insert", "delete"]);

    // Both at once isn't a request we make.
    await signIn();
    expect(await confirmSpreadsheetImportAction({ ...base, talentListId: LIST, newListName: "X" })).toMatchObject({
      ok: false,
    });
  });

  it("needs applicants.import for the job, or unscoped without one", async () => {
    await signIn(ASSIGNED_MEMBER);
    stages();
    confirms();
    expect(await confirmSpreadsheetImportAction({ ...base, jobPostId: JOB_A1 })).toMatchObject({ ok: true });

    await signIn(ASSIGNED_MEMBER);
    expect(await confirmSpreadsheetImportAction({ ...base, jobPostId: JOB_A2 })).toMatchObject({ ok: false });
    await signIn(ASSIGNED_MEMBER);
    expect(await confirmSpreadsheetImportAction(base)).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import"),
    });
    await signIn(HIRING_MANAGER_A);
    expect(await confirmSpreadsheetImportAction({ ...base, jobPostId: JOB_A1 })).toMatchObject({ ok: false });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("passes the RPC's refusals through", async () => {
    rls.queueRpc("confirm_candidate_import", { data: { ok: false, reason: "already_confirmed" }, error: null });
    expect(await confirmSpreadsheetImportAction(base)).toEqual({ ok: false, error: IMPORT_MESSAGES.already_confirmed });
    expect(admin.callsFor("candidate_import_mappings")).toHaveLength(0);
  });
});
