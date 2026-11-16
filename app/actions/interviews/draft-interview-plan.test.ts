import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { ADMIN_A, JOB_A1, MEMBER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { EntitlementError } from "@/helpers/billing/errors";
import { assertAllowance, consumeEntitlement } from "@/helpers/billing/entitlements";
import { draftInterviewPlan } from "@/helpers/interviews/ai/draft-plan";
import { draftInterviewPlanAction } from "./draft-interview-plan";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/interviews/ai/draft-plan", () => ({ draftInterviewPlan: vi.fn() }));
vi.mock("@/helpers/billing/entitlements", () => ({ assertAllowance: vi.fn(), consumeEntitlement: vi.fn() }));

let rls: SupabaseMock;

async function signIn(member: MemberFixture) {
  rls = createSupabaseMock({ user: member.user });
  rls.queueRpc("my_company_access", { data: member.membership, error: null });
  await setRequestUser(member.user, rls.client);
}

const job = { title: "Backend Engineer", description: "APIs", skills: ["Go"] };
const PIPELINE = "9e000000-0000-4000-8000-000000000001";
const STAGES = [
  { id: "s-applied", name: "Applied", kind: "applied", archived: false },
  { id: "s-screen", name: "Screen", kind: "screen", archived: false },
  { id: "s-old", name: "Old", kind: "interview", archived: true },
  { id: "s-rejected", name: "Rejected", kind: "rejected", archived: false },
  { id: "s-hired", name: "Hired", kind: "hired", archived: false },
];
const draft = {
  ok: true as const,
  notes: [],
  items: [
    {
      stage_id: "s-screen",
      name: "Recruiter screen",
      duration_minutes: 30,
      instructions: "",
      competencies: [{ name: "Motivation", description: "", questions: [] }],
    },
  ],
};

const entitlementError = () =>
  new EntitlementError({
    key: "agent_messages",
    kind: "allowance",
    qty: 1,
    used: 50,
    amount: 50,
    overageCredits: null,
    creditBalance: 0,
    creditsNeeded: 0,
    reason: "limit_reached",
    suggestedTier: null,
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn(ADMIN_A);
  vi.mocked(assertAllowance).mockResolvedValue(undefined);
  vi.mocked(consumeEntitlement).mockResolvedValue({ source: "allowance", creditsSpent: 0, duplicate: false });
});

const queueJob = () => {
  rls.queue("job_postings", { data: { ...job, pipeline_id: PIPELINE }, error: null });
  rls.queue("pipeline_stages", { data: STAGES, error: null });
};

describe("draftInterviewPlanAction (IV-REQ-050)", () => {
  it("needs interview_plans.manage", async () => {
    await signIn(MEMBER_A);
    expect(await draftInterviewPlanAction({ jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: expect.stringMatching(/^Your role can't /),
    });
    expect(draftInterviewPlan).not.toHaveBeenCalled();
  });

  it("treats a bad id or another company's job as not found", async () => {
    expect(await draftInterviewPlanAction({ jobPostId: "nope" })).toEqual({ ok: false, error: "Job posting not found." });
    rls.queue("job_postings", { data: null, error: null });
    expect(await draftInterviewPlanAction({ jobPostId: JOB_A1 })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
    expect(draftInterviewPlan).not.toHaveBeenCalled();
  });

  it("drafts from the session company's job and its open stages, then charges one agent message", async () => {
    queueJob();
    vi.mocked(draftInterviewPlan).mockResolvedValue(draft);

    expect(await draftInterviewPlanAction({ jobPostId: JOB_A1 })).toEqual(draft);
    expect(rls.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    // The job's own pipeline (JPT-025).
    expect(rls.callsFor("pipeline_stages")[0].chain).toContainEqual({ method: "eq", args: ["pipeline_id", PIPELINE] });
    expect(draftInterviewPlan).toHaveBeenCalledWith({
      job,
      stages: [STAGES[0], STAGES[1]],
    });
    expect(consumeEntitlement).toHaveBeenCalledTimes(1);
    expect(consumeEntitlement).toHaveBeenCalledWith(
      COMPANY_A.id,
      "agent_messages",
      1,
      { type: "interview_plan_draft", id: expect.any(String) },
      ADMIN_A.user.id,
    );
  });

  it("charges nothing when the draft fails", async () => {
    queueJob();
    vi.mocked(draftInterviewPlan).mockResolvedValue({ ok: false, error: "Couldn't draft" });

    expect(await draftInterviewPlanAction({ jobPostId: JOB_A1 })).toEqual({ ok: false, error: "Couldn't draft" });
    expect(consumeEntitlement).not.toHaveBeenCalled();
  });

  it("doesn't call the model when the allowance is used up", async () => {
    queueJob();
    vi.mocked(assertAllowance).mockRejectedValue(entitlementError());

    const result = await draftInterviewPlanAction({ jobPostId: JOB_A1 });
    expect(result).toMatchObject({ error: { code: "entitlement", key: "agent_messages" } });
    expect(assertAllowance).toHaveBeenCalledWith(COMPANY_A.id, "agent_messages", 1, ADMIN_A.user.id);
    expect(draftInterviewPlan).not.toHaveBeenCalled();
  });

  it("returns the entitlement error when the charge itself is refused", async () => {
    queueJob();
    vi.mocked(draftInterviewPlan).mockResolvedValue(draft);
    vi.mocked(consumeEntitlement).mockRejectedValue(entitlementError());

    expect(await draftInterviewPlanAction({ jobPostId: JOB_A1 })).toMatchObject({
      error: { code: "entitlement", key: "agent_messages" },
    });
  });
});
