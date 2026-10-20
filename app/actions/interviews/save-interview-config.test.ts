import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { mockUser, setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, JOB_A1, MEMBER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { saveInterviewConfigAction } from "./save-interview-config";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const CONFIG = {
  enabled: true,
  competencies: [{ name: "Communication", description: "Explains trade-offs clearly" }],
};

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

describe("saveInterviewConfigAction (SI-REQ-001)", () => {
  it("refuses a member without interviews.manage", async () => {
    await signIn(MEMBER_A);
    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG })).toEqual({
      ok: false,
      error: "Your role can't manage AI interviews.",
    });
    expect(rls.callsFor("job_interview_configs")).toHaveLength(0);
  });

  it("also needs jobs.edit on the job", async () => {
    await signIn(memberWith(["interviews.manage"]));
    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG })).toEqual({
      ok: false,
      error: "Your role can't edit job posts.",
    });
    expect(rls.callsFor("job_interview_configs")).toHaveLength(0);
  });

  it("refuses applicants", async () => {
    await signIn(null, mockUser({ type: "applicant" }));
    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG })).toMatchObject({ ok: false });
  });

  it("treats another company's job as not found", async () => {
    rls.queue("job_postings", { data: null, error: null });
    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(rls.callsFor("job_interview_configs")).toHaveLength(0);
  });

  it("rejects input that isn't a strict object", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    const result = await saveInterviewConfigAction({ jobPostId: JOB_A1, config: { ...CONFIG, company_id: "x" } });
    expect(result.ok).toBe(false);
    expect(rls.callsFor("job_interview_configs")).toHaveLength(0);
  });

  it("returns the fairness error with its field", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    const result = await saveInterviewConfigAction({
      jobPostId: JOB_A1,
      config: { enabled: true, competencies: [{ name: "Native English speaker", description: "x" }] },
    });
    expect(result).toMatchObject({ ok: false, field: "competencies.0.name" });
  });

  it("saves with the session company and revalidates the job", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    rls.queue("job_interview_configs", { data: { ...CONFIG, invite_rule: "fit_threshold" }, error: null });

    const result = await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG });

    expect(result).toMatchObject({ ok: true });
    const upsert = rls.callsFor("job_interview_configs")[0].chain.find((c) => c.method === "upsert");
    expect(upsert?.args[0]).toMatchObject({ job_post_id: JOB_A1, company_id: COMPANY_A.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${JOB_A1}`);
  });
});

describe("saveInterviewConfigAction: screening existing applicants (SIT-03D)", () => {
  const saved = (overrides: Record<string, unknown> = {}) =>
    rls.queue("job_interview_configs", { data: { ...CONFIG, invite_rule: "fit_threshold", ...overrides }, error: null });

  it("counts applications with no screening, or a skipped, failed or stale one", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    saved();
    rls.queue("applications", { data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }, { id: "a4" }], error: null });
    rls.queue("application_screenings", {
      data: [
        { application_id: "a1", status: "completed" },
        { application_id: "a2", status: "skipped_quota" },
        { application_id: "a3", status: "queued" },
      ],
      error: null,
    });

    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG })).toMatchObject({
      ok: true,
      unscreened: 2,
    });
    expect(rls.callsFor("applications")[0].chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_A1] });
  });

  it("offers nothing without applicants.screen", async () => {
    await signIn(memberWith(["interviews.manage", "jobs.edit"]));
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    saved();
    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: CONFIG })).toMatchObject({
      ok: true,
      unscreened: null,
    });
    expect(rls.callsFor("applications")).toHaveLength(0);
  });

  it("offers nothing for a manual or disabled interview", async () => {
    rls.queue("job_postings", { data: { id: JOB_A1 }, error: null });
    saved({ invite_rule: "manual" });
    expect(await saveInterviewConfigAction({ jobPostId: JOB_A1, config: { ...CONFIG, invite_rule: "manual" } })).toMatchObject({
      unscreened: null,
    });
    expect(rls.callsFor("applications")).toHaveLength(0);
  });
});
