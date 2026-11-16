import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  DEFAULT_PIPELINE_ID,
  DEFAULT_STAGES,
  PIPELINE_JOB,
  pipelineOf,
  stageOf,
  type PipelineStageRow,
} from "@/test/utils/pipeline";
import { OWNER_A } from "@/test/utils/team";
import {
  archivePipeline,
  createPipeline,
  forkJobPipeline,
  listPipelines,
  previewJobPipelineSwitch,
  renamePipeline,
  setDefaultPipeline,
  setJobPipeline,
} from "./pipelines";

let supabase: SupabaseMock;
const ctx = () => ({ supabase: supabase.client, company: OWNER_A.myCompany });

const ENGINEERING = "9e000000-0000-4000-8000-0000000000e1";
const UNKNOWN = "9e000000-0000-4000-8000-00000000ffff";

const rpcArgs = (fn: string, i = 0) => supabase.callsFor(fn)[i]?.chain[0]?.args[1];
const chainOf = (target: string, i = 0) => supabase.callsFor(target)[i]?.chain ?? [];
const writes = () =>
  supabase.calls.filter(
    (c) => c.kind === "rpc" || c.chain.some((m) => ["insert", "update", "upsert", "delete"].includes(m.method)),
  );

/** The Engineering pipeline: Applied, Tech screen (screening), Onsite (interview), Offer, Hired, Rejected; no On hold. */
const ENG_STAGES: PipelineStageRow[] = (
  [
    ["applied", "Applied"],
    ["screening", "Tech screen"],
    ["interview", "Onsite"],
    ["offer", "Offer"],
    ["hired", "Hired"],
    ["rejected", "Rejected"],
  ] as const
).map(([kind, name], position) => ({
  ...stageOf(kind),
  id: `e5000000-0000-4000-8000-00000000000${position + 1}`,
  pipeline_id: ENGINEERING,
  name,
  position,
}));
const engStage = (kind: PipelineStageRow["kind"]) => ENG_STAGES.find((s) => s.kind === kind)!;

beforeEach(() => {
  supabase = createSupabaseMock({ user: COMPANY_A.user });
});

describe("listPipelines (JPT-030)", () => {
  it("returns the company's pipelines, default first, with job and stage counts", async () => {
    supabase.queue("company_pipelines", {
      data: [
        pipelineOf({ id: ENGINEERING, name: "Engineering", isDefault: false }),
        pipelineOf(),
      ].map(({ id, name, is_default, archived }) => ({ id, name, is_default, archived })),
      error: null,
    });
    supabase.queue("job_postings", {
      data: [
        { pipeline_id: DEFAULT_PIPELINE_ID, status: "active" },
        { pipeline_id: DEFAULT_PIPELINE_ID, status: "inactive" },
        { pipeline_id: ENGINEERING, status: "active" },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", {
      data: [
        ...DEFAULT_STAGES.map((s) => ({ pipeline_id: s.pipeline_id })),
        ...ENG_STAGES.map((s) => ({ pipeline_id: s.pipeline_id })),
      ],
      error: null,
    });

    const rows = await listPipelines(ctx());
    expect(rows.map((r) => [r.name, r.is_default, r.jobs, r.openJobs, r.closedJobs, r.activeStages])).toEqual([
      ["Default", true, 2, 1, 1, 7],
      ["Engineering", false, 1, 1, 0, 6],
    ]);

    expect(chainOf("company_pipelines")).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chainOf("company_pipelines")).toContainEqual({ method: "eq", args: ["archived", false] });
    expect(chainOf("job_postings")).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chainOf("pipeline_stages")).toContainEqual({ method: "in", args: ["pipeline_id", [ENGINEERING, DEFAULT_PIPELINE_ID]] });
    expect(chainOf("pipeline_stages")).toContainEqual({ method: "eq", args: ["archived", false] });
  });

  it("includes archived pipelines only when asked", async () => {
    supabase.queue("company_pipelines", { data: [], error: null });
    expect(await listPipelines(ctx(), { includeArchived: true })).toEqual([]);
    expect(chainOf("company_pipelines").some((c) => c.args[0] === "archived")).toBe(false);
    expect(supabase.callsFor("job_postings")).toHaveLength(0);
  });

  it("throws on a database error", async () => {
    supabase.queue("company_pipelines", { data: null, error: { message: "boom" } });
    await expect(listPipelines(ctx())).rejects.toThrow("boom");
  });
});

describe("createPipeline", () => {
  it("calls create_pipeline with the trimmed name and the source", async () => {
    supabase.queueRpc("create_pipeline", { data: { ok: true, pipeline_id: ENGINEERING }, error: null });
    expect(await createPipeline(ctx(), { name: "  Engineering ", fromPipelineId: DEFAULT_PIPELINE_ID })).toEqual({
      ok: true,
      pipelineId: ENGINEERING,
    });
    expect(rpcArgs("create_pipeline")).toEqual({ p_name: "Engineering", p_from_pipeline: DEFAULT_PIPELINE_ID });
  });

  it("leaves the source out so the RPC copies the default", async () => {
    supabase.queueRpc("create_pipeline", { data: { ok: true, pipeline_id: ENGINEERING }, error: null });
    await createPipeline(ctx(), { name: "Engineering" });
    expect(rpcArgs("create_pipeline")).toEqual({ p_name: "Engineering" });
  });

  it("refuses a bad name without calling the RPC", async () => {
    expect(await createPipeline(ctx(), { name: "   " })).toMatchObject({ ok: false, reason: "invalid_name" });
    expect(await createPipeline(ctx(), { name: "x".repeat(41) })).toMatchObject({
      ok: false,
      error: "Pipeline names are 1 to 40 characters.",
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it.each([
    ["limit_reached", "A company can have at most 10 pipelines. Archive one first."],
    ["name_taken", "Another pipeline already has that name."],
    ["pipeline_not_found", "Pipeline not found."],
    ["forbidden", "Your role can't"],
  ])("maps %s to copy", async (reason, copy) => {
    supabase.queueRpc("create_pipeline", { data: { ok: false, reason }, error: null });
    const result = await createPipeline(ctx(), { name: "Engineering" });
    expect(result).toMatchObject({ ok: false, reason });
    expect(result.ok === false && result.error).toContain(copy);
  });

  it("reports an RPC error", async () => {
    supabase.queueRpc("create_pipeline", { data: null, error: { message: "boom" } });
    expect(await createPipeline(ctx(), { name: "Engineering" })).toMatchObject({
      ok: false,
      error: "Failed to create the pipeline.",
    });
  });
});

describe("renamePipeline / setDefaultPipeline / archivePipeline", () => {
  it("renames through rename_pipeline", async () => {
    supabase.queueRpc("rename_pipeline", { data: { ok: true }, error: null });
    expect(await renamePipeline(ctx(), { pipelineId: ENGINEERING, name: " Eng " })).toEqual({ ok: true });
    expect(rpcArgs("rename_pipeline")).toEqual({ p_pipeline_id: ENGINEERING, p_name: "Eng" });
  });

  it("makes a pipeline the default through set_default_pipeline", async () => {
    supabase.queueRpc("set_default_pipeline", { data: { ok: true }, error: null });
    expect(await setDefaultPipeline(ctx(), { pipelineId: ENGINEERING })).toEqual({ ok: true });
    expect(rpcArgs("set_default_pipeline")).toEqual({ p_pipeline_id: ENGINEERING });
  });

  it("names the default and the jobs in use when archiving is refused", async () => {
    supabase.queueRpc("archive_pipeline", { data: { ok: false, reason: "is_default" }, error: null });
    supabase.queueRpc("archive_pipeline", { data: { ok: false, reason: "in_use", jobs: 3 }, error: null });
    expect(await archivePipeline(ctx(), { pipelineId: DEFAULT_PIPELINE_ID })).toMatchObject({
      ok: false,
      reason: "is_default",
      error: expect.stringContaining("default pipeline can't be archived"),
    });
    expect(await archivePipeline(ctx(), { pipelineId: ENGINEERING })).toMatchObject({
      ok: false,
      reason: "in_use",
      jobs: 3,
      error: "3 jobs use this pipeline. Switch them to another pipeline first.",
    });
  });

  it("refuses ids that aren't uuids without a call", async () => {
    expect(await renamePipeline(ctx(), { pipelineId: "nope", name: "Eng" })).toMatchObject({ reason: "pipeline_not_found" });
    expect(await setDefaultPipeline(ctx(), { pipelineId: "nope" })).toMatchObject({ reason: "pipeline_not_found" });
    expect(await archivePipeline(ctx(), { pipelineId: "nope" })).toMatchObject({ reason: "pipeline_not_found" });
    expect(supabase.calls).toHaveLength(0);
  });
});

describe("setJobPipeline", () => {
  it("passes the job, the pipeline and the mapping, and maps the result", async () => {
    const mapping = { [stageOf("screening").id]: engStage("screening").id };
    supabase.queueRpc("set_job_pipeline", {
      data: { ok: true, changed: true, moved: 4, plan_items: 2, mapping },
      error: null,
    });
    expect(await setJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING, mapping })).toEqual({
      ok: true,
      changed: true,
      moved: 4,
      planItems: 2,
      mapping,
    });
    expect(rpcArgs("set_job_pipeline")).toEqual({
      p_job_post_id: PIPELINE_JOB.id,
      p_pipeline_id: ENGINEERING,
      p_mapping: mapping,
    });
  });

  it("leaves the mapping out for the default one", async () => {
    supabase.queueRpc("set_job_pipeline", { data: { ok: true, changed: false }, error: null });
    expect(await setJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toMatchObject({
      ok: true,
      changed: false,
      moved: 0,
    });
    expect(rpcArgs("set_job_pipeline")).toEqual({ p_job_post_id: PIPELINE_JOB.id, p_pipeline_id: ENGINEERING });
  });

  it("refuses a mapping with an id that isn't a uuid without a call", async () => {
    expect(
      await setJobPipeline(ctx(), {
        jobPostId: PIPELINE_JOB.id,
        pipelineId: ENGINEERING,
        mapping: { [stageOf("applied").id]: "nope" },
      }),
    ).toMatchObject({ ok: false, reason: "invalid_mapping" });
    expect(supabase.calls).toHaveLength(0);
  });

  it("names the stage and the status a refused switch needs", async () => {
    const stage = { id: stageOf("on_hold").id, name: "On hold", kind: "on_hold" };
    supabase.queueRpc("set_job_pipeline", {
      data: { ok: false, reason: "missing_status", status: "stand_by", stage },
      error: null,
    });
    expect(await setJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toEqual({
      ok: false,
      reason: "missing_status",
      stage,
      status: "stand_by",
      error: 'The new pipeline has no stage that shows candidates "On hold", which "On hold" needs. Add one to it first.',
    });
  });

  it("names jobs.edit for this job when forbidden", async () => {
    supabase.queueRpc("set_job_pipeline", { data: { ok: false, reason: "forbidden" }, error: null });
    const result = await setJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING });
    expect(result.ok === false && result.error).toMatch(/for this job\.$/);
  });
});

describe("forkJobPipeline", () => {
  it("returns the new pipeline and the switch", async () => {
    supabase.queueRpc("fork_job_pipeline", {
      data: { ok: true, changed: true, moved: 1, plan_items: 0, mapping: {}, pipeline_id: ENGINEERING, name: "Founding Backend Engineer" },
      error: null,
    });
    expect(await forkJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id })).toEqual({
      ok: true,
      changed: true,
      moved: 1,
      planItems: 0,
      mapping: {},
      pipelineId: ENGINEERING,
      name: "Founding Backend Engineer",
    });
    expect(rpcArgs("fork_job_pipeline")).toEqual({ p_job_post_id: PIPELINE_JOB.id });
  });

  it("names settings.stages when forbidden, and the limit", async () => {
    supabase.queueRpc("fork_job_pipeline", { data: { ok: false, reason: "forbidden" }, error: null });
    supabase.queueRpc("fork_job_pipeline", { data: { ok: false, reason: "limit_reached" }, error: null });
    const forbidden = await forkJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id });
    expect(forbidden.ok === false && forbidden.error).toMatch(/^Your role can't /);
    expect(forbidden.ok === false && forbidden.error).not.toMatch(/for this job/);
    expect(await forkJobPipeline(ctx(), { jobPostId: PIPELINE_JOB.id })).toMatchObject({ reason: "limit_reached" });
  });
});

describe("previewJobPipelineSwitch (JPT-030)", () => {
  /** The job on the Default pipeline, moving to Engineering. */
  function queueSwitch({
    apps,
    items = [],
    target = ENG_STAGES,
    targetArchived = false,
  }: {
    apps: { stage_id: string; merged_into_application_id?: string | null }[];
    items?: { stage_id: string }[];
    target?: PipelineStageRow[];
    targetArchived?: boolean;
  }) {
    supabase.queue("job_postings", {
      data: { id: PIPELINE_JOB.id, title: PIPELINE_JOB.title, pipeline_id: DEFAULT_PIPELINE_ID },
      error: null,
    });
    supabase.queue("company_pipelines", {
      data: [
        { id: DEFAULT_PIPELINE_ID, name: "Default", archived: false },
        { id: ENGINEERING, name: "Engineering", archived: targetArchived },
      ],
      error: null,
    });
    supabase.queue("pipeline_stages", (call) => ({
      data: call.chain.some((c) => c.method === "eq" && c.args[0] === "pipeline_id" && c.args[1] === ENGINEERING)
        ? target
        : DEFAULT_STAGES,
      error: null,
    }));
    supabase.queue("pipeline_stages", (call) => ({
      data: call.chain.some((c) => c.method === "eq" && c.args[0] === "pipeline_id" && c.args[1] === ENGINEERING)
        ? target
        : DEFAULT_STAGES,
      error: null,
    }));
    supabase.queue("applications", {
      data: apps.map((a) => ({ merged_into_application_id: null, ...a })),
      error: null,
    });
    supabase.queue("job_interview_plan_items", { data: items, error: null });
  }

  it("maps each stage in use to the same kind by default, with counts and the allowed targets", async () => {
    queueSwitch({
      apps: [
        { stage_id: stageOf("applied").id },
        { stage_id: stageOf("applied").id },
        { stage_id: stageOf("applied").id, merged_into_application_id: "ab000000-0000-4000-8000-0000000000ff" },
        { stage_id: stageOf("interview").id },
      ],
      items: [{ stage_id: stageOf("screening").id }],
    });

    const preview = await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING });
    if (!preview.ok) throw new Error(preview.error);

    expect(preview.job).toEqual({ id: PIPELINE_JOB.id, title: PIPELINE_JOB.title });
    expect(preview.from).toEqual({ id: DEFAULT_PIPELINE_ID, name: "Default" });
    expect(preview.to).toEqual({ id: ENGINEERING, name: "Engineering" });
    expect(preview.same).toBe(false);
    expect(preview.missing).toEqual([]);
    expect(preview.mapping).toEqual({
      [stageOf("applied").id]: engStage("applied").id,
      [stageOf("screening").id]: engStage("screening").id,
      [stageOf("interview").id]: engStage("interview").id,
    });

    const applied = preview.rows.find((r) => r.stage.kind === "applied")!;
    expect(applied).toMatchObject({ applications: 2, planItems: 0, inUse: true, status: "submitted" });
    const screening = preview.rows.find((r) => r.stage.kind === "screening")!;
    expect(screening).toMatchObject({ applications: 0, planItems: 1, inUse: true });
    // Screening, Interview and Offer all show "reviewed", so any of them fits.
    expect(screening.options.map((o) => o.name)).toEqual(["Tech screen", "Onsite", "Offer"]);
    expect(preview.rows.find((r) => r.stage.kind === "hired")).toMatchObject({ inUse: false, options: [{ name: "Hired" }] });
    expect(preview.rows).toHaveLength(DEFAULT_STAGES.length);
  });

  it("lists a missing On hold stage and leaves it out of the mapping", async () => {
    queueSwitch({ apps: [{ stage_id: stageOf("on_hold").id }, { stage_id: stageOf("applied").id }] });

    const preview = await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING });
    if (!preview.ok) throw new Error(preview.error);

    expect(preview.missing).toEqual([
      { stage: { id: stageOf("on_hold").id, name: "On hold", kind: "on_hold" }, status: "stand_by" },
    ]);
    expect(preview.mapping).toEqual({ [stageOf("applied").id]: engStage("applied").id });
    expect(preview.rows.find((r) => r.stage.kind === "on_hold")).toMatchObject({
      inUse: true,
      options: [],
      defaultTargetId: null,
    });
  });

  it("falls back to a stage with the same status when the kind is missing", async () => {
    const noOffer = ENG_STAGES.filter((s) => s.kind !== "offer");
    queueSwitch({ apps: [{ stage_id: stageOf("offer").id }], target: noOffer });

    const preview = await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.mapping).toEqual({ [stageOf("offer").id]: engStage("screening").id });
  });

  it("makes no writes", async () => {
    queueSwitch({ apps: [{ stage_id: stageOf("applied").id }] });
    await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING });
    expect(writes()).toEqual([]);
  });

  it("scopes the job and the pipelines to the company", async () => {
    queueSwitch({ apps: [] });
    await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING });
    expect(chainOf("job_postings")).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(chainOf("company_pipelines")).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
  });

  it("refuses a job of another company and an archived or unknown target", async () => {
    supabase.queue("job_postings", { data: null, error: null });
    expect(await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toMatchObject({
      ok: false,
      reason: "not_found",
    });

    supabase.reset();
    queueSwitch({ apps: [], targetArchived: true });
    expect(await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toMatchObject({
      ok: false,
      reason: "pipeline_not_found",
    });

    supabase.reset();
    queueSwitch({ apps: [] });
    expect(await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: UNKNOWN })).toMatchObject({
      ok: false,
      reason: "pipeline_not_found",
    });
  });

  it("marks the job's own pipeline as no change", async () => {
    supabase.queue("job_postings", {
      data: { id: PIPELINE_JOB.id, title: PIPELINE_JOB.title, pipeline_id: DEFAULT_PIPELINE_ID },
      error: null,
    });
    supabase.queue("company_pipelines", {
      data: [{ id: DEFAULT_PIPELINE_ID, name: "Default", archived: false }],
      error: null,
    });
    supabase.queue("pipeline_stages", { data: DEFAULT_STAGES, error: null });
    supabase.queue("pipeline_stages", { data: DEFAULT_STAGES, error: null });
    supabase.queue("applications", { data: [{ stage_id: stageOf("applied").id, merged_into_application_id: null }], error: null });
    supabase.queue("job_interview_plan_items", { data: [], error: null });

    const preview = await previewJobPipelineSwitch(ctx(), { jobPostId: PIPELINE_JOB.id, pipelineId: DEFAULT_PIPELINE_ID });
    expect(preview).toMatchObject({ ok: true, same: true, mapping: {}, missing: [] });
  });
});
