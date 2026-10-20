import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { changePlan } from "@/helpers/billing/dodo";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { getCompanySubscription } from "@/helpers/billing/subscription";
import { getPlanBySlug, listPublicPlans } from "@/helpers/billing/plans";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { changeCompanyPlanAction } from "./change-company-plan";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/dodo", () => ({ changePlan: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/billing/subscription", () => ({ getCompanySubscription: vi.fn() }));
vi.mock("@/helpers/billing/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing/plans")>()),
  getPlanBySlug: vi.fn(),
  listPublicPlans: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const plan = (slug: string, sort: number) => ({
  id: `t-${slug}`,
  slug,
  name: slug[0].toUpperCase() + slug.slice(1),
  description: null,
  features: [],
  sort,
  entitlements: {},
  prices: [{ interval: "month", currency: "USD", amount_minor: 100, dodo_product_id: `pdt_${slug}_m_usd` }],
});
const PLANS = [plan("free", 0), plan("startup", 1), plan("growth", 2)];

let rls: SupabaseMock;
let service: SupabaseMock;

async function signIn(user = COMPANY_A.user) {
  rls = createSupabaseMock({ user });
  rls.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  vi.mocked(listPublicPlans).mockResolvedValue(PLANS as never);
  vi.mocked(getPlanBySlug).mockImplementation(async (s) => (PLANS.find((p) => p.slug === s) as never) ?? null);
  vi.mocked(getEntitlements).mockResolvedValue({ subscribedTierSlug: "startup", status: "active" } as never);
  vi.mocked(getCompanySubscription).mockResolvedValue({
    dodoSubscriptionId: "sub_1",
    dodoCustomerId: "cus_1",
    billingInterval: "month",
    currency: "USD",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-11-01T00:00:00Z",
  });
  await signIn();
});

describe("changeCompanyPlanAction (BL-REQ-011)", () => {
  it("refuses no user and applicants", async () => {
    await setRequestUser(null, rls.client);
    expect(await changeCompanyPlanAction({ tierSlug: "growth" })).toMatchObject({ ok: false });
    await signIn(mockUser({ type: "applicant" }));
    expect(await changeCompanyPlanAction({ tierSlug: "growth" })).toMatchObject({ ok: false });
    expect(changePlan).not.toHaveBeenCalled();
  });

  it("acts on the session company's subscription", async () => {
    await changeCompanyPlanAction({ tierSlug: "growth" });
    expect(getCompanySubscription).toHaveBeenCalledWith(COMPANY_A.id);
    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
  });

  it("upgrades now with proration and leaves the DB to the webhook", async () => {
    expect(await changeCompanyPlanAction({ tierSlug: "growth" })).toEqual({ ok: true, scheduled: false });

    expect(changePlan).toHaveBeenCalledWith("sub_1", "pdt_growth_m_usd", { prorate: true, atPeriodEnd: false });
    expect(service.callsFor("schedule_company_plan_change")).toHaveLength(0);
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: "billing_plan_changed" }));
  });

  it("schedules a downgrade for the period end", async () => {
    vi.mocked(getEntitlements).mockResolvedValue({ subscribedTierSlug: "growth", status: "active" } as never);

    expect(await changeCompanyPlanAction({ tierSlug: "startup" })).toEqual({ ok: true, scheduled: true });

    expect(changePlan).toHaveBeenCalledWith("sub_1", "pdt_startup_m_usd", { prorate: false, atPeriodEnd: true });
    expect(service.callsFor("schedule_company_plan_change")[0].chain[0].args[1]).toEqual({
      p_company_id: COMPANY_A.id,
      p_tier_slug: "startup",
    });
  });

  it("refuses the current plan, Free, unknown plans and companies without a subscription", async () => {
    expect(await changeCompanyPlanAction({ tierSlug: "startup" })).toMatchObject({ ok: false, error: expect.stringContaining("already") });
    expect(await changeCompanyPlanAction({ tierSlug: "free" })).toMatchObject({ ok: false });
    expect(await changeCompanyPlanAction({ tierSlug: "founding" })).toMatchObject({ ok: false });
    vi.mocked(getCompanySubscription).mockResolvedValue(null);
    expect(await changeCompanyPlanAction({ tierSlug: "growth" })).toMatchObject({ ok: false });
    expect(changePlan).not.toHaveBeenCalled();
  });
});
