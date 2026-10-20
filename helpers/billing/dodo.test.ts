import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDodoClient } from "@/lib/dodo/initialize";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  cancelAtPeriodEnd,
  changePlan,
  createCreditCheckout,
  createSubscriptionCheckout,
  customerPortalUrl,
} from "./dodo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/dodo/initialize", () => ({ getDodoClient: vi.fn() }));

const dodo = {
  checkoutSessions: { create: vi.fn() },
  subscriptions: { changePlan: vi.fn(), update: vi.fn() },
  customers: { customerPortal: { create: vi.fn() } },
};

const PARAMS = {
  paymentRowId: "9b000000-0000-4000-8000-000000000001",
  companyId: COMPANY_A.id,
  productId: "pdt_company_100",
  email: "hr@acme.dev",
  returnUrl: "https://app.test/company/billing?checkout=done",
};

beforeEach(() => {
  vi.mocked(getDodoClient).mockReturnValue(dodo as never);
  dodo.checkoutSessions.create.mockResolvedValue({ session_id: "cks_1", checkout_url: "https://pay.test/cks_1" });
});

describe("helpers/billing/dodo (BL-SEC-001)", () => {
  it("createCreditCheckout sends the product and only ids in metadata", async () => {
    expect(await createCreditCheckout(PARAMS)).toEqual({ sessionId: "cks_1", checkoutUrl: "https://pay.test/cks_1" });

    const args = dodo.checkoutSessions.create.mock.calls[0][0];
    expect(args.product_cart).toEqual([{ product_id: "pdt_company_100", quantity: 1 }]);
    expect(args.metadata).toEqual({
      payment_row_id: PARAMS.paymentRowId,
      company_id: COMPANY_A.id,
      kind: "company_credits",
    });
    expect(args.return_url).toBe(PARAMS.returnUrl);
  });

  it("createSubscriptionCheckout marks the kind and passes the currency", async () => {
    await createSubscriptionCheckout({ ...PARAMS, productId: "pdt_startup_m_usd", currency: "USD" });

    const args = dodo.checkoutSessions.create.mock.calls[0][0];
    expect(args.metadata).toEqual({
      payment_row_id: PARAMS.paymentRowId,
      company_id: COMPANY_A.id,
      kind: "company_subscription",
    });
    expect(args.billing_currency).toBe("USD");
  });

  it("changePlan prorates an upgrade now", async () => {
    await changePlan("sub_1", "pdt_growth", { prorate: true });

    expect(dodo.subscriptions.changePlan).toHaveBeenCalledWith("sub_1", {
      product_id: "pdt_growth",
      quantity: 1,
      proration_billing_mode: "prorated_immediately",
      effective_at: "immediately",
      on_payment_failure: "prevent_change",
    });
  });

  it("changePlan schedules a downgrade for the period end", async () => {
    await changePlan("sub_1", "pdt_startup", { prorate: false, atPeriodEnd: true });

    expect(dodo.subscriptions.changePlan).toHaveBeenCalledWith("sub_1", {
      product_id: "pdt_startup",
      quantity: 1,
      proration_billing_mode: "full_immediately",
      effective_at: "next_billing_date",
    });
  });

  it("cancelAtPeriodEnd sets and clears cancel_at_next_billing_date", async () => {
    await cancelAtPeriodEnd("sub_1");
    await cancelAtPeriodEnd("sub_1", false);

    expect(dodo.subscriptions.update.mock.calls).toEqual([
      ["sub_1", { cancel_at_next_billing_date: true }],
      ["sub_1", { cancel_at_next_billing_date: false }],
    ]);
  });

  it("customerPortalUrl returns the portal link", async () => {
    dodo.customers.customerPortal.create.mockResolvedValue({ link: "https://portal.test/x" });

    expect(await customerPortalUrl("cus_1", "https://app.test/company/billing")).toBe("https://portal.test/x");
    expect(dodo.customers.customerPortal.create).toHaveBeenCalledWith("cus_1", {
      return_url: "https://app.test/company/billing",
    });
  });
});
