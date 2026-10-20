import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPublicClient } from "@/lib/supabase/public";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { TIER_FREE, TIER_GROWTH, TIER_STARTUP, type TierFixture } from "@/test/utils/billing";
import { formatPrice, getPlanBySlug, listPublicPlans, priceFor } from "./plans";

const cacheCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown, ...rest: unknown[]) => {
    cacheCalls.push(rest);
    return fn;
  },
}));
vi.mock("@/lib/supabase/public", () => ({ createPublicClient: vi.fn() }));

const STARTUP_PRICES = [
  { interval: "month", currency: "USD", amount_minor: 4900, dodo_product_id: "pdt_s_m_usd" },
  { interval: "year", currency: "INR", amount_minor: 2999000, dodo_product_id: "pdt_s_y_inr" },
];

const row = (t: TierFixture, prices: unknown[] = []) => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  description: null,
  features: [],
  sort: t.sort,
  prices,
  is_public: t.is_public,
  tier_entitlements: t.entitlements.map((e) => ({
    key: e.key,
    kind: e.kind,
    amount: e.amount,
    overage_credits: e.overage_credits,
  })),
});

let db: SupabaseMock;

beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createPublicClient).mockReturnValue(db.client);
  // Out of order, to show the result is sorted.
  db.queue("company_tiers", {
    data: [row(TIER_GROWTH), row(TIER_FREE), row(TIER_STARTUP, STARTUP_PRICES)],
    error: null,
  });
});

describe("listPublicPlans (BL-TEST-004)", () => {
  it("returns public plans in order with their entitlements", async () => {
    const plans = await listPublicPlans();

    expect(plans.map((p) => p.slug)).toEqual(["free", "startup", "growth"]);
    expect(plans[0].entitlements.screenings).toEqual({ kind: "allowance", amount: 50, overageCredits: null });
    expect(plans[1].entitlements.profiles_per_search?.amount).toBeNull();
    const query = db.callsFor("company_tiers")[0].chain;
    expect(query).toContainEqual({ method: "eq", args: ["is_public", true] });
  });

  it("is cached under the billing-plans tag", () => {
    expect(cacheCalls[0]).toEqual([expect.any(Array), expect.objectContaining({ tags: ["billing-plans"] })]);
  });

  it("hides a non-public tier even if the query returned it", async () => {
    db.reset();
    db.queue("company_tiers", {
      data: [row(TIER_FREE), { ...row(TIER_STARTUP), slug: "founding", is_public: false }],
      error: null,
    });

    expect((await listPublicPlans()).map((p) => p.slug)).toEqual(["free"]);
  });

  it("getPlanBySlug finds a public plan, and not a hidden one", async () => {
    expect((await getPlanBySlug("startup"))?.name).toBe("Startup");
    db.queue("company_tiers", { data: [row(TIER_FREE)], error: null });
    expect(await getPlanBySlug("founding")).toBeNull();
  });
});

describe("priceFor", () => {
  it("picks the price for the interval and currency", () => {
    const plan = { prices: STARTUP_PRICES as never };
    expect(priceFor(plan, "month", "USD")?.dodo_product_id).toBe("pdt_s_m_usd");
    expect(priceFor(plan, "year", "INR")?.amount_minor).toBe(2999000);
    expect(priceFor(plan, "year", "USD")).toBeNull();
  });

  it("formats prices", () => {
    expect(formatPrice({ amount_minor: 4900, currency: "USD" })).toBe("$49");
    expect(formatPrice({ amount_minor: 299900, currency: "INR" })).toBe("₹2,999");
  });
});
