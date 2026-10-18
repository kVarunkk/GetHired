import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, type MemberFixture } from "@/test/utils/team";
import { manageScreeningInterviewAction } from "./manage-screening-interview";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const AI = "fa000000-0000-4000-8000-000000000001";
const APP = "e0000000-0000-4000-8000-000000000001";
let rls: SupabaseMock;

async function signIn(member: MemberFixture) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

const queueInterview = (jobPostId = JOB_A1) =>
  rls.queue("application_interviews", { data: { job_post_id: jobPostId, application_id: APP }, error: null });

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn(ADMIN_A);
});

describe("manageScreeningInterviewAction (SI-REQ-015/026)", () => {
  it("needs interviews.manage", async () => {
    await signIn(MEMBER_A);
    expect(await manageScreeningInterviewAction({ id: AI, action: "cancel" })).toEqual({
      ok: false,
      error: "Your role can't manage AI interviews.",
    });
    expect(rls.callsFor("manage_screening_interview")).toHaveLength(0);
  });

  it("needs it on the interview's job", async () => {
    await signIn(HIRING_MANAGER_A);
    rls.queue("application_interviews", { data: { job_post_id: JOB_A2, application_id: APP }, error: null });
    const result = await manageScreeningInterviewAction({ id: AI, action: "cancel" });
    expect(result.ok).toBe(false);
    expect(rls.callsFor("manage_screening_interview")).toHaveLength(0);
  });

  it("treats an interview the session can't see as not found", async () => {
    expect(await manageScreeningInterviewAction({ id: AI, action: "cancel" })).toEqual({
      ok: false,
      error: "Interview not found.",
    });
  });

  it("rejects unknown actions and bad days", async () => {
    expect(await manageScreeningInterviewAction({ id: AI, action: "delete" as "cancel" })).toEqual({
      ok: false,
      error: "Choose what to do with the interview.",
    });
    await signIn(ADMIN_A);
    expect(await manageScreeningInterviewAction({ id: AI, action: "extend", days: 30 })).toEqual({
      ok: false,
      error: "Extend by 1 to 14 days.",
    });
  });

  it.each([
    ["cancel", undefined],
    ["extend", 3],
    ["grant_attempt", undefined],
    ["waive", undefined],
  ] as const)("%s calls the RPC and revalidates the applicant", async (action, days) => {
    queueInterview();
    rls.queueRpc("manage_screening_interview", { data: { ok: true, status: "invited" }, error: null });

    expect(await manageScreeningInterviewAction({ id: AI, action, days })).toEqual({ ok: true, status: "invited" });
    expect(rls.callsFor("manage_screening_interview")[0].chain[0].args[1]).toEqual({
      p_id: AI,
      p_action: action,
      ...(days ? { p_days: days } : {}),
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/applicants/${APP}`);
  });

  it.each([
    ["invalid_status", "That isn't possible at this stage of the interview."],
    ["limit_reached", "That's already been used the maximum number of times."],
    ["insufficient_credits", "Not enough interview minutes or credits for another attempt."],
    ["forbidden", "Your role can't manage AI interviews for this job."],
  ])("maps %s to its message", async (reason, message) => {
    queueInterview();
    rls.queueRpc("manage_screening_interview", { data: { ok: false, reason }, error: null });
    expect(await manageScreeningInterviewAction({ id: AI, action: "grant_attempt" })).toEqual({
      ok: false,
      error: message,
    });
  });
});
