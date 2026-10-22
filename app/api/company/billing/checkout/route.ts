import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCompany } from "@/helpers/companies/require-company";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BILLING_FORBIDDEN, canManageBilling } from "@/helpers/billing/access";
import { getEntitlements } from "@/helpers/billing/entitlements";
import { getPlanBySlug, priceFor } from "@/helpers/billing/plans";
import { createCreditCheckout, createSubscriptionCheckout } from "@/helpers/billing/dodo";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { PostHogEvent } from "@/utils/types";

// BL-REQ-011/016: the browser names a pack or a plan; the product, price and
// credit amount come from our rows. Unknown fields (amounts, productId,
// companyId) are rejected.
const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("credits"), pricePlanId: z.string().uuid() }).strict(),
  z
    .object({
      kind: z.literal("subscription"),
      tierSlug: z.string().min(1),
      interval: z.enum(["month", "year"]),
      currency: z.enum(["USD", "INR"]),
    })
    .strict(),
]);

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  const auth = await requireCompany();
  if (!auth.ok) return auth.response;
  const { user, company } = auth;
  if (!canManageBilling(user, company)) return bad(BILLING_FORBIDDEN, 403);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Invalid checkout request.");
  const body = parsed.data;

  const service = createServiceRoleClient();
  const email = company.email ?? user.email ?? "";
  const returnUrl = `${req.nextUrl.origin}/company/billing?checkout=done`;

  let payment: { productId: string; insert: Record<string, unknown> };
  let properties: Record<string, unknown>;

  if (body.kind === "credits") {
    const { data: plan } = await service
      .from("price_plan")
      .select("id, product_id, credit_amount, audience")
      .eq("id", body.pricePlanId)
      .eq("audience", "company")
      .maybeSingle();
    if (!plan || plan.audience !== "company" || !plan.product_id || !plan.credit_amount) {
      return bad("Invalid credit pack.");
    }
    payment = {
      productId: plan.product_id,
      insert: {
        kind: "company_credits",
        price_plan_id: plan.id,
        credit_amount: plan.credit_amount,
      },
    };
    properties = { kind: "credits", credits: plan.credit_amount };
  } else {
    const plan = body.tierSlug === "free" ? null : await getPlanBySlug(body.tierSlug);
    const price = plan ? priceFor(plan, body.interval, body.currency) : null;
    if (!plan || !price?.dodo_product_id) return bad("That plan isn't available.");

    const current = await getEntitlements(company.id);
    if (current.hasPaidSubscription && current.status !== "expired") {
      return bad("You already have a subscription. Change your plan instead.", 409);
    }
    payment = {
      productId: price.dodo_product_id,
      insert: { kind: "company_subscription", tier_id: plan.id },
    };
    properties = { kind: "subscription", tier: plan.slug, interval: body.interval, currency: body.currency };
  }

  // The row first, so its id can go in the checkout metadata.
  const { data: row, error: insertError } = await service
    .from("payments")
    .insert({
      ...payment.insert,
      company_id: company.id,
      user_id: null,
      product_id: payment.productId,
      status: "pending",
    })
    .select("id")
    .single();
  if (insertError || !row) {
    reportError("[billing] couldn't create the payment row", insertError);
    return bad("Couldn't start the checkout.", 500);
  }

  try {
    const params = {
      paymentRowId: row.id,
      companyId: company.id,
      productId: payment.productId,
      email,
      returnUrl,
    };
    const session =
      body.kind === "credits"
        ? await createCreditCheckout(params)
        : await createSubscriptionCheckout({ ...params, currency: body.currency });

    await service.from("payments").update({ session_id: session.sessionId }).eq("id", row.id);
    await eventCaptureServer({
      event: PostHogEvent.BillingCheckoutStarted,
      distinctId: company.id,
      properties: { companyId: company.id, ...properties },
    });
    return NextResponse.json({ checkoutUrl: session.checkoutUrl });
  } catch (err) {
    reportError("[billing] Dodo checkout failed", err);
    await service
      .from("payments")
      .update({ status: "failed", failure_reason: "checkout_session_failed", updated_at: new Date().toISOString() })
      .eq("id", row.id);
    return bad("Couldn't start the checkout.", 500);
  }
}
