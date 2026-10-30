import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, memberOf, memberWith, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { canonicalizeLocations } from "@/helpers/locations/aliases";
import { IMPORT_MESSAGES } from "@/helpers/candidates/copy";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createCandidateAction } from "./create-candidate";
import { checkCandidateEmailAction } from "./check-candidate-email";
import { updateCandidateAction } from "./update-candidate";
import { deleteCandidatesAction } from "./delete-candidates";
import { addCandidatesToJobAction } from "./add-candidates-to-job";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/locations/aliases", () => ({ canonicalizeLocations: vi.fn() }));

const BATCH = "cb000000-0000-4000-8000-000000000001";
const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
const OTHER = "cc000000-0000-4000-8000-000000000002";
const STAGE = "90000000-0000-4000-8000-000000000001";
const KNOWN_USER = "a0000000-0000-4000-8000-000000000001";
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

/** No existing candidate or known user; the batch starts and confirms. */
function freshEmail() {
  admin.queue("company_candidates", { data: null, error: null });
  rls.queueRpc("match_known_applicants", { data: [], error: null });
}
function confirms(candidateIds = [CANDIDATE]) {
  rls.queueRpc("start_candidate_import", { data: { ok: true, batch_id: BATCH }, error: null });
  rls.queueRpc("confirm_candidate_import", {
    data: { ok: true, batch_id: BATCH, counts: { created: 1, added_to_job: 1 }, candidate_ids: candidateIds },
    error: null,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client);
  vi.mocked(canonicalizeLocations).mockImplementation(async (names) =>
    names.map((n) => (n.toLowerCase() === "bangalore" ? "bengaluru" : n)),
  );
  await signIn();
});

describe("createCandidateAction (BI-REQ-009/016)", () => {
  const base = { full_name: "Meera Iyer", email: "Meera@Mail.test", attested: true as const };

  it("adds a candidate to the pool as a one-row batch, attested, with no one emailed", async () => {
    freshEmail();
    confirms();

    const result = await createCandidateAction({ ...base, location: "Bangalore", lawfulBasisNote: "referral" });

    expect(result).toEqual({ ok: true, candidateId: CANDIDATE, addedToJob: false });
    expect(rpcArgs("start_candidate_import")).toEqual({ p_kind: "spreadsheet" });
    expect(rpcArgs("confirm_candidate_import")).toEqual({
      p_batch_id: BATCH,
      p_rows: [expect.objectContaining({ full_name: "Meera Iyer", email: "meera@mail.test", location: "bengaluru" })],
      p_options: { attested: true, lawful_basis_note: "referral", duplicate_action: "skip" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/company/profiles");
    // No email is ever queued by adding a candidate.
    expect(rls.calls.filter((c) => c.schema === "pgmq_public")).toEqual([]);
  });

  it("adds them to a job and stage, and needs an email for that", async () => {
    expect(await createCandidateAction({ ...base, email: "", jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.no_email,
      errors: { email: IMPORT_MESSAGES.no_email },
    });
    expect(rls.callsFor("start_candidate_import")).toHaveLength(0);

    await signIn();
    freshEmail();
    confirms();
    const result = await createCandidateAction({ ...base, jobPostId: JOB_A1, stageId: STAGE });

    expect(result).toEqual({ ok: true, candidateId: CANDIDATE, addedToJob: true });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ job_post_id: JOB_A1, stage_id: STAGE });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}/applications`);
  });

  it("adds them to a talent list, with or without a job (CPT-017, CP-REQ-003)", async () => {
    const LIST = "70000000-0000-4000-8000-000000000001";
    freshEmail();
    confirms();
    expect(await createCandidateAction({ ...base, talentListId: LIST })).toMatchObject({ ok: true });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ talent_list_id: LIST });
    expect(rpcArgs("confirm_candidate_import").p_options).not.toHaveProperty("job_post_id");

    await signIn();
    freshEmail();
    confirms();
    rls.queue("talent_lists", { data: { id: LIST, name: "Referrals", slug: "referrals" }, error: null });
    expect(await createCandidateAction({ ...base, jobPostId: JOB_A1, newListName: "Referrals" })).toMatchObject({
      ok: true,
    });
    expect(rpcArgs("confirm_candidate_import").p_options).toMatchObject({ talent_list_id: LIST, job_post_id: JOB_A1 });

    // The new list goes again when the candidate isn't added.
    await signIn();
    freshEmail();
    rls.queueRpc("start_candidate_import", { data: { ok: true, batch_id: BATCH }, error: null });
    rls.queueRpc("confirm_candidate_import", { data: { ok: false, reason: "rate_limited" }, error: null });
    rls.queue("talent_lists", { data: { id: LIST, name: "Referrals", slug: "referrals" }, error: null });
    expect(await createCandidateAction({ ...base, newListName: "Referrals" })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.rate_limited,
    });
    expect(rls.callsFor("talent_lists").map((c) => c.chain[0].method)).toEqual(["insert", "delete"]);
  });

  it("needs talent_lists.manage for a list", async () => {
    await signIn(memberWith(["applicants.import"]));
    expect(
      await createCandidateAction({ ...base, talentListId: "70000000-0000-4000-8000-000000000001" }),
    ).toEqual({ ok: false, error: forbiddenMessage("talent_lists.manage") });
    expect(rls.callsFor("start_candidate_import")).toHaveLength(0);
  });

  it("refuses without the lawful-basis attestation", async () => {
    const result = await createCandidateAction({ ...base, attested: false as never });
    expect(result).toEqual({ ok: false, error: IMPORT_MESSAGES.not_attested });
    expect(rls.callsFor("start_candidate_import")).toHaveLength(0);
  });

  it("returns field errors, and refuses unknown fields (.strict())", async () => {
    expect(await createCandidateAction({ ...base, email: "nope" })).toMatchObject({
      ok: false,
      errors: { email: "Enter a valid email address." },
    });
    expect(await createCandidateAction({ ...base, email_opted_out_at: "2026-01-01" } as never)).toMatchObject({
      ok: false,
    });
    expect(rls.callsFor("start_candidate_import")).toHaveLength(0);
  });

  it("points to an existing candidate with the same email instead of adding a duplicate", async () => {
    admin.queue("company_candidates", { data: { id: OTHER }, error: null });

    expect(await createCandidateAction(base)).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.duplicate_email,
      existing: { kind: "candidate", id: OTHER, href: `/company/candidates/${OTHER}` },
    });
    const [lookup] = admin.callsFor("company_candidates");
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(lookup.chain).toContainEqual({ method: "eq", args: ["email", "meera@mail.test"] });
    expect(rls.callsFor("start_candidate_import")).toHaveLength(0);
  });

  it("points to a GetHired user already in the pipeline", async () => {
    admin.queue("company_candidates", { data: null, error: null });
    rls.queueRpc("match_known_applicants", {
      data: [{ email: "meera@mail.test", user_id: KNOWN_USER, full_name: "Meera" }],
      error: null,
    });

    expect(await createCandidateAction(base)).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.known_user,
      existing: { kind: "user", id: KNOWN_USER, href: `/company/profiles/${KNOWN_USER}` },
    });
  });

  it("passes the RPC's reason through (rate limit)", async () => {
    freshEmail();
    rls.queueRpc("start_candidate_import", { data: { ok: false, reason: "rate_limited" }, error: null });

    expect(await createCandidateAction(base)).toEqual({ ok: false, error: IMPORT_MESSAGES.rate_limited });
  });

  it("checks applicants.import for the job: unscoped without one", async () => {
    // Assigned to JOB_A1 only: fine there, refused elsewhere and without a job.
    await signIn(ASSIGNED_MEMBER);
    expect(await createCandidateAction({ ...base, jobPostId: JOB_A2 })).toMatchObject({ ok: false });
    await signIn(ASSIGNED_MEMBER);
    expect(await createCandidateAction(base)).toMatchObject({ ok: false });
    await signIn(HIRING_MANAGER_A);
    expect(await createCandidateAction({ ...base, jobPostId: JOB_A1 })).toMatchObject({ ok: false });
    expect(admin.calls).toHaveLength(0);

    await signIn(ASSIGNED_MEMBER);
    freshEmail();
    confirms();
    expect(await createCandidateAction({ ...base, jobPostId: JOB_A1 })).toMatchObject({ ok: true });
  });
});

describe("checkCandidateEmailAction (BI-REQ-009)", () => {
  it("finds an existing candidate, then a known user, else nothing", async () => {
    admin.queue("company_candidates", { data: { id: OTHER }, error: null });
    expect(await checkCandidateEmailAction({ email: "A@Mail.test" })).toEqual({
      ok: true,
      existing: { kind: "candidate", id: OTHER, href: `/company/candidates/${OTHER}` },
    });

    await signIn();
    admin.queue("company_candidates", { data: null, error: null });
    rls.queueRpc("match_known_applicants", {
      data: [{ email: "a@mail.test", user_id: KNOWN_USER, full_name: "A" }],
      error: null,
    });
    expect(await checkCandidateEmailAction({ email: "a@mail.test" })).toEqual({
      ok: true,
      existing: { kind: "user", id: KNOWN_USER, href: `/company/profiles/${KNOWN_USER}` },
    });
    expect(rpcArgs("match_known_applicants")).toEqual({ p_emails: ["a@mail.test"] });

    await signIn();
    freshEmail();
    expect(await checkCandidateEmailAction({ email: "a@mail.test" })).toEqual({ ok: true, existing: null });
  });

  it("looks nothing up for an invalid email, or without applicants.import", async () => {
    expect(await checkCandidateEmailAction({ email: "nope" })).toEqual({ ok: true, existing: null });
    await signIn(HIRING_MANAGER_A);
    expect(await checkCandidateEmailAction({ email: "a@mail.test" })).toMatchObject({ ok: false });
    expect(admin.calls).toHaveLength(0);
  });
});

describe("updateCandidateAction (BI-REQ-004)", () => {
  it("sends only the changed fields, with the location canonicalised", async () => {
    rls.queueRpc("update_company_candidate", { data: { ok: true }, error: null });

    expect(
      await updateCandidateAction({ candidateId: CANDIDATE, fields: { location: "Bangalore", skills: "Go, SQL" } }),
    ).toEqual({ ok: true });
    expect(rpcArgs("update_company_candidate")).toEqual({
      p_candidate_id: CANDIDATE,
      p_fields: { location: "bengaluru", skills: ["Go", "SQL"] },
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/candidates/${CANDIDATE}`, "layout");
  });

  it("maps a taken email, and can't touch the opt-out or claim columns", async () => {
    rls.queueRpc("update_company_candidate", { data: { ok: false, reason: "duplicate_email" }, error: null });
    expect(await updateCandidateAction({ candidateId: CANDIDATE, fields: { email: "a@mail.test" } })).toEqual({
      ok: false,
      error: IMPORT_MESSAGES.duplicate_email,
    });

    for (const key of ["email_opted_out_at", "claimed_user_id", "company_id"]) {
      await signIn();
      expect(
        await updateCandidateAction({ candidateId: CANDIDATE, fields: { [key]: "x" } as never }),
      ).toMatchObject({ ok: false });
      expect(rls.callsFor("update_company_candidate")).toHaveLength(0);
    }
  });

  it("is refused without applicants.import", async () => {
    await signIn(HIRING_MANAGER_A);
    expect(await updateCandidateAction({ candidateId: CANDIDATE, fields: { full_name: "A" } })).toMatchObject({
      ok: false,
    });
  });
});

describe("deleteCandidatesAction (BI-REQ-007)", () => {
  it("deletes up to 200 and reports how many", async () => {
    rls.queueRpc("delete_company_candidates", { data: { ok: true, deleted: 2, resume_paths: [] }, error: null });

    expect(await deleteCandidatesAction({ candidateIds: [CANDIDATE, OTHER] })).toEqual({ ok: true, deleted: 2 });
    expect(rpcArgs("delete_company_candidates")).toEqual({ p_candidate_ids: [CANDIDATE, OTHER] });
    expect(revalidatePath).toHaveBeenCalledWith("/company/profiles");
  });

  it("deletes their resume files (BIT-049)", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    vi.mocked(createServiceRoleClient).mockReturnValue({ ...admin.client, storage: { from: () => ({ remove }) } } as never);
    const files = [`${COMPANY_A.id}/b1/r1.pdf`, `${COMPANY_A.id}/candidates/${CANDIDATE}/r2.docx`];
    rls.queueRpc("delete_company_candidates", { data: { ok: true, deleted: 1, resume_paths: files }, error: null });

    expect(await deleteCandidatesAction({ candidateIds: [CANDIDATE] })).toEqual({ ok: true, deleted: 1 });
    expect(remove).toHaveBeenCalledWith(files);
  });

  it("refuses more than 200 and needs applicants.import for every job", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `cc000000-0000-4000-8000-${i.toString().padStart(12, "0")}`);
    expect(await deleteCandidatesAction({ candidateIds: ids })).toMatchObject({ ok: false });

    await signIn(ASSIGNED_MEMBER);
    expect(await deleteCandidatesAction({ candidateIds: [CANDIDATE] })).toMatchObject({ ok: false });
    expect(rls.callsFor("delete_company_candidates")).toHaveLength(0);
  });
});

describe("addCandidatesToJobAction (BI-REQ-005)", () => {
  it("passes the counts through and refreshes the job", async () => {
    rls.queueRpc("add_candidates_to_job", {
      data: { ok: true, counts: { added_to_job: 1, already_in_job: 1, no_email: 0, not_found: 0 } },
      error: null,
    });

    const result = await addCandidatesToJobAction({ jobPostId: JOB_A1, candidateIds: [CANDIDATE, OTHER] });

    expect(result).toEqual({
      ok: true,
      counts: expect.objectContaining({ added_to_job: 1, already_in_job: 1, no_email: 0, not_found: 0 }),
    });
    expect(rpcArgs("add_candidates_to_job")).toEqual({
      p_job_id: JOB_A1,
      p_candidate_ids: [CANDIDATE, OTHER],
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}/applications`);
  });

  it("needs applicants.import for that job", async () => {
    await signIn(ASSIGNED_MEMBER);
    expect(await addCandidatesToJobAction({ jobPostId: JOB_A2, candidateIds: [CANDIDATE] })).toMatchObject({
      ok: false,
    });
    await signIn(MEMBER_A);
    expect(await addCandidatesToJobAction({ jobPostId: JOB_A1, candidateIds: [CANDIDATE] })).toMatchObject({
      ok: false,
    });
    expect(rls.callsFor("add_candidates_to_job")).toHaveLength(0);
  });
});
