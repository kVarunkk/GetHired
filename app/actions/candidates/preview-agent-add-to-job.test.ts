import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { ADMIN_A, HIRING_MANAGER_A, JOB_A1, type MemberFixture } from "@/test/utils/team";
import { previewAgentAddToJobAction } from "./preview-agent-add-to-job";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const c = (n: number) => `cc000000-0000-4000-8000-00000000000${n}`;
const STAGE = "5a000000-0000-4000-8000-000000000002";
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

describe("previewAgentAddToJobAction (CPT-058)", () => {
  it("names the job, the stage and the people, with who has no email", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1, title: "Backend Engineer" }, error: null });
    rls.queue("pipeline_stages", { data: { name: "Phone screen" }, error: null });
    rls.queue("company_candidates", {
      data: [
        { id: c(2), full_name: "Ravi", email: null },
        { id: c(1), full_name: "Meera", email: "meera@mail.test" },
      ],
      error: null,
    });

    const result = await previewAgentAddToJobAction({ jobPostId: JOB_A1, candidateIds: [c(1), c(2), c(3)], stageId: STAGE });

    expect(result).toEqual({
      ok: true,
      jobTitle: "Backend Engineer",
      stageName: "Phone screen",
      candidates: [
        { id: c(1), name: "Meera", hasEmail: true },
        { id: c(2), name: "Ravi", hasEmail: false },
      ],
      notFound: 1,
    });
    expect(JSON.stringify(result)).not.toContain("meera@mail.test");
    expect(rls.callsFor("company_candidates")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("uses the job's first stage without one", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1, title: "Backend Engineer" }, error: null });
    rls.queue("company_candidates", { data: [{ id: c(1), full_name: "Meera", email: "m@x.test" }], error: null });
    expect(await previewAgentAddToJobAction({ jobPostId: JOB_A1, candidateIds: [c(1)] })).toMatchObject({
      ok: true,
      stageName: null,
    });
    expect(rls.callsFor("pipeline_stages")).toHaveLength(0);
  });

  it("refuses without applicants.import for the job, another company's job, or a bad input", async () => {
    await signIn(HIRING_MANAGER_A);
    expect(await previewAgentAddToJobAction({ jobPostId: JOB_A1, candidateIds: [c(1)] })).toMatchObject({ ok: false });

    await signIn(ADMIN_A);
    rls.queue("job_postings", { data: null, error: null });
    rls.queue("company_candidates", { data: [], error: null });
    expect(await previewAgentAddToJobAction({ jobPostId: JOB_A1, candidateIds: [c(1)] })).toEqual({
      ok: false,
      error: "Job post not found.",
    });

    await signIn(ADMIN_A);
    expect(await previewAgentAddToJobAction({ jobPostId: JOB_A1, candidateIds: [] })).toMatchObject({ ok: false });
  });
});
