import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { createClient } from "@/lib/supabase/server";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { findOpenInvite, type OpenInvite } from "@/helpers/team/invite-token";
import { mockUser } from "@/test/utils/auth";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A } from "@/test/utils/team";
import JoinCompanyPage from "./page";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/helpers/companies/get-my-company", () => ({ getMyCompany: vi.fn() }));
vi.mock("@/helpers/team/invite-token", () => ({ findOpenInvite: vi.fn() }));
vi.mock("@/components/team/JoinCompany", () => ({ default: () => null }));

const TOKEN = "tok_abcdefghijklmnopqrstuvwxyz0123456789";
const INVITE: OpenInvite = {
  id: "f1000000-0000-4000-8000-000000000001",
  email: "priya@gmail.com",
  role: { id: "r1", name: "Member" },
  roleFellBack: false,
  expires_at: "2099-01-01T00:00:00.000Z",
  company: { id: COMPANY_A.id, name: "Acme", logo_url: null },
  invitedBy: "Olive",
};

function signedIn(user: ReturnType<typeof mockUser> | null) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  } as never);
}

async function stateFor(token = TOKEN) {
  const element = (await JoinCompanyPage({ searchParams: Promise.resolve({ token }) })) as ReactElement<{
    state: string;
    invite?: unknown;
  }>;
  return element.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findOpenInvite).mockResolvedValue(INVITE);
  vi.mocked(getMyCompany).mockResolvedValue(null);
  signedIn(null);
});

describe("/company/join page states (TMT-041)", () => {
  it("is invalid for an unknown, expired or used token, and shows nothing about the company", async () => {
    vi.mocked(findOpenInvite).mockResolvedValue(null);

    expect(await stateFor()).toEqual({ state: "invalid", token: "" });
  });

  it("is invalid without a token, without a lookup", async () => {
    expect((await stateFor("")).state).toBe("invalid");
    expect(findOpenInvite).not.toHaveBeenCalled();
  });

  it("offers sign-up to signed-out visitors with the invite's summary only", async () => {
    expect(await stateFor()).toMatchObject({
      state: "signed_out",
      invite: {
        companyName: "Acme",
        inviterName: "Olive",
        roleName: "Member",
        roleFellBack: false,
        email: "priya@gmail.com",
      },
    });
  });

  it("is wrong_email for another signed-in email", async () => {
    signedIn(mockUser({ type: "company", email: "hr@other.com" }));
    expect((await stateFor()).state).toBe("wrong_email");
  });

  it("is applicant for a candidate account with the invited email", async () => {
    signedIn(mockUser({ type: "applicant", email: "Priya@Gmail.com" }));
    expect((await stateFor()).state).toBe("applicant");
  });

  it("is already_member for an account that has a company", async () => {
    signedIn(mockUser({ type: "company", email: "priya@gmail.com" }));
    vi.mocked(getMyCompany).mockResolvedValue(MEMBER_A.myCompany);
    expect((await stateFor()).state).toBe("already_member");
  });

  it("is ready for the invited email with no company yet", async () => {
    signedIn(mockUser({ type: "company", onboardingComplete: false, email: "priya@gmail.com" }));
    expect((await stateFor()).state).toBe("ready");
  });
});
