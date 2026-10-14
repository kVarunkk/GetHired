import { describe, expect, it } from "vitest";
import {
  EntitlementError,
  entitlementFromActionResult,
  isEntitlementPayload,
  toEntitlementActionError,
  toEntitlementResponse,
  type EntitlementPayload,
} from "./errors";

const PAYLOAD: EntitlementPayload = {
  key: "screenings",
  kind: "allowance",
  qty: 1,
  used: 50,
  amount: 50,
  overageCredits: null,
  creditBalance: 12,
  creditsNeeded: 0,
  reason: "limit_reached",
  suggestedTier: { slug: "startup", name: "Startup" },
};

describe("EntitlementError", () => {
  it("carries the BL-REQ-020 payload and a readable message", () => {
    const err = new EntitlementError(PAYLOAD);

    expect(err).toBeInstanceOf(Error);
    expect(err.payload).toEqual(PAYLOAD);
    expect(err.message).toBe("You've used 50 of 50 screenings this period.");
  });

  it("explains a limit as an upgrade", () => {
    const err = new EntitlementError({ ...PAYLOAD, key: "active_job_posts", kind: "limit", used: 2, amount: 2 });
    expect(err.message).toBe("Your plan allows 2 active job posts. Upgrade to add more.");
  });

  it("maps to a 402 response with the payload", async () => {
    const res = toEntitlementResponse(new EntitlementError(PAYLOAD));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body).toMatchObject({ code: "entitlement", ...PAYLOAD });
    expect(isEntitlementPayload(body)).toBe(true);
  });

  it("maps to a server action error", () => {
    const result = toEntitlementActionError(new EntitlementError(PAYLOAD));

    expect(result.error).toMatchObject({ code: "entitlement", ...PAYLOAD });
    expect(entitlementFromActionResult(result)).toMatchObject(PAYLOAD);
  });

  it("doesn't mistake other errors for entitlement payloads", () => {
    expect(isEntitlementPayload({ error: "nope" })).toBe(false);
    expect(isEntitlementPayload(null)).toBe(false);
    expect(entitlementFromActionResult({ success: false, error: "Job posting not found." })).toBeNull();
    expect(entitlementFromActionResult(undefined)).toBeNull();
  });
});
