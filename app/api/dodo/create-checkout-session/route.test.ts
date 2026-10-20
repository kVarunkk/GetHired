import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDodoClient } from "@/lib/dodo/initialize";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { buildRequest } from "@/test/utils/request";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICANT_TRIAL_PLAN } from "@/test/utils/billing";
import { POST } from "./route";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/dodo/initialize", () => ({ getDodoClient: vi.fn() }));

const APPLICANT = mockUser({ type: "applicant", email: "ada@example.com" });

let rls: SupabaseMock;
let service: SupabaseMock;
const createSession = vi.fn();

const post = (body: unknown) =>
  POST(buildRequest("/api/dodo/create-checkout-session", { method: "POST", body }));

const inserts = () =>
  service.callsFor("payments").flatMap((c) => c.chain.filter((m) => m.method === "insert"));

beforeEach(async () => {
  vi.clearAllMocks();
  rls = createSupabaseMock({ user: APPLICANT });
  service = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
  await setRequestUser(APPLICANT, rls.client);
  createSession.mockResolvedValue({
    session_id: "cks_1",
    checkout_url: "https://checkout.dodo.test/cks_1",
  });
  vi.mocked(getDodoClient).mockReturnValue({
    checkoutSessions: { create: createSession },
  } as unknown as ReturnType<typeof getDodoClient>);
});

// Today's body shape. BLT-012 drops productId and creditAmount from it.
const LEGACY_BODY = {
  productId: APPLICANT_TRIAL_PLAN.product_id,
  creditAmount: APPLICANT_TRIAL_PLAN.credit_amount,
  planId: APPLICANT_TRIAL_PLAN.id,
};

describe("POST /api/dodo/create-checkout-session (characterisation)", () => {
  it("refuses an unauthenticated caller", async () => {
    rls.setUser(null);
    await setRequestUser(null, rls.client);

    const res = await post(LEGACY_BODY);

    expect(res.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates a checkout for the plan's product and records a pending payment", async () => {
    service.queue("price_plan", { data: APPLICANT_TRIAL_PLAN, error: null });
    service.queue("payments", { data: { id: "9b000000-0000-4000-8000-0000000000aa" }, error: null });

    const res = await post(LEGACY_BODY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkoutUrl: "https://checkout.dodo.test/cks_1" });
    const args = createSession.mock.calls[0][0];
    expect(args.product_cart).toEqual([
      { product_id: APPLICANT_TRIAL_PLAN.product_id, quantity: 1 },
    ]);
    expect(args.customer).toEqual({ email: "ada@example.com" });
    expect(args.return_url).toMatch(/\/dashboard\/buy-credits\/status$/);

    const sessionWrites = service
      .callsFor("payments")
      .flatMap((c) => c.chain.filter((m) => m.method === "insert" || m.method === "update"))
      .map((m) => m.args[0] as Record<string, unknown>);
    expect(sessionWrites).toContainEqual(expect.objectContaining({ session_id: "cks_1" }));
    expect(inserts()[0].args[0]).toMatchObject({ user_id: APPLICANT.id, status: "pending" });
  });

  it("returns 500 when the payment row can't be written", async () => {
    service.queue("price_plan", { data: APPLICANT_TRIAL_PLAN, error: null });
    service.queue("payments", { data: null, error: { message: "insert failed" } });

    const res = await post(LEGACY_BODY);

    expect(res.status).toBe(500);
  });
});

// BL-TEST-001 (BL-F01): the product and the credit amount come from price_plan only.
describe("POST /api/dodo/create-checkout-session (BL-F01)", () => {
  const PAYMENT_ROW_ID = "9b000000-0000-4000-8000-0000000000aa";

  beforeEach(() => {
    service.queue("price_plan", { data: APPLICANT_TRIAL_PLAN, error: null });
    service.queue("payments", { data: { id: PAYMENT_ROW_ID }, error: null });
  });

  const forged = {
    planId: APPLICANT_TRIAL_PLAN.id,
    productId: "cheap",
    creditAmount: 30000,
  };

  it("loads the plan by planId and ignores productId and creditAmount from the body", async () => {
    const res = await post(forged);

    expect(res.status).toBe(200);
    const planQuery = service.callsFor("price_plan")[0].chain;
    expect(planQuery).toContainEqual({ method: "eq", args: ["id", APPLICANT_TRIAL_PLAN.id] });
    expect(createSession.mock.calls[0][0].product_cart).toEqual([
      { product_id: APPLICANT_TRIAL_PLAN.product_id, quantity: 1 },
    ]);
    expect(inserts()[0].args[0]).toMatchObject({
      credit_amount: APPLICANT_TRIAL_PLAN.credit_amount,
      product_id: APPLICANT_TRIAL_PLAN.product_id,
      price_plan_id: APPLICANT_TRIAL_PLAN.id,
    });
  });

  it("puts only ids in the checkout metadata", async () => {
    await post(forged);

    expect(createSession.mock.calls[0][0].metadata).toEqual({
      payment_row_id: PAYMENT_ROW_ID,
      user_id: APPLICANT.id,
      kind: "applicant_credits",
    });
  });

  it("inserts the payment row before calling Dodo, then stores the session id", async () => {
    const order: string[] = [];
    service.reset();
    service.queue("price_plan", { data: APPLICANT_TRIAL_PLAN, error: null });
    service.queue("payments", () => {
      order.push("insert");
      return { data: { id: PAYMENT_ROW_ID }, error: null };
    });
    createSession.mockImplementation(async () => {
      order.push("dodo");
      return { session_id: "cks_1", checkout_url: "https://checkout.dodo.test/cks_1" };
    });

    await post(forged);

    expect(order).toEqual(["insert", "dodo"]);
    const update = service
      .callsFor("payments")
      .find((c) => c.chain.some((m) => m.method === "update"))!;
    expect(update.chain).toContainEqual({ method: "update", args: [{ session_id: "cks_1" }] });
    expect(update.chain).toContainEqual({ method: "eq", args: ["id", PAYMENT_ROW_ID] });
  });

  it("marks the payment failed when Dodo errors", async () => {
    createSession.mockRejectedValue(new Error("dodo down"));

    const res = await post(forged);

    expect(res.status).toBe(500);
    const update = service
      .callsFor("payments")
      .find((c) => c.chain.some((m) => m.method === "update"))!;
    expect(update.chain[0].args[0]).toMatchObject({ status: "failed" });
    expect(update.chain).toContainEqual({ method: "eq", args: ["id", PAYMENT_ROW_ID] });
  });

  it.each([
    ["an unknown planId", APPLICANT_TRIAL_PLAN.id, null],
    ["a non-UUID planId", "not-a-uuid", APPLICANT_TRIAL_PLAN],
    ["a company plan", APPLICANT_TRIAL_PLAN.id, { ...APPLICANT_TRIAL_PLAN, audience: "company" }],
  ])("rejects %s with 400 and no Dodo call", async (_name, planId, row) => {
    service.reset();
    service.queue("price_plan", { data: row, error: null });

    const res = await post({ planId });

    expect(res.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);
  });

  it("takes the user from getUserFromRequest", async () => {
    // A bearer-token request: no cookie session on the SSR client.
    rls.setUser(null);

    const res = await post({ planId: APPLICANT_TRIAL_PLAN.id });

    expect(res.status).toBe(200);
    expect(inserts()[0].args[0]).toMatchObject({ user_id: APPLICANT.id });
  });
});
