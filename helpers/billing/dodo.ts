import "server-only";
import { getDodoClient } from "@/lib/dodo/initialize";

// Everything Dodo-specific for company billing (BL-RISK-002). Method names were
// checked against dodopayments@2.48.0 (spec §4.2). Checkout metadata carries ids
// only (BL-SEC-001): the webhook reads amounts and plans from our rows.

type Currency = "USD" | "INR";

type CheckoutResult = { sessionId: string; checkoutUrl: string };

type CompanyCheckout = {
  /** The payments row created for this checkout. */
  paymentRowId: string;
  companyId: string;
  /** From price_plan / company_tiers.prices, never from the request. */
  productId: string;
  email: string;
  returnUrl: string;
};

async function checkout(
  { paymentRowId, companyId, productId, email, returnUrl }: CompanyCheckout,
  kind: "company_credits" | "company_subscription",
  currency?: Currency,
): Promise<CheckoutResult> {
  const session = await getDodoClient().checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email },
    return_url: returnUrl,
    metadata: { payment_row_id: paymentRowId, company_id: companyId, kind },
    ...(currency ? { billing_currency: currency } : {}),
  });
  if (!session.checkout_url) throw new Error("Dodo returned no checkout URL");
  return { sessionId: session.session_id, checkoutUrl: session.checkout_url };
}

/** A one-time company credit pack. */
export function createCreditCheckout(params: CompanyCheckout) {
  return checkout(params, "company_credits");
}

/** A plan subscription (monthly or annual, picked by the product). */
export function createSubscriptionCheckout(params: CompanyCheckout & { currency: Currency }) {
  return checkout(params, "company_subscription", params.currency);
}

/**
 * BL-REQ-011: upgrades apply now with proration; downgrades at the period end.
 * The webhook (subscription.plan_changed) moves our state.
 */
export async function changePlan(
  subscriptionId: string,
  productId: string,
  { prorate, atPeriodEnd = false }: { prorate: boolean; atPeriodEnd?: boolean },
) {
  await getDodoClient().subscriptions.changePlan(subscriptionId, {
    product_id: productId,
    quantity: 1,
    // Dodo only accepts full_immediately with next_billing_date: the new price
    // is charged in full at the renewal, nothing now.
    proration_billing_mode: atPeriodEnd ? "full_immediately" : prorate ? "prorated_immediately" : "do_not_bill",
    effective_at: atPeriodEnd ? "next_billing_date" : "immediately",
    // A failed upgrade charge leaves the plan as it was.
    ...(atPeriodEnd ? {} : { on_payment_failure: "prevent_change" as const }),
  });
}

/** BL-REQ-012. `false` resumes a subscription that was set to cancel. */
export async function cancelAtPeriodEnd(subscriptionId: string, cancel = true) {
  await getDodoClient().subscriptions.update(subscriptionId, {
    cancel_at_next_billing_date: cancel,
  });
}

/** Payment method and invoices (BL-REQ-010). */
export async function customerPortalUrl(customerId: string, returnUrl: string) {
  const session = await getDodoClient().customers.customerPortal.create(customerId, {
    return_url: returnUrl,
  });
  return session.link;
}
