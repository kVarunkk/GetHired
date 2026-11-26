import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A2, MEMBER_A, JOB_A1, type MemberFixture } from "@/test/utils/team";
import { markScreeningReviewedAction } from "./mark-screening-reviewed";

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

describe("markScreeningReviewedAction", () => {
  it("needs interviews.manage", async () => {
    await signIn(MEMBER_A);
    expect(await markScreeningReviewedAction({ id: AI })).toEqual({
      ok: false,
      error: "Your role can't manage AI interviews.",
    });
    expect(rls.callsFor("mark_screening_interview_reviewed")).toHaveLength(0);
  });

  it("needs it on the interview's job", async () => {
    await signIn(HIRING_MANAGER_A);
    queueInterview(JOB_A2);
    expect((await markScreeningReviewedAction({ id: AI })).ok).toBe(false);
    expect(rls.callsFor("mark_screening_interview_reviewed")).toHaveLength(0);
  });

  it("treats an interview the session can't see as not found", async () => {
    expect(await markScreeningReviewedAction({ id: AI })).toEqual({ ok: false, error: "Interview not found." });
  });

  it("calls the RPC and revalidates the application and the dashboard", async () => {
    queueInterview();
    rls.queueRpc("mark_screening_interview_reviewed", { data: { ok: true }, error: null });
    expect(await markScreeningReviewedAction({ id: AI })).toEqual({ ok: true });
    expect(rls.callsFor("mark_screening_interview_reviewed")[0].chain[0].args[1]).toEqual({ p_id: AI });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/applications/${APP}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/company");
  });

  it("reports the RPC's refusal", async () => {
    queueInterview();
    rls.queueRpc("mark_screening_interview_reviewed", { data: { ok: false, reason: "invalid_status" }, error: null });
    expect((await markScreeningReviewedAction({ id: AI })).ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
