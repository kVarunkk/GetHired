import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createCreditCheckout, createSubscriptionCheckout } from "@/helpers/billing/dodo";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { getPlanBySlug } from "@/helpers/billing/plans";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICANT_TRIAL_PLAN, COMPANY_CREDITS_PLAN, TIER_STARTUP } from "@/test/utils/billing";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { POST } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/helpers/billing/dodo", () => ({ createCreditCheckout: vi.fn(), createSubscriptionCheckout: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getEntitlements: vi.fn() }));
vi.mock("@/helpers/billing/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/billing/plans")>()),
  getPlanBySlug: vi.fn(),
}));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));

const ROW_ID = "9b000000-0000-4000-8000-0000000000ee";
const STARTUP_PLAN = {
  id: TIER_STARTUP.id,
  slug: "startup",
  name: "Startup",
  description: null,
  features: [],
  sort: 1,
  entitlements: {},
  prices: [
    { interval: "month", currency: "USD", amount_minor: 4900, dodo_product_id: "pdt_startup_m_usd" },
    { interval: "year", currency: "INR", amount_minor: 2999000, dodo_product_id: null },
  ],
};

let rls: SupabaseMock;
let service: SupabaseMock;

const post = (body: unknown) => POST(buildRequest("/api/company/billing/checkout", { method: "POST", body }));
const paymentInserts = () =>
  service.callsFor("payments").flatMap((c) => c.chain.filter((m) => m.method === "insert")).map((m) => m.args[0]);

async function signIn(user = COMPANY_A.user) {
  rls = createSupabaseMock({ user });
  rls.queue("company_info", { data: COMPANY_A.info, error: null });
  await setRequestUser(user, rls.client);
}

beforeEach(async () => {
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  service.queue("payments", { data: { id: ROW_ID }, error: null });
  vi.mocked(createCreditCheckout).mockResolvedValue({ sessionId: "cks_1", checkoutUrl: "https://pay.test/1" });
  vi.mocked(createSubscriptionCheckout).mockResolvedValue({ sessionId: "cks_2", checkoutUrl: "https://pay.test/2" });
  vi.mocked(getPlanBySlug).mockImplementation(async (slug) => (slug === "startup" ? (STARTUP_PLAN as never) : null));
  vi.mocked(getEntitlements).mockResolvedValue({ hasPaidSubscription: false, status: "active" } as never);
  await signIn();
});

describe("POST /api/company/billing/checkout", () => {
  it("refuses no user (401) and applicants (403)", async () => {
    await setRequestUser(null, rls.client);
    expect((await post({ kind: "credits", pricePlanId: COMPANY_CREDITS_PLAN.id })).status).toBe(401);

    await signIn(mockUser({ type: "applicant" }));
    expect((await post({ kind: "credits", pricePlanId: COMPANY_CREDITS_PLAN.id })).status).toBe(403);
    expect(service.calls).toHaveLength(0);
  });

  it("buys a company credit pack from the DB plan", async () => {
    service.queue("price_plan", { data: COMPANY_CREDITS_PLAN, error: null });

    const res = await post({ kind: "credits", pricePlanId: COMPANY_CREDITS_PLAN.id });

    expect(await res.json()).toEqual({ checkoutUrl: "https://pay.test/1" });
    expect(paymentInserts()[0]).toMatchObject({
      kind: "company_credits",
      company_id: COMPANY_A.id,
      price_plan_id: COMPANY_CREDITS_PLAN.id,
      product_id: COMPANY_CREDITS_PLAN.product_id,
      credit_amount: 100,
      status: "pending",
    });
    expect(createCreditCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRowId: ROW_ID, companyId: COMPANY_A.id, productId: COMPANY_CREDITS_PLAN.product_id }),
    );
    expect(eventCaptureServer).toHaveBeenCalledWith(expect.objectContaining({ event: "billing_checkout_started" }));
  });

  it("rejects an applicant credit pack", async () => {
    service.queue("price_plan", { data: APPLICANT_TRIAL_PLAN, error: null });

    expect((await post({ kind: "credits", pricePlanId: APPLICANT_TRIAL_PLAN.id })).status).toBe(400);
    expect(createCreditCheckout).not.toHaveBeenCalled();
  });

  it("starts a subscription checkout with the plan's product for the interval and currency", async () => {
    const res = await post({ kind: "subscription", tierSlug: "startup", interval: "month", currency: "USD" });

    expect(await res.json()).toEqual({ checkoutUrl: "https://pay.test/2" });
    expect(paymentInserts()[0]).toMatchObject({
      kind: "company_subscription",
      company_id: COMPANY_A.id,
      tier_id: TIER_STARTUP.id,
      product_id: "pdt_startup_m_usd",
    });
    expect(createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "pdt_startup_m_usd", currency: "USD", paymentRowId: ROW_ID }),
    );
  });

  it.each([
    ["founding (not public)", { kind: "subscription", tierSlug: "founding", interval: "month", currency: "USD" }],
    ["free", { kind: "subscription", tierSlug: "free", interval: "month", currency: "USD" }],
    ["a price without a product", { kind: "subscription", tierSlug: "startup", interval: "year", currency: "INR" }],
    ["an amount in the body", { kind: "credits", pricePlanId: COMPANY_CREDITS_PLAN.id, creditAmount: 30000 }],
    ["a productId in the body", { kind: "credits", pricePlanId: COMPANY_CREDITS_PLAN.id, productId: "cheap" }],
    ["a companyId in the body", { kind: "subscription", tierSlug: "startup", interval: "month", currency: "USD", companyId: COMPANY_B.id }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(paymentInserts()).toHaveLength(0);
  });

  it("sends a company with a paid subscription to change plan instead (409)", async () => {
    vi.mocked(getEntitlements).mockResolvedValue({ hasPaidSubscription: true, status: "active" } as never);

    const res = await post({ kind: "subscription", tierSlug: "startup", interval: "month", currency: "USD" });

    expect(res.status).toBe(409);
    expect(paymentInserts()).toHaveLength(0);
  });

  it("marks the payment failed when Dodo errors", async () => {
    service.queue("price_plan", { data: COMPANY_CREDITS_PLAN, error: null });
    vi.mocked(createCreditCheckout).mockRejectedValue(new Error("down"));

    const res = await post({ kind: "credits", pricePlanId: COMPANY_CREDITS_PLAN.id });

    expect(res.status).toBe(500);
    const update = service.callsFor("payments").find((c) => c.chain.some((m) => m.method === "update"))!;
    expect(update.chain[0].args[0]).toMatchObject({ status: "failed" });
  });

  // BL-SEC-004: turned on by the teams spec (BLT-103).
  it.todo("refuses a member without the owner or admin role (403)");
});
