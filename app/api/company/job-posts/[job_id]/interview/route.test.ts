import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest } from "@/test/utils/request";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, JOB_A2, memberWith, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { getInterviewFunnel } from "@/helpers/interview/screening/funnel";
import { getInterviewConfig } from "@/helpers/interview/screening/config";
import { GET } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/interview/screening/funnel", () => ({ getInterviewFunnel: vi.fn() }));
vi.mock("@/helpers/interview/screening/config", () => ({ getInterviewConfig: vi.fn() }));

let rls: SupabaseMock;

async function signIn(member: MemberFixture) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

const get = (jobId = JOB_A1) =>
  GET(buildRequest(`/api/company/job-posts/${jobId}/interview`), { params: Promise.resolve({ job_id: jobId }) });

const FUNNEL = { invited: 2, waiting: 1, inProgress: 0, completed: 1, expired: 0, declined: 0, avgScore: 4 };

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn(ADMIN_A);
  vi.mocked(getInterviewFunnel).mockResolvedValue(FUNNEL);
  vi.mocked(getInterviewConfig).mockResolvedValue(null);
});

describe("GET /api/company/job-posts/[job_id]/interview (SI-REQ-004)", () => {
  it("returns the config and the funnel", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: null, funnel: FUNNEL });
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("404s another company's job", async () => {
    rls.queue("job_postings", { data: null, error: null });
    expect((await get()).status).toBe(404);
    expect(getInterviewFunnel).not.toHaveBeenCalled();
  });

  it("403s without interviews.view", async () => {
    await signIn(memberWith(["applicants.view"]));
    expect((await get()).status).toBe(403);
  });

  it("403s a member scoped to other jobs", async () => {
    await signIn(HIRING_MANAGER_A);
    expect((await get(JOB_A2)).status).toBe(403);
  });
});
