import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, MEMBER_A, OWNER_A } from "@/test/utils/team";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { setJobPostingStatusAction } from "./set-job-posting-status";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertLimit: vi.fn() }));

const POST = jobPostingOf(COMPANY_A, { status: "inactive" });

let rls: SupabaseMock;

const OK = { data: { ok: true, job_id: POST.job_id, changed: true }, error: null };
/** The statuses passed to set_job_post_status (SM-REQ-007). */
const statusCalls = () =>
  rls.callsFor("set_job_post_status").map((c) => (c.chain[0].args[1] as { p_status: string }).p_status);

async function signIn(user = COMPANY_A.user, posting: unknown = POST) {
  rls = createSupabaseMock({ user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  rls.queue("job_postings", { data: posting, error: null });
  rls.queueRpc("set_job_post_status", OK);
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
});

describe("setJobPostingStatusAction", () => {
  it("refuses a member closing a job (TM-REQ-004)", async () => {
    rls = createSupabaseMock({ user: MEMBER_A.user });
    rls.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    await setRequestUser(MEMBER_A.user, rls.client);

    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "inactive" })).toEqual({
      ok: false,
      error: "Your role can't open, pause or close job posts.",
    });
    expect(statusCalls()).toEqual([]);
  });

  it("lets an admin activate a job", async () => {
    rls = createSupabaseMock({ user: ADMIN_A.user });
    rls.queueRpc("my_company_access", { data: ADMIN_A.membership, error: null });
    rls.queue("job_postings", { data: POST, error: null });
    rls.queueRpc("set_job_post_status", OK);
    await setRequestUser(ADMIN_A.user, rls.client);

    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" })).toEqual({ ok: true });
    expect(statusCalls()).toEqual(["active"]);
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" })).toMatchObject({ ok: false });
    expect(statusCalls()).toEqual([]);
  });

  it("treats another company's posting as not found", async () => {
    await signIn(COMPANY_A.user, null);
    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
    const lookup = rls.callsFor("job_postings")[0].chain;
    expect(lookup).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("checks the limit before activating, then sets the posting and listing in one call", async () => {
    const res = await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" });

    expect(res).toEqual({ ok: true });
    expect(assertLimit).toHaveBeenCalledWith(COMPANY_A.id, "active_job_posts");
    expect(statusCalls()).toEqual(["active"]);
    expect(revalidateTag).toHaveBeenCalledWith(`job-${POST.job_id}`);
  });

  it("returns the entitlement error at the limit and changes nothing", async () => {
    vi.mocked(assertLimit).mockRejectedValue(
      new EntitlementError({
        key: "active_job_posts",
        kind: "limit",
        qty: 1,
        used: 2,
        amount: 2,
        overageCredits: null,
        creditBalance: 0,
        creditsNeeded: 0,
        reason: "limit_reached",
        suggestedTier: null,
      }),
    );

    const res = await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" });

    expect(res).toMatchObject({ ok: false, error: { code: "entitlement", key: "active_job_posts" } });
    expect(statusCalls()).toEqual([]);
  });

  it("deactivates without checking the limit", async () => {
    await signIn(COMPANY_A.user, { ...POST, status: "active" });

    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "inactive" })).toEqual({ ok: true });
    expect(assertLimit).not.toHaveBeenCalled();
    expect(statusCalls()).toEqual(["inactive"]);
  });
});
