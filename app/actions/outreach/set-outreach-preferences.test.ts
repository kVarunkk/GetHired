import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A, PUBLIC_APPLICANT } from "@/test/utils/recruiter";
import { setOutreachPreferencesAction, unblockCompanyAction } from "./set-outreach-preferences";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

let db: SupabaseMock;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: PUBLIC_APPLICANT.user });
  await setRequestUser(PUBLIC_APPLICANT.user, db.client);
});

describe("setOutreachPreferencesAction (ORT-024)", () => {
  it("writes only accepts_outreach for the session user", async () => {
    expect(await setOutreachPreferencesAction({ acceptsOutreach: false })).toEqual({ ok: true });

    const chain = db.callsFor("user_info")[0].chain;
    expect(chain).toContainEqual({ method: "update", args: [{ accepts_outreach: false }] });
    expect(chain).toContainEqual({ method: "eq", args: ["user_id", PUBLIC_APPLICANT.id] });
  });

  it("rejects extra columns", async () => {
    const result = await setOutreachPreferencesAction({ acceptsOutreach: true, is_public: true } as never);
    expect(result).toMatchObject({ ok: false });
    expect(db.callsFor("user_info")).toHaveLength(0);
  });

  it("refuses a signed-out caller", async () => {
    await setRequestUser(null);
    expect(await setOutreachPreferencesAction({ acceptsOutreach: true })).toMatchObject({ ok: false });
  });
});

describe("unblockCompanyAction (ORT-024)", () => {
  it("deletes only the session user's own block", async () => {
    expect(await unblockCompanyAction({ companyId: COMPANY_A.id })).toEqual({ ok: true });

    const chain = db.callsFor("candidate_company_blocks")[0].chain;
    expect(chain).toContainEqual({ method: "delete", args: [] });
    expect(chain).toContainEqual({ method: "eq", args: ["candidate_user_id", PUBLIC_APPLICANT.id] });
    expect(chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("rejects a candidate id in the input", async () => {
    const result = await unblockCompanyAction({ companyId: COMPANY_A.id, candidateUserId: COMPANY_A.user.id } as never);
    expect(result).toMatchObject({ ok: false });
  });
});
