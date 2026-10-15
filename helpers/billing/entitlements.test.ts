import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import {
  PUBLIC_TIERS,
  TIER_FREE,
  TIER_STARTUP,
  entitlementsOf,
  type TierFixture,
} from "@/test/utils/billing";
import { COMPANY_A } from "@/test/utils/recruiter";
import { EntitlementError } from "./errors";
import type { Plan } from "./plans";
import {
  assertAllowance,
  assertLimit,
  checkEntitlement,
  consumeEntitlement,
  getEntitlements,
  holdEntitlement,
  releaseHold,
  suggestedTierFor,
} from "./entitlements";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./plans", () => ({ listPublicPlans: vi.fn() }));

const { listPublicPlans } = await import("./plans");

const asPlan = (t: TierFixture): Plan => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  description: null,
  features: [],
  sort: t.sort,
  prices: [],
  entitlements: Object.fromEntries(
    t.entitlements.map((e) => [e.key, { kind: e.kind, amount: e.amount, overageCredits: e.overage_credits }]),
  ),
});
const PLANS = PUBLIC_TIERS.map(asPlan);

let db: SupabaseMock;
const rpcArgs = (fn: string, i = 0) => db.callsFor(fn)[i]?.chain[0].args[1];

beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  vi.mocked(listPublicPlans).mockResolvedValue(PLANS);
});

describe("getEntitlements", () => {
  it("maps get_company_entitlements, keeping unlimited as null", async () => {
    db.queueRpc("get_company_entitlements", {
      data: entitlementsOf(TIER_STARTUP, { screenings: 12 }, { creditBalance: 40 }),
      error: null,
    });

    const e = await getEntitlements(COMPANY_A.id);

    expect(rpcArgs("get_company_entitlements")).toEqual({ p_company_id: COMPANY_A.id });
    expect(e.tier.slug).toBe("startup");
    expect(e.entitlements.screenings).toEqual({
      kind: "allowance",
      amount: 500,
      used: 12,
      held: 0,
      remaining: 488,
      overageCredits: 1,
    });
    expect(e.entitlements.profiles_per_search.amount).toBeNull();
    expect(e.creditBalance).toBe(40);
  });
});

describe("checkEntitlement", () => {
  it("passes qty through and maps the result", async () => {
    db.queueRpc("check_entitlement", {
      data: { allowed: true, source: "mixed", credits_needed: 3, reason: null },
      error: null,
    });

    expect(await checkEntitlement(COMPANY_A.id, "screenings", 5)).toEqual({
      allowed: true,
      source: "mixed",
      creditsNeeded: 3,
      reason: null,
    });
    expect(rpcArgs("check_entitlement")).toEqual({ p_company_id: COMPANY_A.id, p_key: "screenings", p_qty: 5 });
  });
});

describe("consumeEntitlement", () => {
  const REF = { type: "application_screening", id: "e0000000-0000-4000-8000-000000000001" };

  it("passes the ref and actor through", async () => {
    db.queueRpc("consume_entitlement", {
      data: { ok: true, source: "allowance", credits_spent: 0 },
      error: null,
    });

    const r = await consumeEntitlement(COMPANY_A.id, "screenings", 1, REF, COMPANY_A.user.id);

    expect(r).toEqual({ source: "allowance", creditsSpent: 0, duplicate: false });
    expect(rpcArgs("consume_entitlement")).toEqual({
      p_company_id: COMPANY_A.id,
      p_key: "screenings",
      p_qty: 1,
      p_ref_type: REF.type,
      p_ref_id: REF.id,
      p_actor: COMPANY_A.user.id,
    });
  });

  it("throws an EntitlementError with the payload filled in", async () => {
    db.queueRpc("consume_entitlement", { data: { ok: false, reason: "limit_reached" }, error: null });
    db.queueRpc("get_company_entitlements", {
      data: entitlementsOf(TIER_FREE, { screenings: 50 }, { creditBalance: 7 }),
      error: null,
    });

    const err = await consumeEntitlement(COMPANY_A.id, "screenings", 1, REF).catch((e) => e);

    expect(err).toBeInstanceOf(EntitlementError);
    expect(err.payload).toEqual({
      key: "screenings",
      kind: "allowance",
      qty: 1,
      used: 50,
      amount: 50,
      overageCredits: null,
      creditBalance: 7,
      creditsNeeded: 0,
      reason: "limit_reached",
      suggestedTier: { slug: "startup", name: "Startup" },
    });
  });

  it("throws a plain error when the RPC fails", async () => {
    db.queueRpc("consume_entitlement", { data: null, error: { message: "boom" } });

    const err = await consumeEntitlement(COMPANY_A.id, "screenings", 1, REF).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EntitlementError);
  });
});

describe("holds", () => {
  const REF = { type: "interview_invite", id: "inv-1" };

  it("hold then consume use the same ref; release passes it", async () => {
    db.queueRpc("hold_entitlement", { data: { ok: true }, error: null });
    db.queueRpc("consume_entitlement", { data: { ok: true, source: "allowance", credits_spent: 0 }, error: null });
    db.queueRpc("release_hold", { data: true, error: null });

    await holdEntitlement(COMPANY_A.id, "interview_minutes", 15, REF);
    await consumeEntitlement(COMPANY_A.id, "interview_minutes", 15, REF);
    expect(await releaseHold(COMPANY_A.id, "interview_minutes", REF)).toBe(true);

    expect(rpcArgs("hold_entitlement")).toMatchObject({ p_ref_type: REF.type, p_ref_id: REF.id, p_qty: 15 });
    expect(rpcArgs("consume_entitlement")).toMatchObject({ p_ref_type: REF.type, p_ref_id: REF.id });
    expect(rpcArgs("release_hold")).toEqual({
      p_company_id: COMPANY_A.id,
      p_ref_type: REF.type,
      p_ref_id: REF.id,
      p_key: "interview_minutes",
    });
  });

  it("a failed hold throws an EntitlementError", async () => {
    db.queueRpc("hold_entitlement", { data: { ok: false, reason: "insufficient_credits", credits_needed: 5 }, error: null });
    db.queueRpc("get_company_entitlements", { data: entitlementsOf(TIER_FREE, { interview_minutes: 30 }), error: null });

    const err = await holdEntitlement(COMPANY_A.id, "interview_minutes", 5, REF).catch((e) => e);

    expect(err).toBeInstanceOf(EntitlementError);
    expect(err.payload).toMatchObject({ reason: "insufficient_credits", creditsNeeded: 5 });
  });
});

describe("assertLimit", () => {
  it("throws when the limit is reached", async () => {
    db.queueRpc("check_entitlement", { data: { allowed: false, source: null, credits_needed: 0, reason: "limit_reached" }, error: null });
    db.queueRpc("get_company_entitlements", { data: entitlementsOf(TIER_FREE, { active_job_posts: 2 }), error: null });

    const err = await assertLimit(COMPANY_A.id, "active_job_posts").catch((e) => e);

    expect(err).toBeInstanceOf(EntitlementError);
    expect(err.payload).toMatchObject({ key: "active_job_posts", kind: "limit", used: 2, amount: 2 });
    expect(err.payload.suggestedTier).toEqual({ slug: "startup", name: "Startup" });
  });

  it("resolves when allowed", async () => {
    db.queueRpc("check_entitlement", { data: { allowed: true, source: "allowance", credits_needed: 0, reason: null }, error: null });

    await expect(assertLimit(COMPANY_A.id, "active_job_posts")).resolves.toBeUndefined();
  });

  it("only takes limit keys", () => {
    // @ts-expect-error screenings is an allowance, not a limit
    void (() => assertLimit(COMPANY_A.id, "screenings"));
  });
});

describe("assertAllowance", () => {
  it("throws with the check's reason when the allowance is used up, and charges nothing", async () => {
    db.queueRpc("check_entitlement", {
      data: { allowed: false, source: null, credits_needed: 3, reason: "insufficient_credits" },
      error: null,
    });
    db.queueRpc("get_company_entitlements", { data: entitlementsOf(TIER_FREE), error: null });

    const err = await assertAllowance(COMPANY_A.id, "screenings").catch((e) => e);

    expect(err).toBeInstanceOf(EntitlementError);
    expect(err.payload).toMatchObject({
      key: "screenings",
      kind: "allowance",
      reason: "insufficient_credits",
      creditsNeeded: 3,
    });
    expect(db.callsFor("consume_entitlement")).toHaveLength(0);
  });

  it("resolves when allowed", async () => {
    db.queueRpc("check_entitlement", { data: { allowed: true, source: "allowance", credits_needed: 0, reason: null }, error: null });

    await expect(assertAllowance(COMPANY_A.id, "screenings")).resolves.toBeUndefined();
  });

  it("only takes allowance keys", () => {
    // @ts-expect-error active_job_posts is a limit, not an allowance
    void (() => assertAllowance(COMPANY_A.id, "active_job_posts"));
  });
});

describe("suggestedTierFor", () => {
  it("is the cheapest higher public plan that fits", () => {
    expect(suggestedTierFor(PLANS, "free", "active_job_posts", 3)).toEqual({ slug: "startup", name: "Startup" });
    expect(suggestedTierFor(PLANS, "free", "active_job_posts", 11)).toEqual({ slug: "growth", name: "Growth" });
    expect(suggestedTierFor(PLANS, "startup", "agent_messages", 2001)).toEqual({ slug: "growth", name: "Growth" });
  });

  it("counts unlimited as fitting, and is null when nothing above fits", () => {
    expect(suggestedTierFor(PLANS, "growth", "active_job_posts", 31)).toEqual({ slug: "enterprise", name: "Enterprise" });
    expect(suggestedTierFor(PLANS, "enterprise", "seats", 100)).toBeNull();
  });
});

it("imports server-only", () => {
  expect(readFileSync(new URL("./entitlements.ts", import.meta.url), "utf8")).toMatch(/^import "server-only";/);
});
