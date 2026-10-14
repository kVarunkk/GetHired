import type { Database } from "@/utils/types/database.types";

type Tables = Database["public"]["Tables"];
type PricePlanRow = Tables["price_plan"]["Row"] & { audience: "applicant" | "company" };
type PaymentRow = Tables["payments"]["Row"];

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** BL-REQ-002, in the spec's order. */
export const ENTITLEMENT_KEYS = [
  "active_job_posts",
  "seats",
  "profiles_per_search",
  "screenings",
  "outreach",
  "interview_minutes",
  "agent_messages",
  "match_explanations",
] as const;

export type EntitlementKeyFixture = (typeof ENTITLEMENT_KEYS)[number];

export const LIMIT_KEYS: readonly EntitlementKeyFixture[] = [
  "active_job_posts",
  "seats",
  "profiles_per_search",
];

/** A `tier_entitlements` row. `amount: null` is unlimited; `overage_credits: null` is a hard stop. */
export type TierEntitlementRow = {
  tier_id: string;
  key: EntitlementKeyFixture;
  kind: "limit" | "allowance";
  amount: number | null;
  overage_credits: number | null;
};

export type TierFixture = {
  id: string;
  slug: "free" | "startup" | "growth" | "enterprise" | "founding";
  name: string;
  is_public: boolean;
  sort: number;
  entitlements: TierEntitlementRow[];
};

/** `[amount, overage]` per key; limits take no overage. */
type Amounts = Record<EntitlementKeyFixture, [number | null, (number | null)?]>;

function tier(
  n: number,
  slug: TierFixture["slug"],
  name: string,
  amounts: Amounts,
  { isPublic = true } = {},
): TierFixture {
  const id = `7e000000-0000-4000-8000-00000000001${n}`;
  return {
    id,
    slug,
    name,
    is_public: isPublic,
    sort: n,
    entitlements: ENTITLEMENT_KEYS.map((key) => {
      const kind = LIMIT_KEYS.includes(key) ? "limit" : "allowance";
      const [amount, overage = null] = amounts[key];
      return {
        tier_id: id,
        key,
        kind,
        amount,
        overage_credits: kind === "allowance" ? overage : null,
      };
    }),
  };
}

// Spec §5.1. Enterprise's "custom" amounts are unlimited until set per contract.
export const TIER_FREE = tier(0, "free", "Free", {
  active_job_posts: [2],
  seats: [2],
  profiles_per_search: [20],
  screenings: [50, null],
  match_explanations: [50, null],
  outreach: [10, null],
  interview_minutes: [30, 1],
  agent_messages: [100, null],
});

export const TIER_STARTUP = tier(1, "startup", "Startup", {
  active_job_posts: [10],
  seats: [5],
  profiles_per_search: [null],
  screenings: [500, 1],
  match_explanations: [1000, 0],
  outreach: [150, 2],
  interview_minutes: [600, 1],
  agent_messages: [2000, 0],
});

export const TIER_GROWTH = tier(2, "growth", "Growth", {
  active_job_posts: [30],
  seats: [15],
  profiles_per_search: [null],
  screenings: [2000, 1],
  match_explanations: [null],
  outreach: [600, 2],
  interview_minutes: [2400, 1],
  agent_messages: [null],
});

export const TIER_ENTERPRISE = tier(3, "enterprise", "Enterprise", {
  active_job_posts: [null],
  seats: [null],
  profiles_per_search: [null],
  screenings: [null],
  match_explanations: [null],
  outreach: [null],
  interview_minutes: [null],
  agent_messages: [null],
});

/** Not public: Startup's entitlements for pre-launch companies (BL-DEC-006). */
export const TIER_FOUNDING = tier(
  4,
  "founding",
  "Founding",
  {
    active_job_posts: [10],
    seats: [5],
    profiles_per_search: [null],
    screenings: [500, 1],
    match_explanations: [1000, 0],
    outreach: [150, 2],
    interview_minutes: [600, 1],
    agent_messages: [2000, 0],
  },
  { isPublic: false },
);

export const PUBLIC_TIERS = [TIER_FREE, TIER_STARTUP, TIER_GROWTH, TIER_ENTERPRISE];

export type EntitlementState = {
  kind: "limit" | "allowance";
  amount: number | null;
  used: number;
  held: number;
  remaining: number | null;
  overage_credits: number | null;
};

/** What `get_company_entitlements` returns. */
export type CompanyEntitlementsFixture = {
  tier_id: string;
  tier_slug: TierFixture["slug"];
  entitlements: Record<EntitlementKeyFixture, EntitlementState>;
  credit_balance: number;
  period_start: string;
  period_end: string;
};

/** Builds a `get_company_entitlements` result for `tier`, with optional usage and holds per key. */
export function entitlementsOf(
  t: TierFixture,
  used: Partial<Record<EntitlementKeyFixture, number>> = {},
  { held = {}, creditBalance = 0 }: {
    held?: Partial<Record<EntitlementKeyFixture, number>>;
    creditBalance?: number;
  } = {},
): CompanyEntitlementsFixture {
  const entitlements = Object.fromEntries(
    t.entitlements.map((e) => {
      const u = used[e.key] ?? 0;
      const h = held[e.key] ?? 0;
      return [
        e.key,
        {
          kind: e.kind,
          amount: e.amount,
          used: u,
          held: h,
          remaining: e.amount === null ? null : Math.max(0, e.amount - u - h),
          overage_credits: e.overage_credits,
        },
      ];
    }),
  ) as Record<EntitlementKeyFixture, EntitlementState>;

  return {
    tier_id: t.id,
    tier_slug: t.slug,
    entitlements,
    credit_balance: creditBalance,
    period_start: "2026-10-01T00:00:00.000Z",
    period_end: "2026-11-01T00:00:00.000Z",
  };
}

function pricePlan(
  id: string,
  name: string,
  credits: number,
  amount: number,
  productId: string,
  audience: PricePlanRow["audience"],
): PricePlanRow {
  return {
    id,
    name,
    description: `${credits} credits`,
    credit_amount: credits,
    amount,
    currency: "$",
    product_id: productId,
    audience,
    created_at: CREATED_AT,
    updated_at: null,
  };
}

/** Applicant packs, shaped like the live `price_plan` rows. */
export const APPLICANT_TRIAL_PLAN = pricePlan(
  "9a000000-0000-4000-8000-000000000001",
  "Trial Pack",
  50,
  5,
  "pdt_applicant_trial",
  "applicant",
);
export const APPLICANT_POWER_PLAN = pricePlan(
  "9a000000-0000-4000-8000-000000000002",
  "Power User",
  500,
  45,
  "pdt_applicant_power",
  "applicant",
);
/** Company pack (§5.1): must never be sold through the applicant checkout. */
export const COMPANY_CREDITS_PLAN = pricePlan(
  "9a000000-0000-4000-8000-000000000003",
  "100 credits",
  100,
  10,
  "pdt_company_100",
  "company",
);

let paymentSeq = 0;

export function paymentRowOf(overrides: Partial<PaymentRow> = {}): PaymentRow {
  paymentSeq += 1;
  return {
    id: `9b000000-0000-4000-8000-${paymentSeq.toString(16).padStart(12, "0")}`,
    user_id: "00000000-0000-4000-8000-000000000001",
    company_id: null,
    kind: "applicant_credits",
    tier_id: null,
    status: "pending",
    product_id: APPLICANT_TRIAL_PLAN.product_id,
    price_plan_id: APPLICANT_TRIAL_PLAN.id,
    credit_amount: APPLICANT_TRIAL_PLAN.credit_amount,
    credits_fulfilled: null,
    session_id: "cks_test_1",
    payment_id: null,
    failure_reason: null,
    fulfillment_date: null,
    currency: null,
    total_amount: null,
    customer: null,
    billing: null,
    email_sent: null,
    created_at: CREATED_AT,
    updated_at: null,
    ...overrides,
  };
}

/**
 * A Dodo webhook delivery: the raw body and the standard-webhooks headers.
 * Tests mock `client.webhooks.unwrap`, so the signature is a placeholder.
 */
export function dodoWebhook(
  type: string,
  data: Record<string, unknown>,
  { webhookId = "wh_test_1", signature = "v1,test" }: { webhookId?: string; signature?: string } = {},
) {
  const body = JSON.stringify({
    business_id: "bus_test",
    type,
    timestamp: "2026-10-14T00:00:00.000Z",
    data,
  });
  return {
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-signature": signature,
      "webhook-timestamp": "1760400000",
    },
  };
}
