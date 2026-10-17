import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { EntitlementError, MemberLimitError, type EntitlementPayload, type SuggestedTier } from "./errors";
import {
  ENTITLEMENT_KEYS,
  kindOf,
  type AllowanceKey,
  type EntitlementKey,
  type EntitlementKind,
  type EntitlementState,
  type LimitKey,
} from "./keys";
import { listPublicPlans, type Plan } from "./plans";

// The one entitlement API (BL-CON-002). Every feature calls these, after it has
// resolved the company from the session with requireCompany(); they never take
// a company id from user input. All of them run the SQL functions in
// 20261014150000_company_billing.sql through the service role.

export type CreditLot = {
  id: string;
  remaining: number;
  expiresAt: string | null;
  reason: string;
  createdAt: string;
};

export type CompanyEntitlements = {
  tier: { id: string; slug: string; name: string };
  /** The tier on the subscription, which differs from `tier` during a lapse. */
  subscribedTierSlug: string | null;
  status: "active" | "past_due" | "cancelled" | "expired";
  billingInterval: "month" | "year" | null;
  currency: string | null;
  /** The monthly usage period (allowances reset at `end`). */
  period: { start: string; end: string };
  /** The subscription's period end: when a paid plan renews or a cancellation applies. */
  renewsAt: string;
  cancelAtPeriodEnd: boolean;
  scheduledTierSlug: string | null;
  graceUntil: string | null;
  manualUntil: string | null;
  hasPaidSubscription: boolean;
  hasBillingPortal: boolean;
  entitlements: Record<EntitlementKey, EntitlementState>;
  creditBalance: number;
  creditLots: CreditLot[];
};

export type CheckResult = {
  allowed: boolean;
  source: "allowance" | "credits" | "mixed" | null;
  creditsNeeded: number;
  reason: "limit_reached" | "insufficient_credits" | null;
};

export type ConsumeResult = {
  source: "allowance" | "credits" | "mixed";
  creditsSpent: number;
  /** The ref was already charged; nothing new was spent. */
  duplicate: boolean;
};

/** What a charge is for, e.g. `{ type: "application_screening", id }`. Idempotency key. */
export type EntitlementRef = { type: string; id: string };

type RawState = {
  kind: EntitlementKind;
  amount: number | null;
  used: number;
  held: number;
  remaining: number | null;
  overage_credits: number | null;
};

type RawEntitlements = {
  tier_id: string;
  tier_slug: string;
  tier_name: string | null;
  subscribed_tier_slug: string | null;
  status: CompanyEntitlements["status"];
  billing_interval: CompanyEntitlements["billingInterval"];
  currency: string | null;
  period_start: string;
  period_end: string;
  renews_at: string;
  cancel_at_period_end: boolean;
  scheduled_tier_slug: string | null;
  grace_until: string | null;
  manual_until: string | null;
  has_paid_subscription: boolean;
  has_billing_portal: boolean;
  entitlements: Partial<Record<EntitlementKey, RawState>>;
  credit_balance: number;
  credit_lots: { id: string; remaining: number; expires_at: string | null; reason: string; created_at: string }[];
};

function db() {
  return createServiceRoleClient();
}

function mapState(key: EntitlementKey, raw: RawState | undefined): EntitlementState {
  if (!raw) {
    // Not in the plan: nothing allowed.
    return { kind: kindOf(key), amount: 0, used: 0, held: 0, remaining: 0, overageCredits: null };
  }
  return {
    kind: raw.kind,
    amount: raw.amount,
    used: raw.used ?? 0,
    held: raw.held ?? 0,
    remaining: raw.remaining,
    overageCredits: raw.overage_credits,
  };
}

export async function getEntitlements(companyId: string): Promise<CompanyEntitlements> {
  const { data, error } = await db().rpc("get_company_entitlements", { p_company_id: companyId });
  if (error || !data) throw new Error(`Failed to load entitlements: ${error?.message ?? "no data"}`);
  const raw = data as unknown as RawEntitlements;

  return {
    tier: { id: raw.tier_id, slug: raw.tier_slug, name: raw.tier_name ?? raw.tier_slug },
    subscribedTierSlug: raw.subscribed_tier_slug,
    status: raw.status,
    billingInterval: raw.billing_interval,
    currency: raw.currency,
    period: { start: raw.period_start, end: raw.period_end },
    renewsAt: raw.renews_at ?? raw.period_end,
    cancelAtPeriodEnd: raw.cancel_at_period_end,
    scheduledTierSlug: raw.scheduled_tier_slug,
    graceUntil: raw.grace_until,
    manualUntil: raw.manual_until,
    hasPaidSubscription: raw.has_paid_subscription,
    hasBillingPortal: raw.has_billing_portal,
    entitlements: Object.fromEntries(
      ENTITLEMENT_KEYS.map((k) => [k, mapState(k, raw.entitlements?.[k])]),
    ) as Record<EntitlementKey, EntitlementState>,
    creditBalance: raw.credit_balance ?? 0,
    creditLots: (raw.credit_lots ?? []).map((l) => ({
      id: l.id,
      remaining: l.remaining,
      expiresAt: l.expires_at,
      reason: l.reason,
      createdAt: l.created_at,
    })),
  };
}

export async function checkEntitlement(
  companyId: string,
  key: EntitlementKey,
  qty = 1,
): Promise<CheckResult> {
  const { data, error } = await db().rpc("check_entitlement", {
    p_company_id: companyId,
    p_key: key,
    p_qty: qty,
  });
  if (error || !data) throw new Error(`check_entitlement failed: ${error?.message ?? "no data"}`);
  const r = data as { allowed: boolean; source: CheckResult["source"]; credits_needed: number; reason: CheckResult["reason"] };
  return {
    allowed: r.allowed,
    source: r.source ?? null,
    creditsNeeded: r.credits_needed ?? 0,
    reason: r.reason ?? null,
  };
}

/**
 * The cheapest public plan above the current one that would allow `used + qty`
 * of `key` (null amount = unlimited). Never suggests Free.
 */
export function suggestedTierFor(
  plans: Plan[],
  currentSlug: string,
  key: EntitlementKey,
  needed: number,
): SuggestedTier | null {
  const currentSort = plans.find((p) => p.slug === currentSlug)?.sort ?? 0;
  const next = [...plans]
    .sort((a, b) => a.sort - b.sort)
    .find((p) => {
      if (p.slug === "free" || p.slug === currentSlug || p.sort <= currentSort) return false;
      const amount = p.entitlements[key]?.amount;
      return amount === null || (amount !== undefined && amount >= needed);
    });
  return next ? { slug: next.slug, name: next.name } : null;
}

async function entitlementError(
  companyId: string,
  key: EntitlementKey,
  qty: number,
  reason: EntitlementPayload["reason"],
  creditsNeeded: number,
): Promise<EntitlementError> {
  const current = await getEntitlements(companyId);
  const state = current.entitlements[key];
  let plans: Plan[] = [];
  try {
    plans = await listPublicPlans();
  } catch (err) {
    console.error("[billing] couldn't load plans for the upgrade suggestion", err);
  }
  return new EntitlementError({
    key,
    kind: state.kind,
    qty,
    used: state.used + (state.kind === "allowance" ? state.held : 0),
    amount: state.amount,
    overageCredits: state.overageCredits,
    creditBalance: current.creditBalance,
    creditsNeeded,
    reason,
    suggestedTier: suggestedTierFor(plans, current.tier.slug, key, state.used + state.held + qty),
  });
}

/**
 * RP-REQ-042: over the member's cap, the RPCs return `member_limit` with the
 * cap and what they've used, never an upgrade (it's a role setting).
 */
function memberLimitError(key: AllowanceKey, qty: number, r: { limit?: number; used?: number }) {
  return new MemberLimitError({
    key,
    kind: "allowance",
    qty,
    used: r.used ?? 0,
    amount: r.limit ?? 0,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    suggestedTier: null,
  });
}

/**
 * Charges an allowance (then credits). Throws EntitlementError when it can't,
 * or MemberLimitError over the actor's per-member cap (RP-REQ-042).
 * `actorUserId` is the session user who spends it, from the session and never
 * input; `null` only for work the system starts itself (RP-REQ-043). A
 * conversion of a hold is charged to whoever took the hold.
 */
export async function consumeEntitlement(
  companyId: string,
  key: AllowanceKey,
  qty: number,
  ref: EntitlementRef,
  actorUserId: string | null,
): Promise<ConsumeResult> {
  const { data, error } = await db().rpc("consume_entitlement", {
    p_company_id: companyId,
    p_key: key,
    p_qty: qty,
    p_ref_type: ref.type,
    p_ref_id: ref.id,
    ...(actorUserId ? { p_actor: actorUserId } : {}),
  });
  if (error || !data) throw new Error(`consume_entitlement failed: ${error?.message ?? "no data"}`);
  const r = data as {
    ok: boolean;
    source?: ConsumeResult["source"];
    credits_spent?: number;
    duplicate?: boolean;
    reason?: EntitlementPayload["reason"];
    credits_needed?: number;
    limit?: number;
    used?: number;
  };
  if (!r.ok) {
    if (r.reason === "member_limit") throw memberLimitError(key, qty, r);
    throw await entitlementError(companyId, key, qty, r.reason ?? "limit_reached", r.credits_needed ?? 0);
  }
  return { source: r.source ?? "allowance", creditsSpent: r.credits_spent ?? 0, duplicate: r.duplicate ?? false };
}

/**
 * Sets units aside for committed work (BL-REQ-006). Consume later with the
 * same ref. The hold records the actor, so the later charge counts toward
 * their cap (RP-REQ-043).
 */
export async function holdEntitlement(
  companyId: string,
  key: AllowanceKey,
  qty: number,
  ref: EntitlementRef,
  actorUserId: string | null,
  { expiresAt }: { expiresAt?: Date } = {},
): Promise<void> {
  const { data, error } = await db().rpc("hold_entitlement", {
    p_company_id: companyId,
    p_key: key,
    p_qty: qty,
    p_ref_type: ref.type,
    p_ref_id: ref.id,
    ...(expiresAt ? { p_expires_at: expiresAt.toISOString() } : {}),
    ...(actorUserId ? { p_actor: actorUserId } : {}),
  });
  if (error || !data) throw new Error(`hold_entitlement failed: ${error?.message ?? "no data"}`);
  const r = data as {
    ok: boolean;
    reason?: EntitlementPayload["reason"];
    credits_needed?: number;
    limit?: number;
    used?: number;
  };
  if (!r.ok) {
    if (r.reason === "member_limit") throw memberLimitError(key, qty, r);
    throw await entitlementError(companyId, key, qty, r.reason ?? "limit_reached", r.credits_needed ?? 0);
  }
}

export async function releaseHold(
  companyId: string,
  key: AllowanceKey,
  ref: EntitlementRef,
): Promise<boolean> {
  const { data, error } = await db().rpc("release_hold", {
    p_company_id: companyId,
    p_ref_type: ref.type,
    p_ref_id: ref.id,
    p_key: key,
  });
  if (error) throw new Error(`release_hold failed: ${error.message}`);
  return data === true;
}

/** Throws EntitlementError when adding `qty` would go over a capacity limit. */
export async function assertLimit(companyId: string, key: LimitKey, qty = 1): Promise<void> {
  const result = await checkEntitlement(companyId, key, qty);
  if (!result.allowed) {
    throw await entitlementError(companyId, key, qty, "limit_reached", 0);
  }
}

/** The actor's per-member cap and use this period for `key`, or null when uncapped (RP-REQ-044). */
export async function getMemberLimit(
  companyId: string,
  key: AllowanceKey,
  actorUserId: string | null,
): Promise<{ limit: number; used: number; remaining: number } | null> {
  if (!actorUserId) return null;
  const { data, error } = await db().rpc("check_member_limit", {
    p_company_id: companyId,
    p_key: key,
    p_qty: 1,
    p_actor: actorUserId,
  });
  if (error || !data) throw new Error(`check_member_limit failed: ${error?.message ?? "no data"}`);
  const r = data as { limit: number | null; used: number | null };
  if (r.limit === null || r.limit === undefined) return null;
  const used = r.used ?? 0;
  return { limit: r.limit, used, remaining: Math.max(r.limit - used, 0) };
}

/**
 * Throws EntitlementError when `qty` more of an allowance (or its credit
 * overage) can't be used right now, or MemberLimitError over the actor's cap.
 * Charges nothing: for a preflight before queueing work that
 * `consumeEntitlement` charges later.
 */
export async function assertAllowance(
  companyId: string,
  key: AllowanceKey,
  qty: number,
  actorUserId: string | null,
): Promise<void> {
  const cap = await getMemberLimit(companyId, key, actorUserId);
  if (cap && cap.used + qty > cap.limit) throw memberLimitError(key, qty, cap);
  const result = await checkEntitlement(companyId, key, qty);
  if (!result.allowed) {
    throw await entitlementError(companyId, key, qty, result.reason ?? "limit_reached", result.creditsNeeded);
  }
}

/** "Plan: Startup · 1,240 credits" (navbar and profile menu). */
export async function getPlanSummary(companyId: string) {
  const e = await getEntitlements(companyId);
  return { name: e.tier.name, slug: e.tier.slug, credits: e.creditBalance, status: e.status };
}

/** Display names for tier ids (emails). */
export async function getTierNames(tierIds: string[]): Promise<Map<string, string>> {
  if (tierIds.length === 0) return new Map();
  const { data, error } = await db().from("company_tiers").select("id, name, slug").in("id", tierIds);
  if (error) throw new Error(`Failed to load tiers: ${error.message}`);
  return new Map((data ?? []).map((t) => [t.id, t.name ?? t.slug ?? ""]));
}
