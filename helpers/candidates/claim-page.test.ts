import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { hashClaimToken } from "./claim-token";
import { claimViewFor, loadClaim } from "./claim-page";

vi.mock("server-only", () => ({}));

const TOKEN = "t".repeat(43);
let admin: SupabaseMock;

const row = (over: Record<string, unknown> = {}) => ({
  state: "unused",
  expires_at: "2026-10-30T12:00:00.000Z",
  used_at: null,
  used_by: null,
  company_info: { name: "Acme" },
  application_interviews: { config_snapshot: { job_title: "Backend Engineer" } },
  ...over,
});

beforeEach(() => {
  admin = createSupabaseMock();
});

describe("loadClaim (BIT-064, BI-REQ-041)", () => {
  it("looks the link up by its hash and names the company and job", async () => {
    admin.queue("company_candidate_claims", { data: row(), error: null });

    expect(await loadClaim(admin.client, TOKEN)).toEqual({
      companyName: "Acme",
      jobTitle: "Backend Engineer",
      state: "unused",
      usedBy: null,
    });
    const chain = admin.callsFor("company_candidate_claims")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["token_hash", hashClaimToken(TOKEN)] });
    // The state comes from company_candidate_claim_state, the same reading the claim RPC uses (SM-REQ-010).
    expect(String(chain[0].args[0])).toContain("state:company_candidate_claim_state");
  });

  it("returns null for an unknown or malformed token, without a lookup for the malformed one", async () => {
    admin.queue("company_candidate_claims", { data: null, error: null });
    expect(await loadClaim(admin.client, TOKEN)).toBeNull();
    expect(await loadClaim(admin.client, "short")).toBeNull();
    expect(admin.callsFor("company_candidate_claims")).toHaveLength(1);
  });
});

describe("claimViewFor", () => {
  const claim = { companyName: "Acme", jobTitle: "Backend Engineer", state: "unused" as const, usedBy: null };

  it("tells each state apart", () => {
    expect(claimViewFor(null, null)).toBe("invalid");
    expect(claimViewFor({ ...claim, state: "expired" }, null)).toBe("expired");
    expect(claimViewFor({ ...claim, state: "used", usedBy: "u2" }, null)).toBe("used");
    expect(claimViewFor(claim, null)).toBe("signed_out");
    expect(claimViewFor(claim, { id: "u1", type: "company" })).toBe("company_account");
    expect(claimViewFor(claim, { id: "u1", type: "applicant" })).toBe("confirm");
  });

  it("lets the account that used it open it again, even after the deadline", () => {
    // A used link stays "used" once it's past its deadline.
    const used = { ...claim, state: "used" as const, usedBy: "u1" };
    expect(claimViewFor(used, { id: "u1", type: "applicant" })).toBe("confirm");
    expect(claimViewFor(used, { id: "u2", type: "applicant" })).toBe("used");
  });

  it("reads an unknown state from the database as invalid", () => {
    expect(claimViewFor({ ...claim, state: "archived" as never }, null)).toBe("invalid");
  });
});
