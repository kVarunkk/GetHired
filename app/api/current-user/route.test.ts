import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getPlanSummary } from "@/helpers/billing/entitlements";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getPlanSummary: vi.fn() }));

let db: SupabaseMock;

function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  vi.mocked(createClient).mockResolvedValue(db.client);
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("company_info", {
    data: { id: COMPANY_A.id, user_id: COMPANY_A.user.id, company_favorites: [{ user_id: "u1" }] },
    error: null,
  });
}

beforeEach(() => {
  signInAs(OWNER_A);
});

describe("GET /api/current-user (company)", () => {
  it("doesn't select plan limits and adds the plan summary", async () => {
    vi.mocked(getPlanSummary).mockResolvedValue({ name: "Free", slug: "free", credits: 50, status: "active" });

    const body = await (await GET()).json();

    const select = String(db.callsFor("company_info")[0].chain.find((c) => c.method === "select")?.args[0]);
    expect(select).not.toMatch(/company_tiers|allowed_/);
    expect(getPlanSummary).toHaveBeenCalledWith(COMPANY_A.id);
    expect(body.profile.plan).toMatchObject({ name: "Free", credits: 50 });
  });

  it("still answers when the plan can't be loaded", async () => {
    vi.mocked(getPlanSummary).mockRejectedValue(new Error("down"));

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).profile.plan).toBeNull();
  });

  it("returns the company's id, favorites and the role for a member (TMT-023)", async () => {
    signInAs(MEMBER_A);
    vi.mocked(getPlanSummary).mockResolvedValue(null as never);

    const body = await (await GET()).json();

    expect(db.callsFor("company_info")[0].chain).toContainEqual({ method: "eq", args: ["id", COMPANY_A.id] });
    expect(body.profile).toMatchObject({
      id: COMPANY_A.id,
      company_favorites: [{ user_id: "u1" }],
      roleLabel: "Member",
      access: { billingView: true, isOwner: false },
    });
  });

  it("reports a missing profile for a company user without a membership", async () => {
    db = createSupabaseMock({ user: MEMBER_A.user });
    vi.mocked(createClient).mockResolvedValue(db.client);
    db.queueRpc("my_company_access", { data: null, error: null });

    const body = await (await GET()).json();

    expect(body.profile).toBeNull();
    expect(db.callsFor("company_info")).toHaveLength(0);
  });
});
