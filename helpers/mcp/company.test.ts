/**
 * RMT-020: resolveMcpCompany (RMCP spec §4.2) and its copy (RMCP-REQ-008).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";
import { ADMIN_A, MEMBER_A, OWNER_A, memberWith } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { RECRUITER_TOOL_PERMISSIONS } from "@/helpers/agent/roles/recruiter/tools/permissions";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { resolveMcpCompany } from "./company";
import { mcpCompanyRefusalCopy, mcpNoAccountTypeCopy } from "./copy";

vi.mock("server-only", () => ({}));

let supabase: SupabaseMock;

beforeEach(() => {
  supabase = createSupabaseMock();
});

const resolve = (user = OWNER_A.user, extra: Record<string, unknown> = {}) =>
  resolveMcpCompany({ supabase: supabase.client, user, ...extra });

describe("resolveMcpCompany", () => {
  it("refuses a company user who hasn't finished onboarding, before any lookup", async () => {
    expect(await resolve(mockUser({ type: "company", onboardingComplete: false }))).toEqual({
      ok: false,
      reason: "not_onboarded",
    });
    expect(supabase.callsFor("my_company_access")).toHaveLength(0);
  });

  it("refuses a user with no membership", async () => {
    supabase.queueRpc("my_company_access", { data: null, error: null });

    expect(await resolve(mockUser({ type: "company" }))).toEqual({ ok: false, reason: "no_company" });
  });

  it("lets an owner in without an explicit grant", async () => {
    supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });

    expect(await resolve()).toMatchObject({ ok: true, company: { id: COMPANY_A.id, isOwner: true } });
  });

  it("lets an Admin in", async () => {
    supabase.queueRpc("my_company_access", { data: ADMIN_A.membership, error: null });

    expect(await resolve(ADMIN_A.user)).toMatchObject({ ok: true, company: { id: COMPANY_A.id } });
  });

  it("lets in a custom role that has mcp.use and nothing else", async () => {
    const member = memberWith(["mcp.use"]);
    supabase.queueRpc("my_company_access", { data: member.membership, error: null });

    expect(await resolve(member.user)).toMatchObject({ ok: true });
  });

  it("refuses a Member, whose template has agent.use but not mcp.use", async () => {
    supabase.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });

    expect(await resolve(MEMBER_A.user)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("takes the company from the session only: my_company_access() has no arguments", async () => {
    supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });

    const result = await resolve(OWNER_A.user, { companyId: "c0000000-0000-4000-8000-000000000002" });

    expect(result).toMatchObject({ ok: true, company: { id: COMPANY_A.id } });
    expect(supabase.callsFor("my_company_access")[0].chain).toEqual([
      { method: "rpc", args: ["my_company_access"] },
    ]);
  });
});

describe("refusal copy", () => {
  it("names the missing permission for a member without mcp.use", () => {
    const copy = mcpCompanyRefusalCopy("forbidden");
    expect(copy.startsWith(forbiddenMessage("mcp.use"))).toBe(true);
    expect(copy).toBe(
      "Your role can't use GetHired from AI clients. Ask someone who manages your company's roles for the permission.",
    );
  });

  it.each(["not_onboarded", "no_company"] as const)("points %s to the absolute get-started link", (reason) => {
    expect(mcpCompanyRefusalCopy(reason)).toContain("http://localhost:3000/get-started?company=true");
  });

  it("points an account with no type to the web app", () => {
    expect(mcpNoAccountTypeCopy()).toContain("http://localhost:3000");
  });
});

describe("mcp.use gates the surface, not a tool", () => {
  it("is in no recruiter tool's permissions", () => {
    for (const [name, rule] of Object.entries(RECRUITER_TOOL_PERMISSIONS)) {
      expect(rule.keys as readonly string[], name).not.toContain("mcp.use");
    }
  });
});
