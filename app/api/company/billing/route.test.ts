import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));

let rls: SupabaseMock;

const ENTITLEMENTS = {
  tier: { id: "t1", slug: "startup", name: "Startup" },
  subscribedTierSlug: "startup",
  status: "active",
  billingInterval: "month",
  currency: "USD",
  period: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z" },
  cancelAtPeriodEnd: false,
  scheduledTierSlug: "free",
  graceUntil: null,
  manualUntil: null,
  hasPaidSubscription: true,
  hasBillingPortal: true,
  entitlements: { screenings: { kind: "allowance", amount: 500, used: 3, held: 0, remaining: 497, overageCredits: 1 } },
  creditBalance: 40,
  creditLots: [{ id: "l1", remaining: 40, expiresAt: null, reason: "grant", createdAt: "2026-10-01" }],
};

async function signIn(user = COMPANY_A.user) {
  rls = createSupabaseMock({ user });
  rls.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  await signIn();
  vi.mocked(getEntitlements).mockResolvedValue(ENTITLEMENTS as never);
});

describe("GET /api/company/billing", () => {
  it("refuses an unauthenticated caller", async () => {
    await setRequestUser(null, rls.client);
    expect((await GET()).status).toBe(401);
    expect(getEntitlements).not.toHaveBeenCalled();
  });

  it("refuses an applicant", async () => {
    await signIn(mockUser({ type: "applicant" }));
    expect((await GET()).status).toBe(403);
  });

  it("returns the session company's billing", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(getEntitlements).toHaveBeenCalledWith(COMPANY_A.id);
    expect(getEntitlements).not.toHaveBeenCalledWith(COMPANY_B.id);
    expect(await res.json()).toMatchObject({
      plan: { slug: "startup", name: "Startup" },
      status: "active",
      period: ENTITLEMENTS.period,
      entitlements: ENTITLEMENTS.entitlements,
      creditBalance: 40,
      creditLots: ENTITLEMENTS.creditLots,
      cancelAtPeriodEnd: false,
      scheduledPlan: "free",
    });
  });
});
