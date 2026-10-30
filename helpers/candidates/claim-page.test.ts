import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { hashClaimToken } from "./claim-token";
import { claimViewFor, loadClaim } from "./claim-page";

vi.mock("server-only", () => ({}));

const TOKEN = "t".repeat(43);
const NOW = new Date("2026-10-25T12:00:00.000Z");
let admin: SupabaseMock;

const row = (over: Record<string, unknown> = {}) => ({
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
      expiresAt: "2026-10-30T12:00:00.000Z",
      usedAt: null,
      usedBy: null,
    });
    expect(admin.callsFor("company_candidate_claims")[0].chain).toContainEqual({
      method: "eq",
      args: ["token_hash", hashClaimToken(TOKEN)],
    });
  });

  it("returns null for an unknown or malformed token, without a lookup for the malformed one", async () => {
    admin.queue("company_candidate_claims", { data: null, error: null });
    expect(await loadClaim(admin.client, TOKEN)).toBeNull();
    expect(await loadClaim(admin.client, "short")).toBeNull();
    expect(admin.callsFor("company_candidate_claims")).toHaveLength(1);
  });
});

describe("claimViewFor", () => {
  const claim = { companyName: "Acme", jobTitle: "Backend Engineer", expiresAt: "2026-10-30T12:00:00.000Z", usedAt: null, usedBy: null };

  it("tells each state apart", () => {
    expect(claimViewFor(null, null, NOW)).toBe("invalid");
    expect(claimViewFor({ ...claim, expiresAt: "2026-10-20T00:00:00Z" }, null, NOW)).toBe("expired");
    expect(claimViewFor({ ...claim, usedAt: "2026-10-24T00:00:00Z", usedBy: "u2" }, null, NOW)).toBe("used");
    expect(claimViewFor(claim, null, NOW)).toBe("signed_out");
    expect(claimViewFor(claim, { id: "u1", type: "company" }, NOW)).toBe("company_account");
    expect(claimViewFor(claim, { id: "u1", type: "applicant" }, NOW)).toBe("confirm");
  });

  it("lets the account that used it open it again, even after the deadline", () => {
    const used = { ...claim, expiresAt: "2026-10-20T00:00:00Z", usedAt: "2026-10-19T00:00:00Z", usedBy: "u1" };
    expect(claimViewFor(used, { id: "u1", type: "applicant" }, NOW)).toBe("confirm");
    expect(claimViewFor(used, { id: "u2", type: "applicant" }, NOW)).toBe("used");
  });
});
