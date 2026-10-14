import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidateTag } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, jobPostingOf } from "@/test/utils/recruiter";
import { setJobPostingStatusAction } from "./set-job-posting-status";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertLimit: vi.fn() }));

const POST = jobPostingOf(COMPANY_A, { status: "inactive" });

let rls: SupabaseMock;
let service: SupabaseMock;

const updates = (table: string) =>
  service.callsFor(table).filter((c) => c.chain.some((m) => m.method === "update"));

async function signIn(user = COMPANY_A.user, posting: unknown = POST) {
  rls = createSupabaseMock({ user });
  rls.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  rls.queue("job_postings", { data: posting, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await signIn();
});

describe("setJobPostingStatusAction", () => {
  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" })).toMatchObject({ ok: false });
    expect(service.calls).toHaveLength(0);
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

  it("checks the limit before activating, then updates the posting and listing", async () => {
    const res = await setJobPostingStatusAction({ jobPostingId: POST.id, status: "active" });

    expect(res).toEqual({ ok: true });
    expect(assertLimit).toHaveBeenCalledWith(COMPANY_A.id, "active_job_posts");
    expect(updates("job_postings")[0].chain[0].args[0]).toMatchObject({ status: "active" });
    expect(updates("all_jobs")[0].chain[0].args[0]).toEqual({ status: "active" });
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
    expect(service.calls).toHaveLength(0);
  });

  it("deactivates without checking the limit", async () => {
    await signIn(COMPANY_A.user, { ...POST, status: "active" });

    expect(await setJobPostingStatusAction({ jobPostingId: POST.id, status: "inactive" })).toEqual({ ok: true });
    expect(assertLimit).not.toHaveBeenCalled();
    expect(updates("job_postings")[0].chain[0].args[0]).toMatchObject({ status: "inactive" });
  });
});
