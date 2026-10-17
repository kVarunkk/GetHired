import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { assignJobAction } from "./assign-job";
import { unassignJobAction } from "./unassign-job";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/posthog/EventCaptureServer", () => ({ eventCaptureServer: vi.fn() }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

async function signInAs(member: MemberFixture) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, db.client);
}

const rpcArgs = (fn: string) => db.callsFor(fn).map((c) => c.chain[0].args[1]);

beforeEach(async () => {
  vi.clearAllMocks();
  await signInAs(OWNER_A);
});

describe("assignJobAction / unassignJobAction (RPT-052, RP-REQ-011)", () => {
  it("assigns through the RPC and revalidates the job page", async () => {
    db.queueRpc("assign_job", { data: { ok: true }, error: null });

    expect(await assignJobAction({ jobPostId: JOB_A1, userId: MEMBER_A.user.id })).toEqual({ ok: true });
    expect(rpcArgs("assign_job")).toEqual([
      { p_job_post_id: JOB_A1, p_user_id: MEMBER_A.user.id, p_actor_kind: "user" },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}`);
  });

  it("needs jobs.assign", async () => {
    await signInAs(MEMBER_A);

    expect(await assignJobAction({ jobPostId: JOB_A1, userId: MEMBER_A.user.id })).toEqual({
      ok: false,
      error: "Your role can't change the hiring team.",
    });
    expect(db.callsFor("assign_job")).toHaveLength(0);
  });

  it("checks the scope against the job (rule 6)", async () => {
    await signInAs(HIRING_MANAGER_A);
    expect(await assignJobAction({ jobPostId: JOB_A2, userId: MEMBER_A.user.id })).toEqual({
      ok: false,
      error: "Your role can't change the hiring team for this job.",
    });

    await signInAs(HIRING_MANAGER_A);
    db.queueRpc("assign_job", { data: { ok: true }, error: null });
    expect(await assignJobAction({ jobPostId: JOB_A1, userId: MEMBER_A.user.id })).toEqual({ ok: true });
  });

  it("maps the RPC's refusals", async () => {
    db.queueRpc("unassign_job", { data: { ok: false, reason: "above_ceiling" }, error: null });

    expect(await unassignJobAction({ jobPostId: JOB_A1, userId: MEMBER_A.user.id })).toEqual({
      ok: false,
      error: "That includes permissions or limits your own role doesn't have.",
    });
  });

  it("validates the ids", async () => {
    expect(await assignJobAction({ jobPostId: "x", userId: MEMBER_A.user.id })).toMatchObject({ ok: false });
    expect(db.callsFor("assign_job")).toHaveLength(0);
  });
});
