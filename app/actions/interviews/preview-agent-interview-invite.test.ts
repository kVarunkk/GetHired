import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, MEMBER_A, type MemberFixture } from "@/test/utils/team";
import { previewAgentInterviewInviteAction } from "./preview-agent-interview-invite";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const id = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let rls: SupabaseMock;

async function signIn(member: MemberFixture) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

const app = (n: number, job: string, name: string | null) => ({
  id: id(n),
  job_post_id: job,
  user_info: name ? { full_name: name } : null,
  job_postings: { title: job === JOB_A1 ? "Backend Engineer" : "Designer" },
});

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn(ADMIN_A);
});

describe("previewAgentInterviewInviteAction (SIT-071)", () => {
  it("names who'd be invited and who wouldn't, with the total minutes", async () => {
    rls.queue("applications", {
      data: [app(1, JOB_A1, "Ada"), app(2, JOB_A1, "Grace"), app(3, JOB_A2, "Alan")],
      error: null,
    });
    rls.queue("job_interview_configs", {
      data: [
        { job_post_id: JOB_A1, enabled: true, duration_minutes: 15 },
        { job_post_id: JOB_A2, enabled: false, duration_minutes: 20 },
      ],
      error: null,
    });
    rls.queue("application_interviews", { data: [{ application_id: id(2) }], error: null });

    const result = await previewAgentInterviewInviteAction({ applicationIds: [id(1), id(2), id(3), id(4)] });

    expect(result).toEqual({
      ok: true,
      totalMinutes: 15,
      applicants: [
        { id: id(1), name: "Ada", jobTitle: "Backend Engineer", invite: true, minutes: 15 },
        { id: id(2), name: "Grace", jobTitle: "Backend Engineer", invite: false, message: "Already invited." },
        { id: id(3), name: "Alan", jobTitle: "Designer", invite: false, message: "The AI interview is turned off for this job." },
        { id: id(4), name: null, jobTitle: null, invite: false, message: "Application not found." },
      ],
    });
  });

  it("marks applications on jobs outside the member's scope", async () => {
    await signIn(HIRING_MANAGER_A);
    rls.queue("applications", { data: [app(1, JOB_A2, "Ada")], error: null });
    rls.queue("job_interview_configs", { data: [{ job_post_id: JOB_A2, enabled: true, duration_minutes: 15 }], error: null });
    rls.queue("application_interviews", { data: [], error: null });

    const result = await previewAgentInterviewInviteAction({ applicationIds: [id(1)] });

    expect(result).toMatchObject({ ok: true, totalMinutes: 0, applicants: [{ invite: false }] });
  });

  it("needs interviews.manage", async () => {
    await signIn(MEMBER_A);
    expect(await previewAgentInterviewInviteAction({ applicationIds: [id(1)] })).toEqual({
      ok: false,
      error: "Your role can't manage AI interviews.",
    });
  });

  it("rejects malformed input", async () => {
    expect(await previewAgentInterviewInviteAction({ applicationIds: "all" })).toEqual({
      ok: false,
      error: "Couldn't read these invites.",
    });
  });
});
