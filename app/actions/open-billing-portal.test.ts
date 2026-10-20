import { beforeEach, describe, expect, it, vi } from "vitest";
import { customerPortalUrl } from "@/helpers/billing/dodo";
import { getCompanySubscription } from "@/helpers/billing/subscription";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { openBillingPortalAction } from "./open-billing-portal";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/dodo", () => ({ customerPortalUrl: vi.fn() }));
vi.mock("@/helpers/billing/subscription", () => ({ getCompanySubscription: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

let rls: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  rls = createSupabaseMock({ user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  vi.mocked(getCompanySubscription).mockResolvedValue({
    dodoSubscriptionId: "sub_1",
    dodoCustomerId: "cus_1",
    billingInterval: "month",
    currency: "USD",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-11-01T00:00:00Z",
  });
  vi.mocked(customerPortalUrl).mockResolvedValue("https://portal.test/x");
  await signIn();
});

describe("openBillingPortalAction", () => {
  it("refuses applicants", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect(await openBillingPortalAction()).toMatchObject({ ok: false });
    expect(customerPortalUrl).not.toHaveBeenCalled();
  });

  it("returns the portal URL for the session company's customer", async () => {
    expect(await openBillingPortalAction()).toEqual({ ok: true, url: "https://portal.test/x" });

    expect(getCompanySubscription).toHaveBeenCalledWith(COMPANY_A.id);
    expect(customerPortalUrl).toHaveBeenCalledWith("cus_1", expect.stringMatching(/\/company\/billing$/));
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: "billing_portal_opened" }));
  });

  it("errors when there's no Dodo customer", async () => {
    vi.mocked(getCompanySubscription).mockResolvedValue(null);
    expect(await openBillingPortalAction()).toMatchObject({ ok: false });
  });
});
