// BL-REQ-020: the one error every limit and allowance raises. No server-only
// import: the client hook (hooks/useEntitlementError.tsx) reuses the type guard.
import { labelFor, type EntitlementKey, type EntitlementKind } from "./keys";

export type SuggestedTier = { slug: string; name: string };

export type EntitlementPayload = {
  key: EntitlementKey;
  kind: EntitlementKind;
  /** How many units the action needed. */
  qty: number;
  used: number;
  /** null = unlimited. */
  amount: number | null;
  overageCredits: number | null;
  creditBalance: number;
  /** Credits that would cover the shortfall, when overage is allowed. */
  creditsNeeded: number;
  /**
   * `member_limit`: the member's role caps this key per member, and they've
   * used it (RP-REQ-042). Distinct from the company running out.
   */
  reason: "limit_reached" | "insufficient_credits" | "member_limit";
  suggestedTier: SuggestedTier | null;
};

export type EntitlementActionError = {
  error: { code: "entitlement"; message: string } & EntitlementPayload;
};

export class EntitlementError extends Error {
  readonly payload: EntitlementPayload;

  constructor(payload: EntitlementPayload) {
    super(entitlementMessage(payload));
    this.name = "EntitlementError";
    this.payload = payload;
  }
}

/** RP-REQ-042: the member's role caps this key; nothing to buy, a role to change. */
export class MemberLimitError extends EntitlementError {
  constructor(payload: Omit<EntitlementPayload, "reason">) {
    super({ ...payload, reason: "member_limit", suggestedTier: null });
    this.name = "MemberLimitError";
  }
}

export function entitlementMessage(p: EntitlementPayload) {
  const what = labelFor(p.key, p.amount ?? 0);
  if (p.reason === "member_limit") {
    // RP-GUD-002: no role names in copy.
    return p.amount === 0
      ? `Your role can't use ${labelFor(p.key, 2)}. Ask someone who manages roles to change your role's limit.`
      : `You've used your ${p.amount} ${what} for this month. Ask someone who manages roles to raise your role's limit.`;
  }
  if (p.kind === "limit") {
    return `Your plan allows ${p.amount} ${what}. Upgrade to add more.`;
  }
  if (p.reason === "insufficient_credits") {
    return `You've used your ${what} for this period and need ${p.creditsNeeded} credits to continue.`;
  }
  return `You've used ${p.used} of ${p.amount} ${what} this period.`;
}

/** A route's answer to an EntitlementError: 402 with the payload. */
export function toEntitlementResponse(err: EntitlementError) {
  return Response.json(
    { code: "entitlement", error: err.message, ...err.payload },
    { status: 402 },
  );
}

/** A server action's answer to an EntitlementError. */
export function toEntitlementActionError(err: EntitlementError): EntitlementActionError {
  return { error: { code: "entitlement", message: err.message, ...err.payload } };
}

/** True for a 402 body or for the `error` of an action result. */
export function isEntitlementPayload(
  value: unknown,
): value is EntitlementPayload & { code: "entitlement" } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.code === "entitlement" && typeof v.key === "string" && typeof v.kind === "string";
}

/** The payload inside a server action result, if it failed on an entitlement. */
export function entitlementFromActionResult(result: unknown): EntitlementPayload | null {
  if (!result || typeof result !== "object") return null;
  const error = (result as { error?: unknown }).error;
  return isEntitlementPayload(error) ? error : null;
}
