import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/formatters", () => ({ INTERNAL_API_SECRET: "test-secret" }));

const { POST } = await import("./route");

let db: SupabaseMock;
const FUTURE = new Date(Date.now() + 90 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

const post = (body: unknown, key: string | null = "test-secret") =>
  POST(
    new NextRequest("http://localhost:3000/api/internal/billing/grant", {
      method: "POST",
      body: JSON.stringify(body),
      headers: key ? { "x-api-key": key } : {},
    }),
  );

beforeEach(() => {
  db = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(db.client);
  db.queueRpc("grant_company_credits", { data: "lot-1", error: null });
});

describe("POST /api/internal/billing/grant (BL-REQ-015)", () => {
  it.each([null, "wrong"])("rejects key %s with 401 and no RPC", async (key) => {
    const res = await post({ companyId: COMPANY_A.id, credits: { amount: 10, expiresAt: null } }, key);
    expect(res.status).toBe(401);
    expect(db.calls).toHaveLength(0);
  });

  it("sets the plan until a date", async () => {
    const res = await post({ companyId: COMPANY_A.id, plan: { slug: "startup", until: FUTURE } });

    expect(res.status).toBe(200);
    expect(db.callsFor("set_company_plan")[0].chain[0].args[1]).toMatchObject({
      p_company_id: COMPANY_A.id,
      p_tier_slug: "startup",
      p_until: FUTURE,
    });
  });

  it("grants credits with reason grant", async () => {
    const res = await post({ companyId: COMPANY_A.id, credits: { amount: 500, expiresAt: FUTURE, note: "pilot" } });

    expect(await res.json()).toMatchObject({ ok: true, creditLotId: "lot-1" });
    expect(db.callsFor("grant_company_credits")[0].chain[0].args[1]).toMatchObject({
      p_company_id: COMPANY_A.id,
      p_amount: 500,
      p_reason: "grant",
      p_expires_at: FUTURE,
      p_note: "pilot",
    });
  });

  it("applies a plan and credits in one call", async () => {
    await post({ companyId: COMPANY_A.id, plan: { slug: "founding", until: FUTURE }, credits: { amount: 50, expiresAt: null } });

    expect(db.callsFor("set_company_plan")).toHaveLength(1);
    expect(db.callsFor("grant_company_credits")).toHaveLength(1);
  });

  it.each([
    ["a non-UUID companyId", { companyId: "acme", credits: { amount: 1, expiresAt: null } }],
    ["a past plan end", { companyId: COMPANY_A.id, plan: { slug: "startup", until: PAST } }],
    ["a non-positive amount", { companyId: COMPANY_A.id, credits: { amount: 0, expiresAt: null } }],
    ["nothing to grant", { companyId: COMPANY_A.id }],
    ["unknown fields", { companyId: COMPANY_A.id, credits: { amount: 1, expiresAt: null }, tierId: "x" }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });

  it("maps an unknown plan slug from the DB to 400", async () => {
    db.queueRpc("set_company_plan", { data: null, error: { code: "22023", message: "unknown plan: nope" } });

    const res = await post({ companyId: COMPANY_A.id, plan: { slug: "nope", until: null } });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("unknown plan");
  });
});
