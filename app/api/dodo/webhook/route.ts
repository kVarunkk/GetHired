import { reportError } from "@/helpers/posthog/report-error";
import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WebhookPayload } from "dodopayments/resources/webhook-events.mjs";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getDodoClient } from "@/lib/dodo/initialize";
import { SendPaymentUpdateEmail } from "@/lib/dodo/utils";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { getTierNames as tierNames } from "@/helpers/billing/entitlements";
import { billingContactsFor, sendPlanChangedEmail } from "@/helpers/billing/emails";
import type { Database, Json } from "@/utils/types/database.types";
import { JsonCompatible, PostHogEvent, TPaymentStatus } from "@/utils/types";

// The Dodo webhook, as a dispatcher (plan/recruiter-billing/feature-recruiter-billing-spec.md §4.1):
//   1. verify the signature, before parsing anything;
//   2. store the delivery in billing_webhook_events (a duplicate is a no-op);
//   3. route by event type (payments by the kind on our payments row);
//   4. fulfil in one SQL function (fulfil_payment / apply_subscription_event),
//      never from payload amounts or metadata alone;
//   5. mark the event processed, or store the error;
//   6. answer 200 unless the delivery couldn't be stored, so Dodo doesn't retry
//      a payload we can't handle. Errors are alerted through PostHog instead.

type ServiceClient = SupabaseClient<Database>;
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type WebhookStatus = "processed" | "duplicate" | "ignored" | "error_logged";
type DodoEvent = { type: string; data: unknown };

const UNIQUE_VIOLATION = "23505";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An event we stored but can't act on: logged and acknowledged, not retried. */
class WebhookPayloadError extends Error {}

const reply = (status: WebhookStatus) => NextResponse.json({ received: true, status });

export async function POST(req: NextRequest) {
  const body = await req.text();
  const webhookId = req.headers.get("webhook-id") ?? "";

  let event: DodoEvent;
  try {
    event = getDodoClient().webhooks.unwrap(body, {
      headers: {
        "webhook-id": webhookId,
        "webhook-signature": req.headers.get("webhook-signature") ?? "",
        "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
      },
    }) as DodoEvent;
  } catch (err) {
    reportError("⚠️ Webhook signature verification failed.", err);
    return NextResponse.json(
      { error: "Webhook Error: Invalid Signature" },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  const { error: insertError } = await supabase.from("billing_webhook_events").insert({
    webhook_id: webhookId,
    event_type: event.type,
    payload: event as unknown as Json,
  });

  if (insertError?.code === UNIQUE_VIOLATION) return reply("duplicate");
  if (insertError) {
    // Nothing is stored yet, so let Dodo retry.
    reportError("Failed to store webhook event:", insertError);
    return NextResponse.json({ error: "Couldn't store the event." }, { status: 500 });
  }

  try {
    const status = await dispatch(supabase, event, webhookId);
    if (status === "processed") {
      await supabase
        .from("billing_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("webhook_id", webhookId);
    }
    return reply(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError(`Webhook ${webhookId} (${event.type}) failed:`, err);
    await supabase
      .from("billing_webhook_events")
      .update({ error: message })
      .eq("webhook_id", webhookId);
    await eventCaptureServer({
      event: PostHogEvent.BillingWebhookError,
      distinctId: "dodo-webhook",
      properties: { webhookId, eventType: event.type, error: message },
    });
    return reply("error_logged");
  }
}

const PAYMENT_STATUS: Record<string, TPaymentStatus> = {
  "payment.failed": TPaymentStatus.FAILED,
  "payment.cancelled": TPaymentStatus.CANCELLED,
  "payment.processing": TPaymentStatus.PENDING,
};

async function dispatch(
  supabase: ServiceClient,
  event: DodoEvent,
  webhookId: string,
): Promise<WebhookStatus> {
  if (event.type.startsWith("subscription.")) {
    return applySubscriptionEvent(supabase, event.type, event.data as WebhookPayload.Subscription);
  }
  if (!event.type.startsWith("payment.")) return "ignored";

  const payment = event.data as WebhookPayload.Payment;
  if (event.type === "payment.succeeded") {
    return fulfil(supabase, payment, webhookId);
  }
  const status = PAYMENT_STATUS[event.type];
  if (status) {
    return updateStatus(supabase, payment, status);
  }
  return "ignored";
}

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.plan_changed",
  "subscription.on_hold",
  "subscription.failed",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.updated",
]);

/**
 * §4.2: the company comes from our rows, never from metadata alone: the
 * subscription we've linked, or the payments row the checkout created.
 * `needsLink` is set when the subscription isn't linked yet: Dodo sends
 * subscription.renewed / .updated alongside .active at checkout, in any order.
 */
async function companyForSubscription(
  supabase: ServiceClient,
  type: string,
  sub: WebhookPayload.Subscription,
): Promise<{ companyId: string; tierId: string | null; needsLink: boolean }> {
  let fromCheckout: { companyId: string; tierId: string | null } | null = null;
  const rowId = sub.metadata?.payment_row_id;
  if (typeof rowId === "string" && UUID_RE.test(rowId)) {
    const { data: row } = await supabase
      .from("payments")
      .select("company_id, tier_id, kind")
      .eq("id", rowId)
      .maybeSingle();
    if (row?.company_id && row.kind === "company_subscription") {
      fromCheckout = { companyId: row.company_id, tierId: row.tier_id };
    }
  }
  if (type === "subscription.active" && fromCheckout) return { ...fromCheckout, needsLink: false };

  const { data: linked } = await supabase
    .from("company_subscriptions")
    .select("company_id")
    .eq("dodo_subscription_id", sub.subscription_id)
    .maybeSingle();
  if (linked) return { companyId: linked.company_id, tierId: null, needsLink: false };
  if (fromCheckout) return { ...fromCheckout, needsLink: true };

  throw new WebhookPayloadError(`No company for subscription ${sub.subscription_id}`);
}

async function applySubscriptionEvent(
  supabase: ServiceClient,
  type: string,
  sub: WebhookPayload.Subscription,
): Promise<WebhookStatus> {
  if (!SUBSCRIPTION_EVENTS.has(type)) return "ignored";

  const { companyId, tierId, needsLink } = await companyForSubscription(supabase, type, sub);

  const eventOf = (eventType: string) => ({
    type: eventType,
    subscription_id: sub.subscription_id,
    customer_id: sub.customer?.customer_id ?? null,
    product_id: sub.product_id,
    period_start: sub.previous_billing_date ?? null,
    period_end: sub.next_billing_date ?? null,
    cancel_at_next_billing_date: sub.cancel_at_next_billing_date ?? null,
    tier_id: tierId,
  });

  if (needsLink) {
    // Arrived before subscription.active: link it now (active is idempotent).
    const { error } = await supabase.rpc("apply_subscription_event", {
      p_company_id: companyId,
      p_event: eventOf("subscription.active"),
    });
    if (error) throw new Error(`apply_subscription_event (link): ${error.message}`);
  }

  const { data, error } = await supabase.rpc("apply_subscription_event", {
    p_company_id: companyId,
    p_event: eventOf(type),
  });
  if (error) throw new Error(`apply_subscription_event: ${error.message}`);

  const event = SUBSCRIPTION_ANALYTICS[type];
  if (event) {
    await eventCaptureServer({
      event,
      distinctId: companyId,
      properties: { companyId, subscriptionId: sub.subscription_id, productId: sub.product_id },
    });
  }

  if (type === "subscription.plan_changed") {
    const result = data as { previous_tier_id: string | null; tier_id: string } | null;
    if (result && result.previous_tier_id !== result.tier_id) {
      // after(): the email shouldn't hold up (or fail) the webhook.
      after(() => notifyPlanChanged(companyId, result.previous_tier_id, result.tier_id));
    }
  }
  return "processed";
}

const SUBSCRIPTION_ANALYTICS: Record<string, PostHogEvent> = {
  "subscription.active": PostHogEvent.BillingSubscriptionActivated,
  "subscription.plan_changed": PostHogEvent.BillingPlanChanged,
  "subscription.cancelled": PostHogEvent.BillingCancelled,
};

async function notifyPlanChanged(companyId: string, fromTierId: string | null, toTierId: string) {
  try {
    const [{ companyName, emails }, names] = await Promise.all([
      billingContactsFor(companyId),
      tierNames([fromTierId, toTierId].filter((t): t is string => !!t)),
    ]);
    await sendPlanChangedEmail(emails, {
      companyName,
      fromPlan: (fromTierId && names.get(fromTierId)) || "your previous plan",
      toPlan: names.get(toTierId) ?? "your new plan",
      effectiveAt: new Date().toISOString(),
      scheduled: false,
    });
  } catch (err) {
    reportError("[billing] plan changed email failed", err);
  }
}

/** The payment row the event is about: by the id we put in metadata, else by checkout session (legacy checkouts). */
async function findPaymentRow(
  supabase: ServiceClient,
  payment: WebhookPayload.Payment,
): Promise<PaymentRow> {
  const rowId = payment.metadata?.payment_row_id;
  if (typeof rowId === "string" && UUID_RE.test(rowId)) {
    const { data } = await supabase.from("payments").select("*").eq("id", rowId).maybeSingle();
    if (data) return data;
  }
  if (payment.checkout_session_id) {
    const { data } = await supabase
      .from("payments")
      .select("*")
      .eq("session_id", payment.checkout_session_id)
      .maybeSingle();
    if (data) return data;
  }
  throw new WebhookPayloadError(
    `No payment row for payment ${payment.payment_id} (session ${payment.checkout_session_id ?? "none"})`,
  );
}

/** Dodo's details for the payment row. Never credit amounts. */
function paymentDetails(payment: WebhookPayload.Payment) {
  return {
    payment_id: payment.payment_id,
    currency: payment.currency,
    total_amount: payment.total_amount,
    billing: payment.billing as JsonCompatible<typeof payment.billing>,
    customer: payment.customer as JsonCompatible<typeof payment.customer>,
    updated_at: new Date().toISOString(),
  };
}

async function fulfil(
  supabase: ServiceClient,
  payment: WebhookPayload.Payment,
  webhookId: string,
): Promise<WebhookStatus> {
  let row: PaymentRow;
  try {
    row = await findPaymentRow(supabase, payment);
  } catch (err) {
    // A subscription renewal: no checkout row; the subscription events drive state.
    if (err instanceof WebhookPayloadError && payment.subscription_id) return "ignored";
    throw err;
  }

  const { data, error } = await supabase.rpc("fulfil_payment", {
    p_payment_row_id: row.id,
    p_webhook_id: webhookId,
    p_dodo_payment_id: payment.payment_id,
  });
  if (error) throw new Error(`fulfil_payment: ${error.message}`);

  const result = data as {
    status: "fulfilled" | "already_fulfilled" | "recorded";
    kind: PaymentRow["kind"];
    credit_amount: number;
  };
  if (result.status !== "already_fulfilled") {
    await supabase.from("payments").update(paymentDetails(payment)).eq("id", row.id);
  }
  if (result.status !== "fulfilled") return "processed";

  if (row.kind === "company_credits" && row.company_id) {
    await eventCaptureServer({
      event: PostHogEvent.BillingCreditsPurchased,
      distinctId: row.company_id,
      properties: { companyId: row.company_id, credits: result.credit_amount },
    });
  }

  await emailUser(supabase, row, payment, TPaymentStatus.COMPLETE, result.credit_amount);
  return "processed";
}

async function updateStatus(
  supabase: ServiceClient,
  payment: WebhookPayload.Payment,
  status: TPaymentStatus,
): Promise<WebhookStatus> {
  const row = await findPaymentRow(supabase, payment);

  const { error } = await supabase
    .from("payments")
    .update({
      ...paymentDetails(payment),
      status,
      credits_fulfilled: false,
      ...(status === TPaymentStatus.PENDING
        ? {}
        : { failure_reason: payment.error_message ?? "unknown" }),
    })
    .eq("id", row.id)
    // Events can arrive out of order: a late "processing" mustn't undo a success.
    .neq("status", "complete");
  if (error) throw new Error(`payments update: ${error.message}`);

  await emailUser(supabase, row, payment, status, row.credit_amount ?? 0);
  return "processed";
}

async function emailUser(
  supabase: ServiceClient,
  row: PaymentRow,
  payment: WebhookPayload.Payment,
  status: TPaymentStatus,
  creditAmount: number,
) {
  // A company credit pack: the receipt goes to the company's billing contacts
  // (its owner and contact address; TM-SEC-005), never to whoever clicked.
  // Subscriptions have their own plan emails.
  if (row.company_id) {
    if (row.kind !== "company_credits") return;
    const contacts = await billingContactsFor(row.company_id).catch(() => null);
    let sent = false;
    for (const email of contacts?.emails ?? []) {
      const result = await SendPaymentUpdateEmail({
        userName: contacts!.companyName,
        email,
        paymentDetails: {
          status,
          total_amount: payment.total_amount,
          currency: payment.currency,
          credit_amount: creditAmount,
          payment_method: payment.payment_method ?? "",
          payment_id: payment.payment_id,
        },
      });
      sent ||= !result.error && !!result.success;
    }
    if (sent) await supabase.from("payments").update({ email_sent: true }).eq("id", row.id);
    return;
  }

  if (!row.user_id) return;

  const { data: user } = await supabase
    .from("user_info")
    .select("full_name, email")
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (!user?.email) return;

  const { error, success } = await SendPaymentUpdateEmail({
    userName: user.full_name || user.email.split("@")[0],
    email: user.email,
    paymentDetails: {
      status,
      total_amount: payment.total_amount,
      currency: payment.currency,
      credit_amount: creditAmount,
      payment_method: payment.payment_method ?? "",
      payment_id: payment.payment_id,
    },
  });

  if (!error && success) {
    await supabase.from("payments").update({ email_sent: true }).eq("id", row.id);
  }
}
