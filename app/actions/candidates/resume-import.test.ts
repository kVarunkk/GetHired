import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, memberOf, memberWith, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  assertAllowance,
  getEntitlements,
  getMemberLimit,
  holdEntitlement,
  releaseHold,
} from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createResumeUploadUrlsAction } from "./create-resume-upload-urls";
import { submitResumeBatchAction } from "./submit-resume-batch";
import { importStatusAction } from "./import-status";
import { updateImportRowAction } from "./update-import-row";
import { retryImportRowAction } from "./retry-import-row";
import { removeImportRowAction } from "./remove-import-row";
import { discardResumeImportAction } from "./discard-resume-import";
import { confirmResumeImportAction } from "./confirm-resume-import";
import { importRowFileUrlAction } from "./import-row-file-url";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({
  assertAllowance: vi.fn(),
  holdEntitlement: vi.fn(),
  releaseHold: vi.fn(),
  getEntitlements: vi.fn(),
  getMemberLimit: vi.fn(),
}));

const BATCH = "cb000000-0000-4000-8000-000000000001";
const ROW_1 = "f1000000-0000-4000-8000-000000000001";
const ROW_2 = "f1000000-0000-4000-8000-000000000002";
const STAGE = "90000000-0000-4000-8000-000000000001";
const path = (row: string, ext = "pdf") => `${COMPANY_A.id}/${BATCH}/${row}.${ext}`;
const ASSIGNED_MEMBER = memberOf(COMPANY_A, "member", { assignedJobIds: [JOB_A1] });
/** applicants.import on every job, but no talent_lists.manage. */
const IMPORTER = memberWith(["applicants.import"]);
const LIST = "70000000-0000-4000-8000-000000000001";

let rls: SupabaseMock;
let admin: SupabaseMock;
const storage = { createSignedUploadUrl: vi.fn(), createSignedUrl: vi.fn(), list: vi.fn(), remove: vi.fn() };

async function signIn(member: MemberFixture = OWNER_A) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

const rpcArgs = (fn: string, i = 0) => rls.callsFor(fn)[i]?.chain[0].args[1] as Record<string, unknown>;
const entitlementError = () =>
  new EntitlementError({
    key: "resume_imports",
    kind: "allowance",
    qty: 2,
    used: 24,
    amount: 25,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    reason: "limit_reached",
    suggestedTier: null,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  storage.createSignedUploadUrl.mockImplementation(async (p: string) => ({
    data: { signedUrl: `https://storage.test/upload/${p}?token=t`, token: `token-${p}`, path: p },
    error: null,
  }));
  storage.remove.mockResolvedValue({ data: [], error: null });
  vi.mocked(createServiceRoleClient).mockReturnValue({
    ...admin.client,
    storage: { from: vi.fn(() => storage) },
  } as never);
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) =>
    names.map((n) => (n.toLowerCase() === "bangalore" ? "bengaluru" : n)),
  );
  vi.mocked(assertAllowance).mockResolvedValue(undefined);
  vi.mocked(holdEntitlement).mockResolvedValue(undefined);
  vi.mocked(releaseHold).mockResolvedValue(true);
  await signIn();
});

describe("createResumeUploadUrlsAction (BIT-043, BI-REQ-020)", () => {
  const files = [
    { name: "ada.pdf", size: 1000, type: "application/pdf" },
    {
      name: "bo.docx",
      size: 2000,
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ];
  const started = {
    ok: true,
    batch_id: BATCH,
    rows: [
      { id: ROW_1, file_name: "ada.pdf", file_path: path(ROW_1) },
      { id: ROW_2, file_name: "bo.docx", file_path: path(ROW_2, "docx") },
    ],
  };

  it("starts the batch and signs one upload per path the RPC made", async () => {
    rls.queueRpc("start_resume_import", { data: started, error: null });

    const result = await createResumeUploadUrlsAction({ jobPostId: JOB_A1, files });

    expect(rpcArgs("start_resume_import")).toEqual({ p_job_id: JOB_A1, p_files: [{ name: "ada.pdf" }, { name: "bo.docx" }] });
    expect(storage.createSignedUploadUrl.mock.calls.map((c) => c[0])).toEqual([path(ROW_1), path(ROW_2, "docx")]);
    expect(result).toEqual({
      ok: true,
      batchId: BATCH,
      uploads: [
        { rowId: ROW_1, fileName: "ada.pdf", path: path(ROW_1), token: `token-${path(ROW_1)}` },
        { rowId: ROW_2, fileName: "bo.docx", path: path(ROW_2, "docx"), token: `token-${path(ROW_2, "docx")}` },
      ],
    });
  });

  it("never takes a path from the input", async () => {
    const result = await createResumeUploadUrlsAction({
      jobPostId: JOB_A1,
      files: [{ name: "ada.pdf", size: 10, path: "other-company/x.pdf" }],
    } as never);
    expect(result).toEqual({ ok: false, error: IMPORT_MESSAGES.invalid });
    expect(rls.callsFor("start_resume_import")).toHaveLength(0);
  });

  it.each([
    ["an old .doc", { name: "cv.doc", size: 10, type: "application/msword" }, "cv.doc: Use a PDF or Word (.docx) file."],
    ["a renamed image", { name: "cv.pdf", size: 10, type: "image/png" }, "cv.pdf: Use a PDF or Word (.docx) file."],
    ["an 11 MB file", { name: "big.pdf", size: 11 * 1024 * 1024, type: "application/pdf" }, "big.pdf: Files can be at most 10 MB."],
  ])("refuses %s before anything is created", async (_, file, error) => {
    expect(await createResumeUploadUrlsAction({ jobPostId: JOB_A1, files: [file] })).toEqual({ ok: false, error });
    expect(rls.callsFor("start_resume_import")).toHaveLength(0);
  });

  it("refuses more than 100 files", async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `${i}.pdf`, size: 10 }));
    expect(await createResumeUploadUrlsAction({ jobPostId: JOB_A1, files: many })).toEqual({
      ok: false,
      error: "Import at most 100 resumes at a time.",
    });
  });

  it("passes on the rate limits (BI-SEC-008)", async () => {
    rls.queueRpc("start_resume_import", { data: { ok: false, reason: "import_limit_hour" }, error: null });
    expect(await createResumeUploadUrlsAction({ jobPostId: JOB_A1, files })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.import_limit_hour,
    });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("needs applicants.import for the job", async () => {
    await signIn(ASSIGNED_MEMBER);
    rls.queueRpc("start_resume_import", { data: started, error: null });
    expect(await createResumeUploadUrlsAction({ jobPostId: JOB_A1, files })).toMatchObject({ ok: true });

    await signIn(ASSIGNED_MEMBER);
    expect(await createResumeUploadUrlsAction({ jobPostId: JOB_A2, files })).toMatchObject({ ok: false });
    await signIn(HIRING_MANAGER_A);
    expect(await createResumeUploadUrlsAction({ jobPostId: JOB_A1, files })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import"),
    });
    expect(rls.callsFor("start_resume_import")).toHaveLength(0);
  });

  it("starts a pool batch with no job, for applicants.import unscoped (CP-REQ-002/004)", async () => {
    rls.queueRpc("start_resume_import", { data: started, error: null });
    expect(await createResumeUploadUrlsAction({ files })).toMatchObject({ ok: true, batchId: BATCH });
    expect(rpcArgs("start_resume_import")).toEqual({ p_job_id: null, p_files: [{ name: "ada.pdf" }, { name: "bo.docx" }] });

    await signIn(ASSIGNED_MEMBER);
    expect(await createResumeUploadUrlsAction({ files })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import"),
    });
    expect(rls.callsFor("start_resume_import")).toHaveLength(0);
  });
});

describe("submitResumeBatchAction (BIT-044, BI-REQ-021/022)", () => {
  function queueDraft({ status = "draft", parsing = 0 } = {}) {
    rls.queue("candidate_import_batches", {
      data: { id: BATCH, status, job_post_id: JOB_A1, expires_at: "2026-11-01T00:00:00Z" },
      error: null,
    });
    rls.queue("candidate_import_batches", { data: null, error: null, count: parsing });
    rls.queue("candidate_import_rows", {
      data: [
        { id: ROW_1, file_path: path(ROW_1) },
        { id: ROW_2, file_path: path(ROW_2, "docx") },
      ],
      error: null,
    });
  }

  it("holds one unit per uploaded file and queues only those; a missing file isn't held", async () => {
    queueDraft();
    storage.list.mockResolvedValue({ data: [{ name: `${ROW_1}.pdf` }], error: null });
    rls.queueRpc("submit_resume_batch", { data: { ok: true, queued: 1 }, error: null });

    const result = await submitResumeBatchAction({ batchId: BATCH, autoInvite: true, stageId: STAGE });

    expect(result).toEqual({ ok: true, queued: 1 });
    expect(storage.list).toHaveBeenCalledWith(`${COMPANY_A.id}/${BATCH}`, { limit: 1000 });
    expect(assertAllowance).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", 1, OWNER_A.user.id);
    expect(holdEntitlement).toHaveBeenCalledTimes(1);
    expect(holdEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "resume_imports",
      1,
      { type: "candidate_import_row", id: ROW_1 },
      OWNER_A.user.id,
      { expiresAt: new Date("2026-11-01T00:00:00Z") },
    );
    expect(rpcArgs("submit_resume_batch")).toEqual({
      p_batch_id: BATCH,
      p_row_ids: [ROW_1],
      p_options: { auto_invite: true, stage_id: STAGE },
    });
  });

  it("stores the destination: a pool batch given a job, or a list (CP-REQ-001/003/011)", async () => {
    queueDraft();
    storage.list.mockResolvedValue({ data: [{ name: `${ROW_1}.pdf` }], error: null });
    rls.queueRpc("submit_resume_batch", { data: { ok: true, queued: 1 }, error: null });
    expect(await submitResumeBatchAction({ batchId: BATCH, jobPostId: JOB_A2, talentListId: LIST })).toEqual({
      ok: true,
      queued: 1,
    });
    expect(rpcArgs("submit_resume_batch").p_options).toEqual({
      auto_invite: false,
      stage_id: null,
      job_post_id: JOB_A2,
      talent_list_id: LIST,
    });

    // null: the pool.
    await signIn();
    queueDraft();
    rls.queueRpc("submit_resume_batch", { data: { ok: true, queued: 1 }, error: null });
    await submitResumeBatchAction({ batchId: BATCH, jobPostId: null });
    expect(rpcArgs("submit_resume_batch").p_options).toEqual({ auto_invite: false, stage_id: null, job_post_id: null });
  });

  it("checks the destination's permissions before holding anything (CP-REQ-004)", async () => {
    await signIn(ASSIGNED_MEMBER);
    expect(await submitResumeBatchAction({ batchId: BATCH, jobPostId: JOB_A2 })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import", { forJob: true }),
    });
    await signIn(ASSIGNED_MEMBER);
    expect(await submitResumeBatchAction({ batchId: BATCH, jobPostId: null })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import"),
    });
    await signIn(IMPORTER);
    expect(await submitResumeBatchAction({ batchId: BATCH, talentListId: LIST })).toEqual({
      ok: false,
      error: forbiddenMessage("talent_lists.manage"),
    });
    expect(holdEntitlement).not.toHaveBeenCalled();
    expect(rls.callsFor("submit_resume_batch")).toHaveLength(0);
  });

  it("passes on a forged stage or list, and releases the holds", async () => {
    queueDraft();
    storage.list.mockResolvedValue({ data: [{ name: `${ROW_1}.pdf` }], error: null });
    rls.queueRpc("submit_resume_batch", { data: { ok: false, reason: "invalid_stage" }, error: null });
    expect(await submitResumeBatchAction({ batchId: BATCH, jobPostId: null, stageId: STAGE })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.invalid_stage,
    });
    expect(releaseHold).toHaveBeenCalled();
  });

  it("holds and queues nothing when the allowance is short, and says how many fit", async () => {
    queueDraft();
    storage.list.mockResolvedValue({ data: [{ name: `${ROW_1}.pdf` }, { name: `${ROW_2}.docx` }], error: null });
    vi.mocked(assertAllowance).mockRejectedValue(entitlementError());
    vi.mocked(getEntitlements).mockResolvedValue({
      creditBalance: 0,
      entitlements: { resume_imports: { kind: "allowance", amount: 25, used: 24, held: 0, remaining: 1, overageCredits: null } },
    } as never);
    vi.mocked(getMemberLimit).mockResolvedValue(null);

    const result = await submitResumeBatchAction({ batchId: BATCH });

    expect(result).toEqual({
      ok: false,
      fit: 1,
      total: 2,
      error: "Your plan covers 1 of these 2 resumes. Remove 1 or buy more.",
    });
    expect(holdEntitlement).not.toHaveBeenCalled();
    expect(rls.callsFor("submit_resume_batch")).toHaveLength(0);
  });

  it("releases the holds when the RPC refuses", async () => {
    queueDraft();
    storage.list.mockResolvedValue({ data: [{ name: `${ROW_1}.pdf` }, { name: `${ROW_2}.docx` }], error: null });
    rls.queueRpc("submit_resume_batch", { data: { ok: false, reason: "parsing_limit" }, error: null });

    expect(await submitResumeBatchAction({ batchId: BATCH })).toEqual({ ok: false, error: IMPORT_MESSAGES.parsing_limit });
    expect(vi.mocked(releaseHold).mock.calls.map((c) => c[2])).toEqual([
      { type: "candidate_import_row", id: ROW_1 },
      { type: "candidate_import_row", id: ROW_2 },
    ]);
  });

  it("refuses a second submit and a third parsing batch before holding anything", async () => {
    queueDraft({ status: "parsing" });
    expect(await submitResumeBatchAction({ batchId: BATCH })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.already_submitted,
    });
    await signIn();
    queueDraft({ parsing: 2 });
    expect(await submitResumeBatchAction({ batchId: BATCH })).toEqual({ ok: false, error: IMPORT_MESSAGES.parsing_limit });
    expect(holdEntitlement).not.toHaveBeenCalled();
  });

  it("refuses when nothing reached Storage", async () => {
    queueDraft();
    storage.list.mockResolvedValue({ data: [], error: null });
    expect(await submitResumeBatchAction({ batchId: BATCH })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.no_files_uploaded,
    });
    expect(assertAllowance).not.toHaveBeenCalled();
  });

  it("only reads the session company's batch", async () => {
    rls.queue("candidate_import_batches", { data: null, error: null });
    expect(await submitResumeBatchAction({ batchId: BATCH })).toEqual({ ok: false, error: IMPORT_MESSAGES.not_found });
    expect(rls.callsFor("candidate_import_batches")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
  });
});

describe("importRowFileUrlAction", () => {
  beforeEach(() => {
    storage.createSignedUrl.mockImplementation(async (p: string) => ({
      data: { signedUrl: `https://storage.test/sign/${p}` },
      error: null,
    }));
  });

  it("signs the session company's file through RLS: a PDF to view, a Word file to download", async () => {
    rls.queue("candidate_import_rows", {
      data: { file_path: path(ROW_1), file_name: "ada.pdf", status: "parsed" },
      error: null,
    });
    expect(await importRowFileUrlAction({ rowId: ROW_1 })).toEqual({
      ok: true,
      url: `https://storage.test/sign/${path(ROW_1)}`,
    });
    expect(rls.callsFor("candidate_import_rows")[0].chain).toContainEqual({
      method: "eq",
      args: ["company_id", COMPANY_A.id],
    });
    expect(storage.createSignedUrl).toHaveBeenCalledWith(path(ROW_1), 600, undefined);

    await signIn();
    rls.queue("candidate_import_rows", {
      data: { file_path: path(ROW_2, "docx"), file_name: "bo.docx", status: "queued" },
      error: null,
    });
    await importRowFileUrlAction({ rowId: ROW_2 });
    expect(storage.createSignedUrl).toHaveBeenLastCalledWith(path(ROW_2, "docx"), 600, { download: "bo.docx" });
  });

  it("signs nothing for a row it can't see or that was removed", async () => {
    rls.queue("candidate_import_rows", { data: null, error: null });
    expect(await importRowFileUrlAction({ rowId: ROW_1 })).toEqual({ ok: false, error: IMPORT_MESSAGES.not_found });
    await signIn();
    rls.queue("candidate_import_rows", {
      data: { file_path: path(ROW_1), file_name: "ada.pdf", status: "removed" },
      error: null,
    });
    expect(await importRowFileUrlAction({ rowId: ROW_1 })).toEqual({ ok: false, error: IMPORT_MESSAGES.not_found });
    expect(storage.createSignedUrl).not.toHaveBeenCalled();
  });

  it("needs applicants.import", async () => {
    await signIn(memberWith([]));
    expect(await importRowFileUrlAction({ rowId: ROW_1 })).toMatchObject({ ok: false });
    expect(rls.callsFor("candidate_import_rows")).toHaveLength(0);
  });
});

describe("the review grid's actions (BIT-046)", () => {
  it("importStatusAction returns the rows with edits over what was read", async () => {
    rls.queue("candidate_import_batches", {
      data: { id: BATCH, status: "parsing", job_post_id: JOB_A1, stage_id: null, auto_invite: false, counts: {}, expires_at: "x" },
      error: null,
    });
    rls.queue("candidate_import_rows", {
      data: [
        {
          id: ROW_1,
          file_name: "ada.pdf",
          status: "parsed",
          error_code: null,
          extracted: { fields: { full_name: "Ada", email: "bad" } },
          edited: { email: "ada@mail.test" },
          warnings: [{ field: "email", message: "Enter a valid email address.", value: "bad" }, { field: "phone", message: "x", value: "y" }],
          duplicate_of: null,
          duplicate_action: null,
        },
        { id: ROW_2, file_name: "scan.pdf", status: "failed", error_code: "no_text", extracted: null, edited: null, warnings: [], duplicate_of: null, duplicate_action: null },
      ],
      error: null,
    });

    const result = await importStatusAction({ batchId: BATCH });

    expect(result).toMatchObject({
      ok: true,
      batch: { id: BATCH, status: "parsing", jobPostId: JOB_A1 },
      rows: [
        {
          id: ROW_1,
          fields: { full_name: "Ada", email: "ada@mail.test" },
          // The email warning is answered by the edit.
          warnings: [{ field: "phone", message: "x", value: "y" }],
        },
        { id: ROW_2, status: "failed", errorCode: "no_text", fields: {} },
      ],
    });
  });

  it("updateImportRowAction validates with the candidate schema and keeps earlier edits", async () => {
    expect(await updateImportRowAction({ rowId: ROW_1, fields: { email: "nope", linkedin_url: "ftp://x" } })).toEqual({
      ok: false,
      error: "Fix the highlighted fields.",
      errors: { email: "Enter a valid email address.", linkedin_url: "Use a link starting with http:// or https://." },
    });
    await signIn();
    expect(await updateImportRowAction({ rowId: ROW_1, fields: { password: "x" } })).toMatchObject({ ok: false });

    await signIn();
    rls.queue("candidate_import_rows", { data: { edited: { phone: "123" } }, error: null });
    rls.queueRpc("update_import_row", { data: { ok: true }, error: null });
    expect(
      await updateImportRowAction({ rowId: ROW_1, fields: { email: "Ada@Mail.test", location: "Bangalore" }, duplicateAction: "fill" }),
    ).toEqual({ ok: true });
    expect(rpcArgs("update_import_row")).toEqual({
      p_row_id: ROW_1,
      p_edited: { phone: "123", email: "ada@mail.test", location: "bengaluru" },
      p_duplicate_action: "fill",
    });
  });

  it("retryImportRowAction takes a new hold, and refuses a row that didn't fail", async () => {
    rls.queue("candidate_import_rows", { data: { id: ROW_1, status: "parsed", candidate_import_batches: null }, error: null });
    expect(await retryImportRowAction({ rowId: ROW_1 })).toEqual({ ok: false, error: IMPORT_MESSAGES.not_failed });
    expect(holdEntitlement).not.toHaveBeenCalled();

    await signIn();
    rls.queue("candidate_import_rows", {
      data: { id: ROW_1, status: "failed", candidate_import_batches: { expires_at: "2026-11-01T00:00:00Z" } },
      error: null,
    });
    rls.queueRpc("retry_import_row", { data: { ok: true }, error: null });
    expect(await retryImportRowAction({ rowId: ROW_1 })).toEqual({ ok: true });
    expect(holdEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "resume_imports",
      1,
      { type: "candidate_import_row", id: ROW_1 },
      OWNER_A.user.id,
      { expiresAt: new Date("2026-11-01T00:00:00Z") },
    );
    expect(releaseHold).not.toHaveBeenCalled();
  });

  it("retryImportRowAction releases the new hold when the RPC refuses", async () => {
    rls.queue("candidate_import_rows", { data: { id: ROW_1, status: "failed", candidate_import_batches: null }, error: null });
    rls.queueRpc("retry_import_row", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await retryImportRowAction({ rowId: ROW_1 })).toEqual({ ok: false, error: IMPORT_MESSAGES.forbidden });
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", { type: "candidate_import_row", id: ROW_1 });
  });

  it("removeImportRowAction releases the hold and deletes the file", async () => {
    rls.queueRpc("remove_import_row", { data: { ok: true, file_path: path(ROW_1) }, error: null });
    expect(await removeImportRowAction({ rowId: ROW_1 })).toEqual({ ok: true });
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", { type: "candidate_import_row", id: ROW_1 });
    expect(storage.remove).toHaveBeenCalledWith([path(ROW_1)]);
  });

  it("discardResumeImportAction releases every row's hold and deletes the files", async () => {
    rls.queueRpc("discard_resume_import", {
      data: {
        ok: true,
        rows: [
          { id: ROW_1, file_path: path(ROW_1) },
          { id: ROW_2, file_path: null },
        ],
      },
      error: null,
    });
    expect(await discardResumeImportAction({ batchId: BATCH })).toEqual({ ok: true });
    expect(rls.callsFor("discard_resume_import")).toHaveLength(1);
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", {
      type: "candidate_import_row",
      id: ROW_1,
    });
    expect(releaseHold).toHaveBeenCalledWith(COMPANY_A.id, "resume_imports", {
      type: "candidate_import_row",
      id: ROW_2,
    });
    expect(storage.remove).toHaveBeenCalledWith([path(ROW_1)]);
  });

  it("discardResumeImportAction leaves everything when refused", async () => {
    rls.queueRpc("discard_resume_import", { data: { ok: false, reason: "already_confirmed" }, error: null });
    expect(await discardResumeImportAction({ batchId: BATCH })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.already_confirmed,
    });
    expect(releaseHold).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removeImportRowAction leaves the hold and file when refused", async () => {
    rls.queueRpc("remove_import_row", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await removeImportRowAction({ rowId: ROW_1 })).toEqual({ ok: false, error: IMPORT_MESSAGES.forbidden });
    expect(releaseHold).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe("confirmResumeImportAction (BIT-047, BI-REQ-025)", () => {
  const parsedRows = [
    { id: ROW_1, extracted: { fields: { full_name: "Ada", email: "ada@mail.test" } }, edited: null },
    { id: ROW_2, extracted: { fields: { full_name: "Bo" } }, edited: { email: "bo@mail.test" } },
  ];

  it("confirms, deletes the files no candidate kept and queues no email", async () => {
    rls.queue("candidate_import_rows", { data: parsedRows, error: null });
    rls.queueRpc("confirm_candidate_import", {
      data: {
        ok: true,
        counts: { created: 1, updated: 1, added_to_job: 2, known: 0 },
        delete_paths: [`${COMPANY_A.id}/old/bo.pdf`],
      },
      error: null,
    });
    rls.queue("candidate_import_batches", { data: { job_post_id: JOB_A1 }, error: null });

    const result = await confirmResumeImportAction({
      batchId: BATCH,
      stageId: STAGE,
      duplicateAction: "skip",
      rowActions: [{ rowId: ROW_2, duplicateAction: "overwrite" }],
      autoInvite: true,
      attested: true,
      lawfulBasisNote: "applied by email",
    });

    expect(result).toMatchObject({ ok: true, jobPostId: JOB_A1, counts: { created: 1, updated: 1, added_to_job: 2 } });
    expect(rpcArgs("confirm_candidate_import")).toEqual({
      p_batch_id: BATCH,
      p_rows: [{ row_id: ROW_2, duplicate_action: "overwrite" }],
      p_options: {
        stage_id: STAGE,
        duplicate_action: "skip",
        auto_invite: true,
        attested: true,
        lawful_basis_note: "applied by email",
      },
    });
    expect(storage.remove).toHaveBeenCalledWith([`${COMPANY_A.id}/old/bo.pdf`]);
    expect([...rls.calls, ...admin.calls].filter((c) => c.schema === "pgmq_public")).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}`, "layout");
  });

  it("needs the attestation", async () => {
    expect(await confirmResumeImportAction({ batchId: BATCH, attested: false })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.not_attested,
    });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("refuses a row that fails the candidate schema", async () => {
    rls.queue("candidate_import_rows", {
      data: [parsedRows[0], { id: ROW_2, extracted: { fields: { full_name: "Bo" } }, edited: { email: "not an email" } }],
      error: null,
    });
    expect(await confirmResumeImportAction({ batchId: BATCH, attested: true })).toEqual({
      ok: false,
      error: "Fix the highlighted rows first.",
      rowIds: [ROW_2],
    });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("sends only the ticked rows, and doesn't check the unticked ones", async () => {
    rls.queue("candidate_import_rows", {
      data: [
        parsedRows[0],
        { id: ROW_2, extracted: { fields: { full_name: "Bo" } }, edited: { email: "not an email" } },
      ],
      error: null,
    });
    rls.queueRpc("confirm_candidate_import", {
      data: { ok: true, counts: { created: 1 }, delete_paths: [`${COMPANY_A.id}/${BATCH}/${ROW_2}.pdf`] },
      error: null,
    });
    rls.queue("candidate_import_batches", { data: { job_post_id: JOB_A1 }, error: null });

    const result = await confirmResumeImportAction({ batchId: BATCH, rowIds: [ROW_1], attested: true });

    expect(result).toMatchObject({ ok: true });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ row_ids: [ROW_1] });
    // The unticked row's file comes back from the RPC to be deleted.
    expect(storage.remove).toHaveBeenCalledWith([`${COMPANY_A.id}/${BATCH}/${ROW_2}.pdf`]);
  });

  it("refuses an empty selection", async () => {
    expect(await confirmResumeImportAction({ batchId: BATCH, rowIds: [], attested: true })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.invalid,
    });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("confirms into the pool, a row without an email included, and queues no email (CP-REQ-002/005)", async () => {
    rls.queue("candidate_import_rows", {
      data: [parsedRows[0], { id: ROW_2, extracted: { fields: { full_name: "Bo" } }, edited: null }],
      error: null,
    });
    rls.queueRpc("confirm_candidate_import", { data: { ok: true, counts: { created: 2 }, delete_paths: [] }, error: null });
    rls.queue("candidate_import_batches", { data: { job_post_id: null, talent_lists: null }, error: null });

    expect(await confirmResumeImportAction({ batchId: BATCH, jobPostId: null, attested: true })).toMatchObject({
      ok: true,
      jobPostId: null,
      list: null,
      counts: { created: 2 },
    });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ job_post_id: null, attested: true });
    expect([...rls.calls, ...admin.calls].filter((c) => c.schema === "pgmq_public")).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/company/candidates");
  });

  it("creates a new list for the import, and drops it when refused (CP-REQ-003)", async () => {
    rls.queue("candidate_import_rows", { data: [parsedRows[0]], error: null });
    rls.queue("talent_lists", { data: { id: LIST, name: "Old ATS", slug: "old-ats" }, error: null });
    rls.queueRpc("confirm_candidate_import", {
      data: { ok: true, counts: { created: 1, added_to_list: 1 }, delete_paths: [] },
      error: null,
    });
    rls.queue("candidate_import_batches", { data: { job_post_id: null, talent_lists: null }, error: null });
    expect(await confirmResumeImportAction({ batchId: BATCH, newListName: "Old ATS", attested: true })).toMatchObject({
      ok: true,
      list: { id: LIST, slug: "old-ats", name: "Old ATS" },
      counts: { added_to_list: 1 },
    });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ talent_list_id: LIST });

    await signIn();
    rls.queue("candidate_import_rows", { data: [parsedRows[0]], error: null });
    rls.queue("talent_lists", { data: { id: LIST, name: "Old ATS", slug: "old-ats" }, error: null });
    rls.queueRpc("confirm_candidate_import", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await confirmResumeImportAction({ batchId: BATCH, newListName: "Old ATS", attested: true })).toMatchObject({
      ok: false,
    });
    expect(rls.callsFor("talent_lists").map((c) => c.chain[0].method)).toEqual(["insert", "delete"]);
  });

  it("needs talent_lists.manage for a list, and applicants.import for the destination (CP-REQ-004)", async () => {
    await signIn(IMPORTER);
    expect(await confirmResumeImportAction({ batchId: BATCH, talentListId: LIST, attested: true })).toEqual({
      ok: false,
      error: forbiddenMessage("talent_lists.manage"),
    });
    await signIn(ASSIGNED_MEMBER);
    expect(await confirmResumeImportAction({ batchId: BATCH, jobPostId: JOB_A2, attested: true })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import", { forJob: true }),
    });
    await signIn(ASSIGNED_MEMBER);
    expect(await confirmResumeImportAction({ batchId: BATCH, jobPostId: null, attested: true })).toEqual({
      ok: false,
      error: forbiddenMessage("applicants.import"),
    });
    expect(rls.callsFor("confirm_candidate_import")).toHaveLength(0);
  });

  it("passes back the rows missing an email", async () => {
    rls.queue("candidate_import_rows", { data: [parsedRows[0]], error: null });
    rls.queueRpc("confirm_candidate_import", {
      data: { ok: false, reason: "missing_email", row_ids: [ROW_2] },
      error: null,
    });
    expect(await confirmResumeImportAction({ batchId: BATCH, attested: true })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.missing_email,
      rowIds: [ROW_2],
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });
});
