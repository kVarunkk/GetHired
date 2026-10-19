import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { inviteApplicants } from "@/helpers/interview/screening/invite";
import { assertAllowance } from "@/helpers/billing/entitlements";
import { EntitlementError } from "@/helpers/billing/errors";
import { inviteToInterviewAction } from "./invite-to-interview";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/invite", () => ({ inviteApplicants: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertAllowance: vi.fn() }));

const APP = "e0000000-0000-4000-8000-000000000001";
let rls: SupabaseMock;

async function signIn(member: MemberFixture) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn(ADMIN_A);
});

describe("inviteToInterviewAction (SI-REQ-010/012)", () => {
  it("needs interviews.manage", async () => {
    await signIn(MEMBER_A);
    expect(await inviteToInterviewAction({ jobPostId: JOB_A1, applicationIds: [APP] })).toEqual({
      ok: false,
      error: "Your role can't manage AI interviews.",
    });
    expect(inviteApplicants).not.toHaveBeenCalled();
  });

  it("needs it on that job for a member scoped to other jobs", async () => {
    await signIn(HIRING_MANAGER_A);
    const result = await inviteToInterviewAction({ jobPostId: JOB_A2, applicationIds: [APP] });
    expect(result).toMatchObject({ ok: false });
    expect(inviteApplicants).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    expect(
      await inviteToInterviewAction({ jobPostId: JOB_A1, applicationIds: "all" as unknown as string[] }),
    ).toEqual({ ok: false, error: "Choose who to invite." });
  });

  it("invites as the session user, by hand, and revalidates the job", async () => {
    vi.mocked(inviteApplicants).mockResolvedValue({
      ok: true,
      invited: [{ id: "ai1", applicationId: APP }],
      skipped: [{ id: "e2", reason: "exists" }],
    });

    const result = await inviteToInterviewAction({ jobPostId: JOB_A1, applicationIds: [APP, "e2"] });

    expect(result).toEqual({
      ok: true,
      invited: 1,
      skipped: [{ id: "e2", reason: "exists", message: "Already invited." }],
    });
    const [deps, input] = vi.mocked(inviteApplicants).mock.calls[0];
    expect(deps.company.id).toBe(COMPANY_A.id);
    expect(deps.user.id).toBe(ADMIN_A.user.id);
    expect(input).toEqual({ jobPostId: JOB_A1, applicationIds: [APP, "e2"], via: "manual" });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}/applications`);
  });

  it("returns the upgrade dialog's error when nothing could be paid for", async () => {
    vi.mocked(inviteApplicants).mockResolvedValue({
      ok: true,
      invited: [],
      skipped: [{ id: APP, reason: "insufficient_credits" }],
    });
    rls.queue("job_interview_configs", { data: { duration_minutes: 15 }, error: null });
    const payload = {
      key: "interview_minutes" as const,
      kind: "allowance" as const,
      qty: 15,
      used: 30,
      amount: 30,
      overageCredits: 1,
      creditBalance: 0,
      creditsNeeded: 15,
      reason: "insufficient_credits" as const,
      suggestedTier: null,
    };
    vi.mocked(assertAllowance).mockRejectedValue(new EntitlementError(payload));

    const result = await inviteToInterviewAction({ jobPostId: JOB_A1, applicationIds: [APP] });

    expect(result).toEqual({ error: expect.objectContaining({ code: "entitlement", key: "interview_minutes", qty: 15 }) });
    expect(assertAllowance).toHaveBeenCalledWith(COMPANY_A.id, "interview_minutes", 15, ADMIN_A.user.id);
  });

  it("passes the helper's own errors through", async () => {
    vi.mocked(inviteApplicants).mockResolvedValue({ ok: false, error: "Invite at most 50 applicants at a time." });
    expect(await inviteToInterviewAction({ jobPostId: JOB_A1, applicationIds: [APP] })).toEqual({
      ok: false,
      error: "Invite at most 50 applicants at a time.",
    });
  });
});
