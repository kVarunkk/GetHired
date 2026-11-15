import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { competencyOf, planItemOf } from "@/test/utils/interviews";
import { stageOf } from "@/test/utils/pipeline";
import { JOB_A1, JOB_A2 } from "@/test/utils/team";
import { copyInterviewPlan, loadInterviewPlan, loadSchedulingPlan, saveInterviewPlan } from "./plan";

vi.mock("server-only", () => ({}));

const STAGE = stageOf("screening").id;

const ITEM = {
  stage_id: STAGE,
  name: "System design",
  duration_minutes: 60,
  competencies: [{ name: "Architecture", questions: ["Design a URL shortener.", " "] }],
};

let db: SupabaseMock;

const rpcCalls = (fn: string) => db.callsFor(fn).map((c) => ({ args: c.chain[0].args[1] }));

beforeEach(() => {
  db = createSupabaseMock();
});

describe("loadSchedulingPlan (IVT-072)", () => {
  it("groups the plan's interviews by stage, and is empty when the read fails", async () => {
    const a = planItemOf({ name: "Tech" });
    const b = planItemOf({ id: "1a000000-0000-4000-8000-0000000000b2", name: "Culture", stage_id: "s9" });
    db.queue("job_interview_plan_items", { data: [{ ...a, job_interview_competencies: [] }, { ...b, job_interview_competencies: [] }], error: null });
    expect(await loadSchedulingPlan(db.client, JOB_A1)).toEqual({
      [a.stage_id]: [{ id: a.id, name: "Tech" }],
      s9: [{ id: b.id, name: "Culture" }],
    });
    db.queue("job_interview_plan_items", { data: null, error: { message: "boom" } });
    expect(await loadSchedulingPlan(db.client, JOB_A1)).toEqual({});
  });
});

describe("loadInterviewPlan (IVT-012)", () => {
  it("reads the job's items in order, with competencies sorted by position", async () => {
    const item = planItemOf();
    const second = competencyOf({ plan_item_id: item.id, position: 1, name: "Second" });
    const first = competencyOf({ plan_item_id: item.id, position: 0, name: "First" });
    db.queue("job_interview_plan_items", { data: [{ ...item, job_interview_competencies: [second, first] }], error: null });

    const plan = await loadInterviewPlan(db.client, JOB_A1);

    expect(plan).toHaveLength(1);
    expect(plan[0].competencies.map((c) => c.name)).toEqual(["First", "Second"]);
    expect(plan[0]).not.toHaveProperty("job_interview_competencies");
    const chain = db.callsFor("job_interview_plan_items")[0].chain;
    expect(chain).toContainEqual({ method: "eq", args: ["job_post_id", JOB_A1] });
    expect(chain).toContainEqual({ method: "order", args: ["position", { ascending: true }] });
  });

  it("throws on a read error", async () => {
    db.queue("job_interview_plan_items", { data: null, error: { message: "boom" } });
    await expect(loadInterviewPlan(db.client, JOB_A1)).rejects.toThrow(/boom/);
  });
});

describe("saveInterviewPlan (IVT-012)", () => {
  it("sends the parsed plan to save_interview_plan", async () => {
    db.queueRpc("save_interview_plan", { data: { ok: true, items: 1 }, error: null });

    expect(await saveInterviewPlan(db.client, JOB_A1, [ITEM])).toEqual({ ok: true });

    const [call] = rpcCalls("save_interview_plan");
    expect(call.args).toEqual({
      p_job_post_id: JOB_A1,
      p_items: [
        {
          stage_id: STAGE,
          name: "System design",
          duration_minutes: 60,
          instructions: "",
          default_interviewer_ids: [],
          competencies: [{ name: "Architecture", description: "", questions: ["Design a URL shortener."] }],
        },
      ],
    });
  });

  it("returns the schema's message and field without calling the RPC", async () => {
    const result = await saveInterviewPlan(db.client, JOB_A1, [{ ...ITEM, competencies: [] }]);
    expect(result).toEqual({ ok: false, error: "Add at least one competency.", field: "0.competencies" });
    expect(rpcCalls("save_interview_plan")).toHaveLength(0);
  });

  it("refuses a question about a protected characteristic before the RPC", async () => {
    const result = await saveInterviewPlan(db.client, JOB_A1, [
      { ...ITEM, competencies: [{ name: "Culture", questions: ["Do you have kids?"] }] },
    ]);
    expect(result).toMatchObject({ ok: false, field: "0.competencies.0.questions.0" });
    expect(rpcCalls("save_interview_plan")).toHaveLength(0);
  });

  it.each([
    ["forbidden", "Your role can't edit interview plans for this job."],
    ["invalid_stage", "Pick an open stage for each interview. Rejected and Hired can't have interviews."],
    ["invalid_interviewers", "Default interviewers must be members of your team."],
    ["something_new", "Something went wrong. Please try again."],
  ])("maps the %s reason to copy", async (reason, error) => {
    db.queueRpc("save_interview_plan", { data: { ok: false, reason }, error: null });
    expect(await saveInterviewPlan(db.client, JOB_A1, [ITEM])).toEqual({ ok: false, error });
  });

  it("throws on an RPC error", async () => {
    db.queueRpc("save_interview_plan", { data: null, error: { message: "boom" } });
    await expect(saveInterviewPlan(db.client, JOB_A1, [ITEM])).rejects.toThrow(/boom/);
  });
});

describe("copyInterviewPlan (IV-REQ-004)", () => {
  it("returns how many were copied and who was dropped", async () => {
    const dropped = "a1000000-0000-4000-8000-000000000009";
    db.queueRpc("copy_interview_plan", { data: { ok: true, items: 2, dropped_interviewer_ids: [dropped] }, error: null });

    expect(await copyInterviewPlan(db.client, { fromJobId: JOB_A2, toJobId: JOB_A1 })).toEqual({
      ok: true,
      items: 2,
      droppedInterviewerIds: [dropped],
    });
    expect(rpcCalls("copy_interview_plan")[0].args).toEqual({ p_from_job: JOB_A2, p_to_job: JOB_A1 });
  });

  it("maps a refusal", async () => {
    db.queueRpc("copy_interview_plan", { data: { ok: false, reason: "not_found" }, error: null });
    expect(await copyInterviewPlan(db.client, { fromJobId: JOB_A2, toJobId: JOB_A1 })).toEqual({
      ok: false,
      error: "Job posting not found.",
    });
  });
});
