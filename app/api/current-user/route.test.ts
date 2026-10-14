import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getPlanSummary } from "@/helpers/billing/entitlements";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ getPlanSummary: vi.fn() }));

let db: SupabaseMock;

beforeEach(() => {
  db = createSupabaseMock({ user: COMPANY_A.user });
  vi.mocked(createClient).mockResolvedValue(db.client);
  db.queue("company_info", { data: { id: COMPANY_A.id, user_id: COMPANY_A.user.id }, error: null });
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
});
