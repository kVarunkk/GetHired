import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { claimUrl, createClaimLink, hashClaimToken, newClaimToken } from "./claim-token";

vi.mock("server-only", () => ({}));

describe("claim tokens (BIT-063, BI-REQ-041)", () => {
  it("makes long random URL-safe tokens", () => {
    const a = newClaimToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newClaimToken()).not.toBe(a);
  });

  it("hashes like claim_company_candidate: sha256 of the UTF-8 token, in hex", () => {
    expect(hashClaimToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(hashClaimToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores only the hash, with the interview's deadline, and returns the link", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidate_claims", { data: null, error: null });
    const url = await createClaimLink(db.client, {
      companyId: "co",
      candidateId: "cc",
      applicationInterviewId: "ai",
      expiresAt: "2026-11-01T00:00:00Z",
    });
    const token = url.split("/claim/")[1];
    expect(url).toBe(claimUrl(token));
    const insert = db.callsFor("company_candidate_claims")[0].chain.find((c) => c.method === "insert")!;
    expect(insert.args[0]).toEqual({
      token_hash: hashClaimToken(token),
      company_id: "co",
      candidate_id: "cc",
      application_interview_id: "ai",
      expires_at: "2026-11-01T00:00:00Z",
    });
    expect(JSON.stringify(insert.args[0])).not.toContain(token);
  });

  it("throws when the link can't be stored", async () => {
    const db = createSupabaseMock();
    db.queue("company_candidate_claims", { data: null, error: { message: "boom" } });
    await expect(
      createClaimLink(db.client, { companyId: "co", candidateId: "cc", applicationInterviewId: "ai", expiresAt: "x" }),
    ).rejects.toThrow("boom");
  });
});
