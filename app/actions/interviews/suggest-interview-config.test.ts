import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, JOB_A1, MEMBER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { suggestInterviewConfig } from "@/helpers/interview/screening/suggest-config";
import { suggestInterviewConfigAction } from "./suggest-interview-config";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/suggest-config", () => ({ suggestInterviewConfig: vi.fn() }));

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

describe("suggestInterviewConfigAction (SI-REQ-002)", () => {
  it("needs interviews.manage", async () => {
    await signIn(MEMBER_A);
    expect(await suggestInterviewConfigAction({ jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: "Your role can't manage AI interviews.",
    });
    expect(suggestInterviewConfig).not.toHaveBeenCalled();
  });

  it("treats another company's job as not found", async () => {
    rls.queue("job_postings", { data: null, error: null });
    expect(await suggestInterviewConfigAction({ jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
    expect(suggestInterviewConfig).not.toHaveBeenCalled();
  });

  it("suggests from the session company's job", async () => {
    const job = { title: "Backend Engineer", description: "APIs", skills: ["Go"] };
    rls.queue("job_postings", { data: job, error: null });
    const draft = { ok: true as const, draft: { competencies: [], questions: [] }, notes: [] };
    vi.mocked(suggestInterviewConfig).mockResolvedValue(draft);

    expect(await suggestInterviewConfigAction({ jobPostId: JOB_A1 })).toEqual(draft);
    expect(suggestInterviewConfig).toHaveBeenCalledWith(job);
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });
});
