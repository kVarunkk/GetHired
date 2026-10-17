import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDodoClient } from "@/lib/dodo/initialize";
import { SendPaymentUpdateEmail } from "@/lib/dodo/utils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { eventCaptureServer } from "@/helpers/posthog/EventCaptureServer";
import { billingContactsFor } from "@/helpers/billing/emails";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICANT_TRIAL_PLAN, dodoWebhook, paymentRowOf } from "@/test/utils/billing";
import { POST } from "./route";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/dodo/initialize", () => ({ getDodoClient: vi.fn() }));
vi.mock("@/lib/dodo/utils", () => ({ SendPaymentUpdateEmail: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getTierNames: vi.fn() }));
vi.mock("@/helpers/billing/emails", () => ({ billingContactsFor: vi.fn(), sendPlanChangedEmail: vi.fn() }));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PAYMENT = paymentRowOf({ user_id: USER_ID, session_id: "cks_1" });

let service: SupabaseMock;
const unwrap = vi.fn();

function paymentData(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: "pay_1",
    checkout_session_id: "cks_1",
    total_amount: 500,
    currency: "USD",
    payment_method: "card",
    error_message: null,
    billing: { country: "IN" },
    customer: { email: "ada@example.com" },
    metadata: { payment_row_id: PAYMENT.id, user_id: USER_ID, kind: "applicant_credits" },
    ...overrides,
  };
}

function deliver(type: string, data: Record<string, unknown>, opts?: { webhookId?: string }) {
  const { body, headers } = dodoWebhook(type, data, opts);
  return POST(
    new NextRequest("http://localhost:3000/api/dodo/webhook", { method: "POST", body, headers }),
  );
}

const paymentUpdates = () =>
  service
    .callsFor("payments")
    .flatMap((c) => c.chain.filter((m) => m.method === "update"))
    .map((m) => m.args[0] as Record<string, unknown>);

beforeEach(() => {
  vi.clearAllMocks();
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  // Like the SDK: verify, then return the parsed event.
  unwrap.mockImplementation((body: string) => JSON.parse(body));
  vi.mocked(getDodoClient).mockReturnValue({
    webhooks: { unwrap },
  } as unknown as ReturnType<typeof getDodoClient>);
  vi.mocked(SendPaymentUpdateEmail).mockResolvedValue({ error: null, success: true });

  for (let i = 0; i < 5; i++) {
    service.queue("payments", { data: { ...PAYMENT, credits_fulfilled: false }, error: null });
    service.queue("user_info", {
      data: { full_name: "Ada", email: "ada@example.com", ai_credits: 10 },
      error: null,
    });
  }
  service.queueRpc("fulfil_payment", {
    data: { status: "fulfilled", user_id: USER_ID, credit_amount: APPLICANT_TRIAL_PLAN.credit_amount },
    error: null,
  });
});

describe("POST /api/dodo/webhook (characterisation)", () => {
  it("rejects a bad signature with 400", async () => {
    unwrap.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const res = await deliver("payment.succeeded", paymentData());

    expect(res.status).toBe(400);
    expect(SendPaymentUpdateEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["payment.failed", "failed", true],
    ["payment.cancelled", "cancelled", true],
    ["payment.processing", "pending", false],
  ])("%s sets the payment status to %s and emails the user", async (type, status, marksEmailSent) => {
    const res = await deliver(type, paymentData({ error_message: "declined" }));

    expect(res.status).toBe(200);
    expect(paymentUpdates()).toContainEqual(expect.objectContaining({ status }));
    expect(SendPaymentUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        paymentDetails: expect.objectContaining({ status, payment_id: "pay_1" }),
      }),
    );
    if (marksEmailSent) {
      expect(paymentUpdates()).toContainEqual({ email_sent: true });
    }
  });

  // Checkouts created before BLT-012 carry the legacy metadata, and may still be
  // in flight when the rewrite deploys.
  it("payment.succeeded with legacy metadata sends the success email", async () => {
    const res = await deliver(
      "payment.succeeded",
      paymentData({ metadata: { credit_amount: "50", user_id: USER_ID } }),
    );

    expect(res.status).toBe(200);
    expect(SendPaymentUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDetails: expect.objectContaining({ status: "complete" }),
      }),
    );
  });
});

// BL-TEST-002 (BL-F02, BL-F03, BL-SEC-002).
describe("POST /api/dodo/webhook (dispatcher)", () => {
  const events = () => service.callsFor("billing_webhook_events");
  const eventUpdates = () =>
    events()
      .flatMap((c) => c.chain.filter((m) => m.method === "update"))
      .map((m) => m.args[0] as Record<string, unknown>);

  it("verifies the signature before parsing the body", async () => {
    unwrap.mockImplementation(() => {
      throw new Error("bad signature");
    });

    const res = await POST(
      new NextRequest("http://localhost:3000/api/dodo/webhook", {
        method: "POST",
        body: "not json",
        headers: { "webhook-id": "wh_1", "webhook-signature": "v1,x", "webhook-timestamp": "1" },
      }),
    );

    expect(res.status).toBe(400);
    expect(service.calls).toHaveLength(0);
  });

  it("stores the delivery before anything else", async () => {
    await deliver("payment.succeeded", paymentData(), { webhookId: "wh_first" });

    expect(service.calls[0].target).toBe("billing_webhook_events");
    expect(service.calls[0].chain[0]).toEqual({
      method: "insert",
      args: [
        expect.objectContaining({
          webhook_id: "wh_first",
          event_type: "payment.succeeded",
          payload: expect.objectContaining({ type: "payment.succeeded" }),
        }),
      ],
    });
  });

  it("acknowledges a duplicate delivery without fulfilling or emailing", async () => {
    service.queue("billing_webhook_events", {
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });

    const res = await deliver("payment.succeeded", paymentData());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "duplicate" });
    expect(service.callsFor("fulfil_payment")).toHaveLength(0);
    expect(SendPaymentUpdateEmail).not.toHaveBeenCalled();
  });

  it("fulfils through fulfil_payment and never touches ai_credits directly", async () => {
    const res = await deliver("payment.succeeded", paymentData(), { webhookId: "wh_ok" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "processed" });
    const rpcs = service.callsFor("fulfil_payment");
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].chain[0].args[1]).toEqual({
      p_payment_row_id: PAYMENT.id,
      p_webhook_id: "wh_ok",
      p_dodo_payment_id: "pay_1",
    });
    const touchesCredits = service
      .callsFor("user_info")
      .some((c) => JSON.stringify(c.chain).includes("ai_credits"));
    expect(touchesCredits).toBe(false);
  });

  it("takes the emailed credit amount from the payment, not the metadata", async () => {
    await deliver(
      "payment.succeeded",
      paymentData({
        metadata: { payment_row_id: PAYMENT.id, user_id: USER_ID, credit_amount: "30000" },
      }),
    );

    expect(SendPaymentUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentDetails: expect.objectContaining({ credit_amount: APPLICANT_TRIAL_PLAN.credit_amount }),
      }),
    );
  });

  it("marks a handled event processed", async () => {
    await deliver("payment.failed", paymentData());

    expect(eventUpdates()).toContainEqual(
      expect.objectContaining({ processed_at: expect.any(String) }),
    );
  });

  it("logs and acknowledges a payment it can't match to a row", async () => {
    service.reset();
    service.queue("payments", { data: null, error: null });
    service.queue("payments", { data: null, error: null });

    const res = await deliver(
      "payment.succeeded",
      paymentData({ checkout_session_id: "cks_unknown", metadata: { user_id: USER_ID } }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "error_logged" });
    expect(service.callsFor("fulfil_payment")).toHaveLength(0);
    expect(eventUpdates()).toContainEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: "billing_webhook_error" }),
    );
  });

  it("logs and acknowledges a fulfil_payment error", async () => {
    service.reset();
    service.queue("payments", { data: PAYMENT, error: null });
    service.queueRpc("fulfil_payment", { data: null, error: { message: "boom" } });

    const res = await deliver("payment.succeeded", paymentData());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "error_logged" });
    expect(eventUpdates()).toContainEqual(expect.objectContaining({ error: expect.stringContaining("boom") }));
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: "billing_webhook_error" }),
    );
    expect(SendPaymentUpdateEmail).not.toHaveBeenCalled();
  });

  it("stores and ignores an event type it doesn't handle", async () => {
    const res = await deliver("dispute.opened", { dispute_id: "dp_1" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, status: "ignored" });
    expect(events()[0].chain[0].method).toBe("insert");
    expect(service.callsFor("fulfil_payment")).toHaveLength(0);
  });

  it("doesn't email again when the payment was already fulfilled", async () => {
    service.reset();
    service.queue("payments", { data: PAYMENT, error: null });
    service.queueRpc("fulfil_payment", {
      data: { status: "already_fulfilled", user_id: USER_ID, credit_amount: 50 },
      error: null,
    });

    const res = await deliver("payment.succeeded", paymentData());

    expect(await res.json()).toEqual({ received: true, status: "processed" });
    expect(SendPaymentUpdateEmail).not.toHaveBeenCalled();
  });

  it("never moves a completed payment back to failed or pending", async () => {
    await deliver("payment.processing", paymentData());

    const statusUpdate = service
      .callsFor("payments")
      .find((c) => c.chain.some((m) => m.method === "update" && "status" in (m.args[0] as object)))!;
    expect(statusUpdate.chain).toContainEqual({ method: "neq", args: ["status", "complete"] });
  });
});

// BLT-078: company payments and subscription events (§4.2).
describe("POST /api/dodo/webhook (company billing)", () => {
  const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";
  const TIER_ID = "7e000000-0000-4000-8000-000000000011";
  const SUB_ROW = paymentRowOf({ user_id: null, company_id: COMPANY_ID, kind: "company_subscription", tier_id: TIER_ID });
  const CREDITS_ROW = paymentRowOf({ user_id: null, company_id: COMPANY_ID, kind: "company_credits" });

  const subscription = (overrides: Record<string, unknown> = {}) => ({
    subscription_id: "sub_1",
    product_id: "pdt_startup_m_usd",
    previous_billing_date: "2026-10-14T00:00:00Z",
    next_billing_date: "2026-11-14T00:00:00Z",
    cancel_at_next_billing_date: false,
    customer: { customer_id: "cus_1" },
    metadata: { payment_row_id: SUB_ROW.id, company_id: "c0000000-0000-4000-8000-0000000000ff", kind: "company_subscription" },
    ...overrides,
  });

  beforeEach(() => {
    service.reset();
    service.queueRpc("apply_subscription_event", {
      data: { previous_tier_id: null, tier_id: TIER_ID, status: "active" },
      error: null,
    });
  });

  it("subscription.active takes the company and tier from our payment row, not metadata", async () => {
    service.queue("payments", { data: SUB_ROW, error: null });

    const res = await deliver("subscription.active", subscription());

    expect(await res.json()).toEqual({ received: true, status: "processed" });
    expect(service.callsFor("apply_subscription_event")[0].chain[0].args[1]).toEqual({
      p_company_id: COMPANY_ID,
      p_event: {
        type: "subscription.active",
        subscription_id: "sub_1",
        customer_id: "cus_1",
        product_id: "pdt_startup_m_usd",
        period_start: "2026-10-14T00:00:00Z",
        period_end: "2026-11-14T00:00:00Z",
        cancel_at_next_billing_date: false,
        tier_id: TIER_ID,
      },
    });
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: "billing_subscription_activated" }),
    );
  });

  it.each([
    "subscription.renewed",
    "subscription.plan_changed",
    "subscription.on_hold",
    "subscription.failed",
    "subscription.cancelled",
    "subscription.expired",
    "subscription.updated",
  ])("%s finds the company by its subscription id", async (type) => {
    service.queue("company_subscriptions", { data: { company_id: COMPANY_ID }, error: null });

    await deliver(type, subscription({ metadata: {} }));

    const lookup = service.callsFor("company_subscriptions")[0].chain;
    expect(lookup).toContainEqual({ method: "eq", args: ["dodo_subscription_id", "sub_1"] });
    const args = service.callsFor("apply_subscription_event")[0].chain[0].args[1] as {
      p_company_id: string;
      p_event: { type: string; tier_id: string | null };
    };
    expect(args.p_company_id).toBe(COMPANY_ID);
    expect(args.p_event).toMatchObject({ type, tier_id: null });
  });

  it("links the subscription first when renewed/updated beat subscription.active", async () => {
    service.queue("payments", { data: SUB_ROW, error: null });
    service.queue("company_subscriptions", { data: null, error: null });

    const res = await deliver("subscription.renewed", subscription());

    expect(await res.json()).toEqual({ received: true, status: "processed" });
    const calls = service.callsFor("apply_subscription_event").map(
      (c) => c.chain[0].args[1] as { p_company_id: string; p_event: { type: string; tier_id: string | null } },
    );
    expect(calls.map((c) => c.p_event.type)).toEqual(["subscription.active", "subscription.renewed"]);
    expect(calls.every((c) => c.p_company_id === COMPANY_ID && c.p_event.tier_id === TIER_ID)).toBe(true);
  });

  it("ignores metadata.company_id without a matching payment row", async () => {
    service.queue("payments", { data: null, error: null });
    service.queue("company_subscriptions", { data: null, error: null });

    const res = await deliver("subscription.updated", subscription());

    expect(await res.json()).toEqual({ received: true, status: "error_logged" });
    expect(service.callsFor("apply_subscription_event")).toHaveLength(0);
  });

  it("logs a subscription event for a subscription we don't know", async () => {
    service.queue("company_subscriptions", { data: null, error: null });

    const res = await deliver("subscription.renewed", subscription({ metadata: {} }));

    expect(await res.json()).toEqual({ received: true, status: "error_logged" });
    expect(service.callsFor("apply_subscription_event")).toHaveLength(0);
  });

  it("payment.succeeded for a company pack calls fulfil_payment and emails the billing contacts, not an applicant", async () => {
    vi.mocked(billingContactsFor).mockResolvedValue({ companyName: "Acme", emails: ["owner@acme.dev"] });
    service.queue("payments", { data: CREDITS_ROW, error: null });
    service.queueRpc("fulfil_payment", {
      data: { status: "fulfilled", kind: "company_credits", credit_amount: 500 },
      error: null,
    });

    const res = await deliver(
      "payment.succeeded",
      paymentData({ metadata: { payment_row_id: CREDITS_ROW.id, company_id: COMPANY_ID, kind: "company_credits" } }),
    );

    expect(await res.json()).toEqual({ received: true, status: "processed" });
    expect(service.callsFor("fulfil_payment")[0].chain[0].args[1]).toMatchObject({ p_payment_row_id: CREDITS_ROW.id });
    // TMT-054 / TM-SEC-005: the owner (billing contacts), resolved by company id.
    expect(billingContactsFor).toHaveBeenCalledWith(COMPANY_ID);
    expect(SendPaymentUpdateEmail).toHaveBeenCalledTimes(1);
    expect(SendPaymentUpdateEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@acme.dev", paymentDetails: expect.objectContaining({ credit_amount: 500 }) }),
    );
    expect(service.callsFor("user_info")).toHaveLength(0);
    expect(eventCaptureServer).toHaveBeenCalledWith(
      expect.objectContaining({ event: "billing_credits_purchased", properties: expect.objectContaining({ credits: 500 }) }),
    );
  });

  it("payment.succeeded for a subscription only records it", async () => {
    service.queue("payments", { data: SUB_ROW, error: null });
    service.queueRpc("fulfil_payment", { data: { status: "recorded", kind: "company_subscription" }, error: null });

    const res = await deliver("payment.succeeded", paymentData({ metadata: { payment_row_id: SUB_ROW.id } }));

    expect(await res.json()).toEqual({ received: true, status: "processed" });
    expect(SendPaymentUpdateEmail).not.toHaveBeenCalled();
    expect(service.callsFor("apply_subscription_event")).toHaveLength(0);
  });

  it("a renewal payment with no checkout row is ignored, not an error", async () => {
    const res = await deliver(
      "payment.succeeded",
      paymentData({ checkout_session_id: null, subscription_id: "sub_1", metadata: {} }),
    );

    expect(await res.json()).toEqual({ received: true, status: "ignored" });
    expect(eventCaptureServer).not.toHaveBeenCalledWith(expect.objectContaining({ event: "billing_webhook_error" }));
  });
});
