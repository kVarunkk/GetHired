import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICATION_ID } from "@/test/utils/interviews";
import { ADMIN_A, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { renewSchedulingLink, sendSchedulingLink } from "@/helpers/interviews/scheduling-links";
import { renewSchedulingLinkAction, sendSchedulingLinkAction } from "./send-scheduling-link";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({ service: true })) }));
vi.mock("@/helpers/interviews/scheduling-links", () => ({
  sendSchedulingLink: vi.fn(),
  renewSchedulingLink: vi.fn(),
}));

const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const TEMPLATE = "70000000-0000-4000-8000-000000000001";
const LAYOUT = [`/company/applications/${APPLICATION_ID}`, "layout"];
const send = { applicationId: APPLICATION_ID, name: "Chat", durationMinutes: 30, panel: [OWNER_A.user.id], templateId: TEMPLATE };
const URL = "https://gethired.test/schedule/x";

let rls: SupabaseMock;

async function signIn(member: MemberFixture | null) {
  rls = createSupabaseMock({ user: member?.user });
  if (member) rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member?.user ?? null, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("CALENDAR_ENABLED", "true");
  await signIn(ADMIN_A);
});

afterEach(() => vi.unstubAllEnvs());

describe("sendSchedulingLinkAction (IVT-062)", () => {
  it("sends as the session member and revalidates the application", async () => {
    vi.mocked(sendSchedulingLink).mockResolvedValue({
      ok: true,
      id: INTERVIEW,
      applicationId: APPLICATION_ID,
      url: URL,
      expiresAt: null,
    });
    expect((await sendSchedulingLinkAction(send)).ok).toBe(true);
    expect(vi.mocked(sendSchedulingLink).mock.calls[0][0]).toMatchObject({
      supabase: rls.client,
      admin: { service: true },
      user: ADMIN_A.user,
      company: { id: ADMIN_A.myCompany.id },
    });
    expect(revalidatePath).toHaveBeenCalledWith(...LAYOUT);
  });

  it("doesn't revalidate a refusal", async () => {
    vi.mocked(sendSchedulingLink).mockResolvedValue({ ok: false, reason: "no_candidate_email", error: "x" });
    expect(await sendSchedulingLinkAction(send)).toMatchObject({ ok: false, reason: "no_candidate_email" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("needs scheduling.manage, and is off while CALENDAR_ENABLED is", async () => {
    await signIn(memberWith(["scheduling.view"]));
    expect(await sendSchedulingLinkAction(send)).toMatchObject({ ok: false, reason: "forbidden" });
    vi.stubEnv("CALENDAR_ENABLED", "");
    expect(await sendSchedulingLinkAction(send)).toMatchObject({ ok: false, reason: "disabled" });
    expect(sendSchedulingLink).not.toHaveBeenCalled();
  });
});

describe("renewSchedulingLinkAction (IVT-065)", () => {
  it("renews and revalidates the application", async () => {
    vi.mocked(renewSchedulingLink).mockResolvedValue({
      ok: true,
      id: INTERVIEW,
      applicationId: APPLICATION_ID,
      url: URL,
      expiresAt: null,
      emailed: false,
    });
    expect(await renewSchedulingLinkAction({ interviewId: INTERVIEW })).toMatchObject({ ok: true, url: URL });
    expect(revalidatePath).toHaveBeenCalledWith(...LAYOUT);
  });

  it("refuses applicants", async () => {
    await signIn(null);
    expect(await renewSchedulingLinkAction({ interviewId: INTERVIEW })).toMatchObject({ ok: false, reason: "forbidden" });
    expect(renewSchedulingLink).not.toHaveBeenCalled();
  });
});
