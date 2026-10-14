// Entitlement keys (BL-REQ-002). The tier_entitlements.key check constraint in
// supabase/migrations/20261014150000_company_billing.sql lists the same keys.
// No server-only import: the billing UI uses these too.

export const LIMIT_KEYS = ["active_job_posts", "seats", "profiles_per_search"] as const;

export const ALLOWANCE_KEYS = [
  "screenings",
  "outreach",
  "interview_minutes",
  "agent_messages",
  "match_explanations",
] as const;

export const ENTITLEMENT_KEYS = [...LIMIT_KEYS, ...ALLOWANCE_KEYS] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];
export type AllowanceKey = (typeof ALLOWANCE_KEYS)[number];
export type EntitlementKey = LimitKey | AllowanceKey;
export type EntitlementKind = "limit" | "allowance";

export function isEntitlementKey(value: unknown): value is EntitlementKey {
  return typeof value === "string" && (ENTITLEMENT_KEYS as readonly string[]).includes(value);
}

export function kindOf(key: EntitlementKey): EntitlementKind {
  return (LIMIT_KEYS as readonly string[]).includes(key) ? "limit" : "allowance";
}

/** How each key reads in the UI: "12 screenings", "1 seat". */
export const KEY_LABELS: Record<EntitlementKey, { one: string; many: string }> = {
  active_job_posts: { one: "active job post", many: "active job posts" },
  seats: { one: "seat", many: "seats" },
  profiles_per_search: { one: "candidate per search", many: "candidates per search" },
  screenings: { one: "screening", many: "screenings" },
  outreach: { one: "outreach message", many: "outreach messages" },
  interview_minutes: { one: "interview minute", many: "interview minutes" },
  agent_messages: { one: "agent message", many: "agent messages" },
  match_explanations: { one: "match explanation", many: "match explanations" },
};

export function labelFor(key: EntitlementKey, n: number) {
  return n === 1 ? KEY_LABELS[key].one : KEY_LABELS[key].many;
}

/** The state of one key for a company, as get_company_entitlements returns it. */
export type EntitlementState = {
  kind: EntitlementKind;
  /** null = unlimited. */
  amount: number | null;
  used: number;
  held: number;
  /** null = unlimited. */
  remaining: number | null;
  /** Allowances only. null = hard stop when the allowance runs out. */
  overageCredits: number | null;
};
