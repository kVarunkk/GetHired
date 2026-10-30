import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { signUnsubscribeToken } from "@/helpers/candidates/unsubscribe-token";
import { unsubscribeCandidateAction } from "./unsubscribe";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/utils/formatters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/formatters")>()),
  INTERNAL_API_SECRET: "s3cret",
}));

const CANDIDATE = "cc000000-0000-4000-8000-000000000001";
let admin: SupabaseMock;

beforeEach(() => {
  vi.clearAllMocks();
  admin = createSupabaseMock();
  vi.mocked(createServiceRoleClient).mockReturnValue(admin.client as never);
});

describe("unsubscribeCandidateAction (BIT-060, BI-REQ-034)", () => {
  it("opts the named candidate out, keeping the first time", async () => {
    admin.queue("company_candidates", { data: null, error: null });
    expect(await unsubscribeCandidateAction({ token: signUnsubscribeToken(CANDIDATE) })).toEqual({ ok: true });
    const chain = admin.callsFor("company_candidates")[0].chain;
    expect(chain).toContainEqual({ method: "update", args: [{ email_opted_out_at: expect.any(String) }] });
    expect(chain).toContainEqual({ method: "eq", args: ["id", CANDIDATE] });
    expect(chain).toContainEqual({ method: "is", args: ["email_opted_out_at", null] });
  });

  it("refuses a tampered token without writing", async () => {
    const token = signUnsubscribeToken(CANDIDATE);
    for (const bad of [`${token}x`, "nope", ""]) {
      expect(await unsubscribeCandidateAction({ token: bad })).toEqual({ ok: false, error: "This link isn't valid." });
    }
    expect(admin.callsFor("company_candidates")).toHaveLength(0);
  });
});
