import { describe, expect, it } from "vitest";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { mockUser } from "@/test/utils/auth";
import { COMPANY_A, COMPANY_B } from "@/test/utils/recruiter";
import { getMyCompany } from "./get-my-company";

describe("getMyCompany", () => {
  it("returns the session user's company with its tier", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });

    expect(await getMyCompany(supabase.client, COMPANY_A.user)).toEqual({
      id: COMPANY_A.id,
      name: COMPANY_A.info.name,
      email: COMPANY_A.info.email,
      tier: {
        name: COMPANY_A.tier.name,
        allowed_profiles: COMPANY_A.tier.allowed_profiles,
        allowed_job_posts: COMPANY_A.tier.allowed_job_posts,
      },
    });
  });

  it("filters company_info by the user's id, never by a company id", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("company_info", { data: COMPANY_A.infoWithTier, error: null });

    await getMyCompany(supabase.client, COMPANY_A.user);

    const [call] = supabase.callsFor("company_info");
    const filters = call.chain.filter((c) => c.method === "eq");
    expect(filters).toEqual([{ method: "eq", args: ["user_id", COMPANY_A.user.id] }]);
  });

  it("returns null for a company user without a company row", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("company_info", { data: null, error: null });

    expect(await getMyCompany(supabase.client, COMPANY_B.user)).toBeNull();
  });

  it("returns null for an applicant without querying", async () => {
    const supabase = createSupabaseMock();

    expect(await getMyCompany(supabase.client, mockUser({ type: "applicant" }))).toBeNull();
    expect(supabase.callsFor("company_info")).toHaveLength(0);
  });

  it("throws on a database error instead of returning null", async () => {
    const supabase = createSupabaseMock();
    supabase.queue("company_info", { data: null, error: { message: "boom" } });

    await expect(getMyCompany(supabase.client, COMPANY_A.user)).rejects.toThrow();
  });
});
