import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_KEYS,
  PUBLIC_TIERS,
  TIER_FOUNDING,
  TIER_FREE,
  TIER_STARTUP,
  dodoWebhook,
  entitlementsOf,
} from "./billing";

const ALL_TIERS = [...PUBLIC_TIERS, TIER_FOUNDING];

describe("billing fixtures", () => {
  it.each(ALL_TIERS.map((t) => [t.slug, t] as const))(
    "%s has every entitlement key exactly once",
    (_slug, t) => {
      expect(t.entitlements.map((e) => e.key).sort()).toEqual([...ENTITLEMENT_KEYS].sort());
    },
  );

  it("only sets overage_credits on allowances", () => {
    for (const t of ALL_TIERS) {
      for (const e of t.entitlements) {
        if (e.kind === "limit") expect(e.overage_credits, `${t.slug}.${e.key}`).toBeNull();
      }
    }
    // Some allowance does carry an overage, so the check above isn't vacuous.
    expect(TIER_STARTUP.entitlements.find((e) => e.key === "screenings")?.overage_credits).toBe(1);
  });

  it("sorts Free < Startup < Growth < Enterprise", () => {
    const sorted = [...PUBLIC_TIERS].sort((a, b) => a.sort - b.sort).map((t) => t.slug);
    expect(sorted).toEqual(["free", "startup", "growth", "enterprise"]);
  });

  it("hides the founding tier", () => {
    expect(TIER_FOUNDING.is_public).toBe(false);
    expect(PUBLIC_TIERS.every((t) => t.is_public)).toBe(true);
  });

  it("entitlementsOf computes remaining, keeping unlimited as null", () => {
    const e = entitlementsOf(TIER_FREE, { screenings: 45 }, { held: { screenings: 3 } });
    expect(e.entitlements.screenings).toMatchObject({ used: 45, held: 3, remaining: 2 });
    expect(entitlementsOf(TIER_STARTUP).entitlements.profiles_per_search.remaining).toBeNull();
  });

  it("dodoWebhook carries the webhook id header and the event type", () => {
    const { body, headers } = dodoWebhook("payment.succeeded", { payment_id: "pay_1" }, { webhookId: "wh_9" });
    expect(headers["webhook-id"]).toBe("wh_9");
    expect(JSON.parse(body)).toMatchObject({ type: "payment.succeeded", data: { payment_id: "pay_1" } });
  });
});
