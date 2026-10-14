import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { cancelAtPeriodEnd } from "@/helpers/billing/dodo";
import { getCompanySubscription, type CompanySubscription } from "@/helpers/billing/subscription";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { resumeCompanyPlanAction } from "./resume-company-plan";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/dodo", () => ({ cancelAtPeriodEnd: vi.fn() }));
vi.mock("@/helpers/billing/subscription", () => ({ getCompanySubscription: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const SUB: CompanySubscription = {
  dodoSubscriptionId: "sub_1",
  dodoCustomerId: "cus_1",
  billingInterval: "month",
  currency: "USD",
  status: "active",
  cancelAtPeriodEnd: true,
  currentPeriodEnd: "2026-11-01T00:00:00Z",
};

let rls: SupabaseMock;
let service: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  rls = createSupabaseMock({ user });
  rls.queue("company_info", { data: COMPANY_A.info, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(getCompanySubscription).mockResolvedValue(SUB);
  await signIn();
});

describe("resumeCompanyPlanAction", () => {
  it("refuses applicants", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect(await resumeCompanyPlanAction()).toMatchObject({ ok: false });
  });

  it("clears the cancellation in Dodo and here", async () => {
    expect(await resumeCompanyPlanAction()).toEqual({ ok: true });

    expect(cancelAtPeriodEnd).toHaveBeenCalledWith("sub_1", false);
    expect(service.callsFor("set_company_cancel_at_period_end")[0].chain[0].args[1]).toEqual({
      p_company_id: COMPANY_A.id,
      p_cancel: false,
    });
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: "billing_resumed" }));
  });

  it("only works when the plan is set to cancel", async () => {
    vi.mocked(getCompanySubscription).mockResolvedValue({ ...SUB, cancelAtPeriodEnd: false });
    expect(await resumeCompanyPlanAction()).toMatchObject({ ok: false });
    expect(cancelAtPeriodEnd).not.toHaveBeenCalled();
  });
});
