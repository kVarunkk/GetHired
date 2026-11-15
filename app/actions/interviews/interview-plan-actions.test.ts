import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { planItemOf } from "@/test/utils/interviews";
import { stageOf } from "@/test/utils/pipeline";
import { ADMIN_A, JOB_A1, JOB_A2, MEMBER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { saveInterviewPlanAction } from "./save-interview-plan";
import { copyInterviewPlanAction } from "./copy-interview-plan";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const PLAN = [
  {
    stage_id: stageOf("screening").id,
    name: "System design",
    duration_minutes: 60,
    competencies: [{ name: "Architecture", questions: ["Design a URL shortener."] }],
  },
];

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

describe("saveInterviewPlanAction (IVT-012)", () => {
  it("saves through the RPC and revalidates the job's plan page", async () => {
    rls.queueRpc("save_interview_plan", { data: { ok: true, items: 1 }, error: null });
    const saved = planItemOf({ name: "System design" });
    rls.queue("job_interview_plan_items", { data: [{ ...saved, job_interview_competencies: [] }], error: null });

    const result = await saveInterviewPlanAction({ jobPostId: JOB_A1, items: PLAN });

    // The saved plan comes back with its ids, for the editor's next save.
    expect(result).toEqual({ ok: true, plan: [expect.objectContaining({ id: saved.id, name: "System design" })] });

    expect(rls.callsFor("save_interview_plan")[0].chain[0].args[1]).toMatchObject({ p_job_post_id: JOB_A1 });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}/interview-plan`);
  });

  it("needs interview_plans.manage on the job", async () => {
    await signIn(memberWith(["scheduling.view"]));
    expect(await saveInterviewPlanAction({ jobPostId: JOB_A1, items: PLAN })).toEqual({
      ok: false,
      error: "Your role can't edit interview plans.",
    });
    expect(rls.callsFor("save_interview_plan")).toHaveLength(0);
  });

  it("refuses a job outside an assigned-jobs scope", async () => {
    await signIn(memberWith([{ key: "interview_plans.manage", scope: "assigned" }], { assignedJobIds: [JOB_A2] }));
    const result = await saveInterviewPlanAction({ jobPostId: JOB_A1, items: PLAN });
    expect(result.ok).toBe(false);
    expect(rls.callsFor("save_interview_plan")).toHaveLength(0);
  });

  it("refuses applicants", async () => {
    await signIn(null, mockUser({ type: "applicant" }));
    expect((await saveInterviewPlanAction({ jobPostId: JOB_A1, items: PLAN })).ok).toBe(false);
  });

  it("returns the fairness error with its field and doesn't save", async () => {
    const result = await saveInterviewPlanAction({
      jobPostId: JOB_A1,
      items: [{ ...PLAN[0], competencies: [{ name: "Culture", questions: ["Are you married?"] }] }],
    });
    expect(result).toMatchObject({ ok: false, field: "0.competencies.0.questions.0" });
    expect(rls.callsFor("save_interview_plan")).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the RPC's refusal as copy", async () => {
    rls.queueRpc("save_interview_plan", { data: { ok: false, reason: "invalid_stage" }, error: null });
    expect(await saveInterviewPlanAction({ jobPostId: JOB_A1, items: PLAN })).toEqual({
      ok: false,
      error: "Pick an open stage for each interview. Rejected and Hired can't have interviews.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a job id that isn't a uuid", async () => {
    expect(await saveInterviewPlanAction({ jobPostId: "x", items: PLAN })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
  });
});

describe("copyInterviewPlanAction (IV-REQ-004)", () => {
  it("copies into the target job and revalidates it", async () => {
    rls.queueRpc("copy_interview_plan", { data: { ok: true, items: 2, dropped_interviewer_ids: [] }, error: null });
    rls.queue("job_interview_plan_items", { data: [], error: null });

    expect(await copyInterviewPlanAction({ fromJobId: JOB_A2, toJobId: JOB_A1 })).toEqual({
      ok: true,
      items: 2,
      droppedInterviewerIds: [],
      plan: [],
    });
    expect(rls.callsFor("job_interview_plan_items")[0].chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_A1] });
    expect(rls.callsFor("copy_interview_plan")[0].chain[0].args[1]).toEqual({ p_from_job: JOB_A2, p_to_job: JOB_A1 });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}/interview-plan`);
  });

  it("needs interview_plans.manage on the target job", async () => {
    await signIn(MEMBER_A);
    expect(await copyInterviewPlanAction({ fromJobId: JOB_A2, toJobId: JOB_A1 })).toEqual({
      ok: false,
      error: "Your role can't edit interview plans.",
    });
    expect(rls.callsFor("copy_interview_plan")).toHaveLength(0);
  });

  it("returns the RPC's refusal", async () => {
    rls.queueRpc("copy_interview_plan", { data: { ok: false, reason: "forbidden" }, error: null });
    expect(await copyInterviewPlanAction({ fromJobId: JOB_A2, toJobId: JOB_A1 })).toEqual({
      ok: false,
      error: "Your role can't edit interview plans for this job.",
    });
  });
});
