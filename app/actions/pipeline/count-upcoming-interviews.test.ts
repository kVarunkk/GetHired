import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { OWNER_A } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { countUpcomingInterviewsAction } from "./count-upcoming-interviews";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const APP = "e0000000-0000-4000-8000-000000000001";
let supabase: SupabaseMock;

beforeEach(async () => {
  supabase = createSupabaseMock({ user: COMPANY_A.user });
  supabase.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  await setRequestUser(COMPANY_A.user, supabase.client);
});

describe("countUpcomingInterviewsAction (IVT-071)", () => {
  it("counts the upcoming interviews on the applications through the RPC", async () => {
    supabase.queueRpc("upcoming_interview_count", { data: 3, error: null });
    expect(await countUpcomingInterviewsAction({ applicationIds: [APP, APP] })).toEqual({ ok: true, count: 3 });
    expect(supabase.callsFor("upcoming_interview_count")[0].chain[0].args[1]).toEqual({ p_application_ids: [APP] });
  });

  it("refuses bad input without a query, and reports a failed read", async () => {
    expect((await countUpcomingInterviewsAction({ applicationIds: ["nope"] })).ok).toBe(false);
    expect((await countUpcomingInterviewsAction({ applicationIds: [] })).ok).toBe(false);
    expect(supabase.callsFor("upcoming_interview_count")).toHaveLength(0);
    supabase.queueRpc("upcoming_interview_count", { data: null, error: { message: "x" } });
    expect((await countUpcomingInterviewsAction({ applicationIds: [APP] })).ok).toBe(false);
  });
});
