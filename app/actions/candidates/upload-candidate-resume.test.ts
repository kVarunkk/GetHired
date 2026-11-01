import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertAllowance, consumeEntitlement } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { extractResumeText } from "@/helpers/resume/extract-text";
import { parseCandidateResume } from "@/helpers/candidates/parse-candidate-resume";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { sendScreeningMessages } from "@/helpers/matching/enqueue-screenings";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { createCandidateResumeUploadAction, uploadCandidateResumeAction } from "./upload-candidate-resume";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertAllowance: vi.fn(), consumeEntitlement: vi.fn() }));
vi.mock("@/helpers/matching/enqueue-screenings", () => ({ sendScreeningMessages: vi.fn() }));
vi.mock("@/helpers/resume/extract-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/resume/extract-text")>()),
  extractResumeText: vi.fn(),
}));
vi.mock("@/helpers/candidates/parse-candidate-resume", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/candidates/parse-candidate-resume")>()),
  parseCandidateResume: vi.fn(),
}));

const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const FILE_ID = "0f000000-0000-4000-8000-000000000001";
const PATH = `${COMPANY_A.id}/candidates/${CANDIDATE}/${FILE_ID}.pdf`;
const OLD_PATH = `${COMPANY_A.id}/b1/old.pdf`;
const APP_OPEN = "e0000000-0000-4000-8000-000000000001";
const RESUME = { sections: [{ type: "experience", items: [] }] };

let rls: SupabaseMock;
let admin: SupabaseMock;
const storage = { createSignedUploadUrl: vi.fn(), download: vi.fn(), remove: vi.fn() };

async function signIn(member: MemberFixture = OWNER_A) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue({ ...admin.client, storage: { from: () => storage } } as never);
  storage.createSignedUploadUrl.mockImplementation(async (p: string) => ({ data: { token: `t:${p}` }, error: null }));
  storage.download.mockResolvedValue({ data: new Blob([new Uint8Array([1])]), error: null });
  storage.remove.mockResolvedValue({ data: [], error: null });
  vi.mocked(extractResumeText).mockResolvedValue({ type: "pdf", lines: ["Ada"] });
  vi.mocked(parseCandidateResume).mockResolvedValue({
    ok: true,
    fields: { full_name: "Ada L", current_title: "Engineer", location: "Bangalore" },
    resume: RESUME as never,
    warnings: [{ field: "email", message: "Enter a valid email address.", value: "x" }],
  });
  vi.mocked(canonicalizeLocations).mockImplementation(async (n) => n.map((x) => x.toLowerCase()));
  vi.mocked(assertAllowance).mockResolvedValue(undefined);
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
  await signIn();
});

describe("createCandidateResumeUploadAction (BIT-049)", () => {
  it("signs an upload in the candidate's folder of the session company", async () => {
    rls.queue("company_candidates", { data: { id: CANDIDATE }, error: null });
    const result = await createCandidateResumeUploadAction({
      candidateId: CANDIDATE,
      file: { name: "Ada CV.docx", size: 1000 },
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.path).toMatch(new RegExp(`^${COMPANY_A.id}/candidates/${CANDIDATE}/[0-9a-f-]{36}\\.docx$`));
    expect(rls.callsFor("company_candidates")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("refuses a candidate they can't see, and a bad file", async () => {
    rls.queue("company_candidates", { data: null, error: null });
    expect(await createCandidateResumeUploadAction({ candidateId: CANDIDATE, file: { name: "a.pdf", size: 1 } })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.not_found,
    });
    await signIn();
    expect(await createCandidateResumeUploadAction({ candidateId: CANDIDATE, file: { name: "a.doc", size: 1 } })).toEqual({
      ok: false,
      error: "Use a PDF or Word (.docx) file.",
    });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("uploadCandidateResumeAction (BIT-049, BI-REQ-008)", () => {
  function queueAttach(result: Record<string, unknown> = { ok: true, replaced_path: OLD_PATH, application_ids: [APP_OPEN] }) {
    rls.queueRpc("set_company_candidate_resume", { data: result, error: null });
    admin.queue("applications", { data: [{ id: APP_OPEN, job_post_id: "j1" }], error: null });
  }

  it("fills empty fields only, charges once, deletes the old file and re-screens open applications", async () => {
    queueAttach();

    const result = await uploadCandidateResumeAction({ candidateId: CANDIDATE, path: PATH });

    expect(result).toEqual({
      ok: true,
      rescreened: 1,
      warnings: [{ field: "email", message: "Enter a valid email address.", value: "x" }],
    });
    // The RPC fills only empty fields; the action passes what was read.
    expect(rls.callsFor("set_company_candidate_resume")[0].chain[0].args[1]).toEqual({
      p_candidate_id: CANDIDATE,
      p_path: PATH,
      p_content: RESUME,
      p_fields: { full_name: "Ada L", current_title: "Engineer", location: "bangalore" },
    });
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "resume_imports",
      1,
      { type: "candidate_resume", id: PATH },
      OWNER_A.user.id,
    );
    expect(storage.remove).toHaveBeenCalledWith([OLD_PATH]);
    // The RPC returns only open applications (not Rejected or Hired).
    expect(admin.callsFor("applications")[0].chain).toContainEqual({ method: "in", args: ["id", [APP_OPEN]] });
    const upsert = admin.callsFor("application_screenings")[0].chain.find((c) => c.method === "upsert")!;
    expect(upsert.args[0]).toEqual([
      expect.objectContaining({ application_id: APP_OPEN, status: "queued", requested_by: OWNER_A.user.id }),
    ]);
    expect(sendScreeningMessages).toHaveBeenCalledWith(expect.anything(), [APP_OPEN]);
    expect(revalidatePath).toHaveBeenCalledWith(`/company/candidates/${CANDIDATE}`, "layout");
  });

  it("refuses a path outside the candidate's folder", async () => {
    for (const path of [
      `${COMPANY_B.id}/candidates/${CANDIDATE}/${FILE_ID}.pdf`,
      `${COMPANY_A.id}/candidates/other/${FILE_ID}.pdf`,
      `${COMPANY_A.id}/candidates/${CANDIDATE}/../x/${FILE_ID}.pdf`,
    ]) {
      await signIn();
      expect(await uploadCandidateResumeAction({ candidateId: CANDIDATE, path })).toEqual({
        ok: false,
        error: IMPORT_MESSAGES.invalid,
      });
    }
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("charges nothing for a file with no text, and deletes it", async () => {
    vi.mocked(parseCandidateResume).mockResolvedValue({ ok: false, reason: "no_text" });
    expect(await uploadCandidateResumeAction({ candidateId: CANDIDATE, path: PATH })).toEqual({
      ok: false,
      error: "No text found: is it a scan?",
    });
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
    expect(rls.callsFor("set_company_candidate_resume")).toHaveLength(0);
  });

  it("charges nothing when the RPC refuses, and deletes the file", async () => {
    rls.queueRpc("set_company_candidate_resume", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await uploadCandidateResumeAction({ candidateId: CANDIDATE, path: PATH })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.forbidden,
    });
    expect(consumeEntitlement).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("checks the allowance before reading the file", async () => {
    vi.mocked(assertAllowance).mockRejectedValue(
      new EntitlementError({
        key: "resume_imports",
        kind: "allowance",
        qty: 1,
        used: 25,
        amount: 25,
        overageCredits: null,
        creditBalance: 0,
        creditsNeeded: 0,
        reason: "limit_reached",
        suggestedTier: null,
      }),
    );
    const result = await uploadCandidateResumeAction({ candidateId: CANDIDATE, path: PATH });
    expect(result).toMatchObject({ error: { code: "entitlement", key: "resume_imports" } });
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("needs applicants.import", async () => {
    await signIn(HIRING_MANAGER_A);
    expect(await uploadCandidateResumeAction({ candidateId: CANDIDATE, path: PATH })).toMatchObject({ ok: false });
    expect(storage.download).not.toHaveBeenCalled();
  });
});
