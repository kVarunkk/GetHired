import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isEntitlementKey, type EntitlementKey, type EntitlementKind } from "./keys";

export type BillingInterval = "month" | "year";
export type BillingCurrency = "USD" | "INR";

export type PlanPrice = {
  interval: BillingInterval;
  currency: BillingCurrency;
  /** In the smallest unit (cents, paise). */
  amount_minor: number;
  dodo_product_id: string | null;
};

export type PlanEntitlement = {
  kind: EntitlementKind;
  amount: number | null;
  overageCredits: number | null;
};

export type Plan = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  features: string[];
  sort: number;
  prices: PlanPrice[];
  entitlements: Partial<Record<EntitlementKey, PlanEntitlement>>;
};

export const BILLING_PLANS_TAG = "billing-plans";

/**
 * Public plans in display order, with their entitlements (the pricing page and
 * the upgrade suggestion). Hidden tiers (founding, legacy) aren't listed. A few
 * rows, cached for an hour under `billing-plans`.
 */
export const listPublicPlans = unstable_cache(
  async (): Promise<Plan[]> => {
    const { data, error } = await createPublicClient()
      .from("company_tiers")
      .select(
        "id, slug, name, description, features, sort, prices, is_public, tier_entitlements(key, kind, amount, overage_credits)",
      )
      .eq("is_public", true)
      .order("sort", { ascending: true });
    if (error) throw new Error(`Failed to load plans: ${error.message}`);

    return (data ?? [])
      .filter((t) => t.is_public && t.slug)
      .map((t) => ({
        id: t.id,
        slug: t.slug as string,
        name: t.name ?? t.slug ?? "",
        description: t.description,
        features: t.features ?? [],
        sort: t.sort,
        prices: Array.isArray(t.prices) ? (t.prices as unknown as PlanPrice[]) : [],
        entitlements: Object.fromEntries(
          (t.tier_entitlements ?? [])
            .filter((e) => isEntitlementKey(e.key))
            .map((e) => [
              e.key,
              {
                kind: e.kind as EntitlementKind,
                amount: e.amount,
                overageCredits: e.overage_credits,
              },
            ]),
        ),
      }))
      .sort((a, b) => a.sort - b.sort);
  },
  ["billing-public-plans"],
  { revalidate: 3600, tags: [BILLING_PLANS_TAG] },
);

export async function getPlanBySlug(slug: string): Promise<Plan | null> {
  return (await listPublicPlans()).find((p) => p.slug === slug) ?? null;
}

export function priceFor(
  plan: Pick<Plan, "prices">,
  interval: BillingInterval,
  currency: BillingCurrency,
): PlanPrice | null {
  return plan.prices.find((p) => p.interval === interval && p.currency === currency) ?? null;
}

/** "$49", "₹2,999". */
export function formatPrice(price: Pick<PlanPrice, "amount_minor" | "currency">) {
  return new Intl.NumberFormat(price.currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: price.currency,
    maximumFractionDigits: price.amount_minor % 100 === 0 ? 0 : 2,
  }).format(price.amount_minor / 100);
}
