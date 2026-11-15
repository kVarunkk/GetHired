import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { APPLICATION_ID } from "@/test/utils/interviews";
import { ADMIN_A, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { recordInterviewAction } from "./record-interview";
import { updateInterviewAction } from "./update-interview";
import { cancelInterviewAction } from "./cancel-interview";
import { markInterviewAction } from "./mark-interview";
import { saveScorecardDraftAction } from "./save-scorecard-draft";
import { submitScorecardAction } from "./submit-scorecard";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const INTERVIEW = "1e000000-0000-4000-8000-0000000000aa";
const START = "2026-12-01T10:00:00.000Z";
const OK = { ok: true, application_id: APPLICATION_ID, status: "scheduled" };

let rls: SupabaseMock;

async function signIn(member: MemberFixture | null, user = member?.user) {
  rls = createSupabaseMock({ user });
  if (member) rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(user ?? null, rls.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn(ADMIN_A);
});

const LAYOUT = [`/company/applications/${APPLICATION_ID}`, "layout"];

describe("interview lifecycle actions (IVT-018)", () => {
  it("records and revalidates the application", async () => {
    rls.queueRpc("record_interview", { data: { ...OK, id: INTERVIEW }, error: null });
    const result = await recordInterviewAction({
      applicationId: APPLICATION_ID,
      name: "Chat",
      durationMinutes: 30,
      panel: [OWNER_A.user.id],
      startsAt: START,
    });
    expect(result).toMatchObject({ ok: true, id: INTERVIEW });
    expect(revalidatePath).toHaveBeenCalledWith(...LAYOUT);
  });

  it("reschedules, cancels and marks, revalidating each time", async () => {
    // Each action looks the membership up again.
    rls.queueRpc("my_company_access", { data: ADMIN_A.membership, error: null });
    rls.queueRpc("my_company_access", { data: ADMIN_A.membership, error: null });
    rls.queueRpc("update_interview", { data: OK, error: null });
    rls.queueRpc("cancel_interview", { data: { ...OK, status: "cancelled" }, error: null });
    rls.queueRpc("mark_interview", { data: { ...OK, status: "no_show" }, error: null });

    expect((await updateInterviewAction({ interviewId: INTERVIEW, startsAt: START })).ok).toBe(true);
    expect((await cancelInterviewAction({ interviewId: INTERVIEW })).ok).toBe(true);
    expect((await markInterviewAction({ interviewId: INTERVIEW, status: "no_show" })).ok).toBe(true);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([LAYOUT, LAYOUT, LAYOUT]);
  });

  it("doesn't revalidate a refusal", async () => {
    rls.queueRpc("cancel_interview", { data: { ok: false, reason: "invalid_status" }, error: null });
    expect(await cancelInterviewAction({ interviewId: INTERVIEW })).toEqual({
      ok: false,
      error: "This interview can't be changed in its current state.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("needs scheduling.manage", async () => {
    await signIn(memberWith(["scheduling.view"]));
    const result = await cancelInterviewAction({ interviewId: INTERVIEW });
    expect(result.ok).toBe(false);
    expect(rls.callsFor("cancel_interview")).toHaveLength(0);
  });

  it("refuses applicants", async () => {
    await signIn(null, mockUser({ type: "applicant" }));
    expect((await markInterviewAction({ interviewId: INTERVIEW, status: "completed" })).ok).toBe(false);
  });
});

describe("scorecard actions (IVT-018)", () => {
  it("lets a member with no permissions autosave (panel access is the RPC's)", async () => {
    await signIn(memberWith([]));
    rls.queueRpc("save_scorecard_draft", { data: { ok: true, id: "5c", status: "draft" }, error: null });
    expect((await saveScorecardDraftAction({ interviewId: INTERVIEW, ratings: {}, overall: null })).ok).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("submits and revalidates the kit, My interviews and the application", async () => {
    await signIn(memberWith([]));
    rls.queueRpc("submit_scorecard", {
      data: { ok: true, id: "5c", application_id: APPLICATION_ID, submitted_at: "s", locked_at: "l" },
      error: null,
    });
    expect((await submitScorecardAction({ interviewId: INTERVIEW })).ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(`/company/interviews/${INTERVIEW}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/company/my-interviews");
    expect(revalidatePath).toHaveBeenCalledWith(...LAYOUT);
  });

  it("refuses applicants", async () => {
    await signIn(null, mockUser({ type: "applicant" }));
    expect((await submitScorecardAction({ interviewId: INTERVIEW })).ok).toBe(false);
    expect((await saveScorecardDraftAction({ interviewId: INTERVIEW, ratings: {}, overall: null })).ok).toBe(false);
  });
});
