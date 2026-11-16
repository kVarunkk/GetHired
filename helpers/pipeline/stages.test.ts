import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { DEFAULT_PIPELINE_ID, DEFAULT_STAGES, PIPELINE_JOB, stageOf } from "@/test/utils/pipeline";
import {
  MAX_ACTIVE_STAGES,
  archiveStage,
  createStage,
  listStages,
  renameStage,
  reorderStages,
  resolvePipelineId,
} from "./stages";
import { OWNER_A } from "@/test/utils/team";

let supabase: SupabaseMock;
const ctx = () => ({ supabase: supabase.client, company: OWNER_A.myCompany });

const chainOf = (target: string, i = 0) => supabase.callsFor(target)[i]?.chain ?? [];
const argsOf = (target: string, method: string, i = 0) =>
  chainOf(target, i).find((c) => c.method === method)?.args;
const scopedToCompany = (target: string, i = 0) =>
  chainOf(target, i).some(
    (c) => c.method === "eq" && c.args[0] === "company_id" && c.args[1] === COMPANY_A.id,
  );

const UNKNOWN_ID = "5a000000-0000-4000-8000-00000000ffff";

const ENGINEERING = "9e000000-0000-4000-8000-0000000000e1";
const scopedToPipeline = (target: string, id: string, i = 0) =>
  chainOf(target, i).some((c) => c.method === "eq" && c.args[0] === "pipeline_id" && c.args[1] === id);

// With one pipeline per company, the default one answers every lookup.
beforeEach(() => {
  supabase = createSupabaseMock({
    user: COMPANY_A.user,
    fallback: (call) =>
      call.target === "company_pipelines"
        ? { data: { id: DEFAULT_PIPELINE_ID }, error: null }
        : { data: null, error: null },
  });
});

describe("resolvePipelineId (JPT-021)", () => {
  it("reads the company's default pipeline when no scope is given", async () => {
    expect(await resolvePipelineId(ctx())).toBe(DEFAULT_PIPELINE_ID);
    expect(scopedToCompany("company_pipelines")).toBe(true);
    expect(chainOf("company_pipelines")).toContainEqual({ method: "eq", args: ["is_default", true] });
  });

  it("checks a named pipeline belongs to the company", async () => {
    supabase.queue("company_pipelines", { data: { id: ENGINEERING }, error: null });
    expect(await resolvePipelineId(ctx(), { pipelineId: ENGINEERING })).toBe(ENGINEERING);
    expect(scopedToCompany("company_pipelines")).toBe(true);
    expect(chainOf("company_pipelines")).toContainEqual({ method: "eq", args: ["id", ENGINEERING] });
  });

  it("reports another company's pipeline as null", async () => {
    supabase.queue("company_pipelines", { data: null, error: null });
    expect(await resolvePipelineId(ctx(), { pipelineId: ENGINEERING })).toBeNull();
  });

  it("reads a job's pipeline through the company's job", async () => {
    supabase.queue("job_postings", { data: { pipeline_id: ENGINEERING }, error: null });
    expect(await resolvePipelineId(ctx(), { jobPostId: PIPELINE_JOB.id })).toBe(ENGINEERING);
    expect(scopedToCompany("job_postings")).toBe(true);
    expect(chainOf("job_postings")).toContainEqual({ method: "eq", args: ["id", PIPELINE_JOB.id] });
    expect(supabase.callsFor("company_pipelines")).toHaveLength(0);
  });

  it("refuses ids that aren't uuids without a query", async () => {
    expect(await resolvePipelineId(ctx(), { pipelineId: "nope" })).toBeNull();
    expect(await resolvePipelineId(ctx(), { jobPostId: "nope" })).toBeNull();
    expect(supabase.calls).toHaveLength(0);
  });
});

describe("listStages (PL-TEST-004)", () => {
  it("returns the company's active stages ordered by position", async () => {
    supabase.queue("pipeline_stages", { data: DEFAULT_STAGES, error: null });

    expect(await listStages(ctx())).toEqual(DEFAULT_STAGES);

    expect(scopedToCompany("pipeline_stages")).toBe(true);
    expect(scopedToPipeline("pipeline_stages", DEFAULT_PIPELINE_ID)).toBe(true);
    expect(chainOf("pipeline_stages")).toContainEqual({ method: "eq", args: ["archived", false] });
    expect(argsOf("pipeline_stages", "order")).toEqual(["position", { ascending: true }]);
  });

  it("includes archived stages only when asked", async () => {
    supabase.queue("pipeline_stages", { data: DEFAULT_STAGES, error: null });

    await listStages(ctx(), { includeArchived: true });

    expect(chainOf("pipeline_stages").some((c) => c.args[0] === "archived")).toBe(false);
    expect(scopedToCompany("pipeline_stages")).toBe(true);
  });

  it("throws on a database error", async () => {
    supabase.queue("pipeline_stages", { data: null, error: { message: "boom" } });
    await expect(listStages(ctx())).rejects.toThrow();
  });

  it("reads a job's pipeline (JPT-021)", async () => {
    supabase.queue("job_postings", { data: { pipeline_id: ENGINEERING }, error: null });
    supabase.queue("pipeline_stages", { data: [], error: null });

    await listStages(ctx(), { jobPostId: PIPELINE_JOB.id });

    expect(scopedToPipeline("pipeline_stages", ENGINEERING)).toBe(true);
    expect(scopedToCompany("pipeline_stages")).toBe(true);
  });

  it("returns no stages for another company's job or pipeline, without reading stages", async () => {
    supabase.queue("job_postings", { data: null, error: null });
    expect(await listStages(ctx(), { jobPostId: PIPELINE_JOB.id })).toEqual([]);
    supabase.queue("company_pipelines", { data: null, error: null });
    expect(await listStages(ctx(), { pipelineId: ENGINEERING })).toEqual([]);
    expect(supabase.callsFor("pipeline_stages")).toHaveLength(0);
  });
});

describe("createStage (PL-TEST-004)", () => {
  it("appends at the next position after every stage, archived ones included", async () => {
    const archived = stageOf("offer", { id: UNKNOWN_ID, position: 9, archived: true });
    supabase.queue("pipeline_stages", { data: [...DEFAULT_STAGES, archived], error: null });
    const created = { ...stageOf("screening"), id: "5a000000-0000-4000-8000-0000000000aa", name: "Take-home", position: 10 };
    supabase.queue("pipeline_stages", { data: created, error: null });

    expect(await createStage(ctx(), { name: "  Take-home ", kind: "screening" })).toEqual({
      ok: true,
      stage: created,
    });

    expect(scopedToCompany("pipeline_stages", 0)).toBe(true);
    expect(scopedToPipeline("pipeline_stages", DEFAULT_PIPELINE_ID, 0)).toBe(true);
    expect(argsOf("pipeline_stages", "insert", 1)?.[0]).toEqual({
      company_id: COMPANY_A.id,
      pipeline_id: DEFAULT_PIPELINE_ID,
      name: "Take-home",
      kind: "screening",
      position: 10,
    });
  });

  it(`refuses a ${MAX_ACTIVE_STAGES + 1}th active stage`, async () => {
    const twelve = Array.from({ length: MAX_ACTIVE_STAGES }, (_, i) =>
      stageOf("screening", { id: `5a000000-0000-4000-8000-0000000001${i.toString().padStart(2, "0")}`, position: i }),
    );
    supabase.queue("pipeline_stages", { data: twelve, error: null });

    expect(await createStage(ctx(), { name: "One more", kind: "interview" })).toMatchObject({
      ok: false,
    });
    expect(supabase.callsFor("pipeline_stages")).toHaveLength(1);
  });

  it.each([
    ["an empty name", "   "],
    ["a name over 40 characters", "x".repeat(41)],
  ])("refuses %s without a query", async (_, name) => {
    expect(await createStage(ctx(), { name, kind: "interview" })).toMatchObject({ ok: false });
    expect(supabase.calls).toHaveLength(0);
  });

  it("refuses an unknown kind", async () => {
    expect(await createStage(ctx(), { name: "X", kind: "ghosted" as never })).toMatchObject({
      ok: false,
    });
    expect(supabase.calls).toHaveLength(0);
  });

  it("adds to a named pipeline of the company (JPT-021)", async () => {
    supabase.queue("company_pipelines", { data: { id: ENGINEERING }, error: null });
    supabase.queue("pipeline_stages", { data: [], error: null });
    supabase.queue("pipeline_stages", { data: { ...stageOf("screening"), pipeline_id: ENGINEERING }, error: null });

    expect(
      await createStage(ctx(), { name: "Take-home", kind: "screening", pipelineId: ENGINEERING }),
    ).toMatchObject({ ok: true });

    expect(scopedToPipeline("pipeline_stages", ENGINEERING, 0)).toBe(true);
    expect(argsOf("pipeline_stages", "insert", 1)?.[0]).toMatchObject({ pipeline_id: ENGINEERING, position: 0 });
  });

  it("refuses another company's pipeline without touching stages", async () => {
    supabase.queue("company_pipelines", { data: null, error: null });

    expect(
      await createStage(ctx(), { name: "Take-home", kind: "screening", pipelineId: ENGINEERING }),
    ).toEqual({ ok: false, error: "Pipeline not found." });
    expect(supabase.callsFor("pipeline_stages")).toHaveLength(0);
  });
});

describe("renameStage (PL-TEST-004)", () => {
  it("trims, and updates only the company's stage", async () => {
    supabase.queue("pipeline_stages", { data: { id: stageOf("interview").id }, error: null });

    expect(
      await renameStage(ctx(), { stageId: stageOf("interview").id, name: "  Onsite  " }),
    ).toEqual({ ok: true });

    expect(argsOf("pipeline_stages", "update")?.[0]).toEqual({ name: "Onsite" });
    expect(chainOf("pipeline_stages")).toContainEqual({
      method: "eq",
      args: ["id", stageOf("interview").id],
    });
    expect(scopedToCompany("pipeline_stages")).toBe(true);
  });

  it("reports another company's or a missing stage as not found", async () => {
    supabase.queue("pipeline_stages", { data: null, error: null });
    expect(await renameStage(ctx(), { stageId: UNKNOWN_ID, name: "Onsite" })).toEqual({
      ok: false,
      error: "Stage not found.",
    });
  });

  it("also filters by the pipeline when given", async () => {
    supabase.queue("pipeline_stages", { data: { id: stageOf("interview").id }, error: null });
    await renameStage(ctx(), { stageId: stageOf("interview").id, name: "Onsite", pipelineId: ENGINEERING });
    expect(scopedToPipeline("pipeline_stages", ENGINEERING)).toBe(true);
  });

  it("validates the name and the id before querying", async () => {
    expect(await renameStage(ctx(), { stageId: stageOf("interview").id, name: "x".repeat(41) })).toMatchObject({ ok: false });
    expect(await renameStage(ctx(), { stageId: "nope", name: "Onsite" })).toMatchObject({ ok: false });
    expect(supabase.calls).toHaveLength(0);
  });
});

describe("archiveStage (PL-TEST-004)", () => {
  it.each(["applied", "hired", "rejected"] as const)("refuses the protected kind %s", async (kind) => {
    supabase.queue("pipeline_stages", { data: stageOf(kind), error: null });

    expect(await archiveStage(ctx(), { stageId: stageOf(kind).id })).toMatchObject({ ok: false });

    expect(supabase.callsFor("pipeline_stages")).toHaveLength(1);
    expect(supabase.callsFor("applications")).toHaveLength(0);
  });

  it("refuses a stage that still has applications, with the count", async () => {
    supabase.queue("pipeline_stages", { data: stageOf("offer"), error: null });
    supabase.queue("applications", { data: null, error: null, count: 3 });

    const result = await archiveStage(ctx(), { stageId: stageOf("offer").id });

    expect(result).toMatchObject({ ok: false, count: 3 });
    expect(chainOf("applications")).toContainEqual({
      method: "eq",
      args: ["stage_id", stageOf("offer").id],
    });
    expect(supabase.callsFor("pipeline_stages")).toHaveLength(1);
  });

  it("archives an empty stage of the company", async () => {
    supabase.queue("pipeline_stages", { data: stageOf("offer"), error: null });
    supabase.queue("applications", { data: null, error: null, count: 0 });
    supabase.queue("pipeline_stages", { data: null, error: null });

    expect(await archiveStage(ctx(), { stageId: stageOf("offer").id })).toEqual({ ok: true });

    expect(scopedToCompany("pipeline_stages", 0)).toBe(true);
    expect(argsOf("pipeline_stages", "update", 1)?.[0]).toEqual({ archived: true });
    expect(scopedToCompany("pipeline_stages", 1)).toBe(true);
  });

  it("reports another company's stage as not found", async () => {
    supabase.queue("pipeline_stages", { data: null, error: null });
    expect(await archiveStage(ctx(), { stageId: UNKNOWN_ID })).toEqual({
      ok: false,
      error: "Stage not found.",
    });
  });
});

describe("reorderStages (PL-TEST-004)", () => {
  const active = DEFAULT_STAGES.map((s) => ({ id: s.id }));
  const reversed = [...DEFAULT_STAGES].reverse().map((s) => s.id);

  it("calls reorder_pipeline_stages once with the new order", async () => {
    supabase.queue("pipeline_stages", { data: active, error: null });

    expect(await reorderStages(ctx(), reversed)).toEqual({ ok: true });

    expect(scopedToCompany("pipeline_stages")).toBe(true);
    expect(scopedToPipeline("pipeline_stages", DEFAULT_PIPELINE_ID)).toBe(true);
    expect(supabase.callsFor("reorder_pipeline_stages")).toHaveLength(1);
    expect(argsOf("reorder_pipeline_stages", "rpc")).toEqual([
      "reorder_pipeline_stages",
      { p_ids: reversed },
    ]);
  });

  it.each([
    ["a missing stage", reversed.slice(1)],
    ["an extra stage", [...reversed, UNKNOWN_ID]],
    ["a duplicate", [...reversed.slice(1), reversed[1]]],
  ])("refuses a list with %s", async (_, ids) => {
    supabase.queue("pipeline_stages", { data: active, error: null });

    expect(await reorderStages(ctx(), ids)).toMatchObject({ ok: false });
    expect(supabase.callsFor("reorder_pipeline_stages")).toHaveLength(0);
  });

  it("checks the ids against the named pipeline's active stages (JPT-021)", async () => {
    supabase.queue("company_pipelines", { data: { id: ENGINEERING }, error: null });
    supabase.queue("pipeline_stages", { data: active, error: null });

    expect(await reorderStages(ctx(), reversed, { pipelineId: ENGINEERING })).toEqual({ ok: true });
    expect(scopedToPipeline("pipeline_stages", ENGINEERING)).toBe(true);
  });

  it("refuses another company's pipeline", async () => {
    supabase.queue("company_pipelines", { data: null, error: null });
    expect(await reorderStages(ctx(), reversed, { pipelineId: ENGINEERING })).toMatchObject({ ok: false });
    expect(supabase.callsFor("reorder_pipeline_stages")).toHaveLength(0);
  });

  it("returns { ok: false } when the RPC fails", async () => {
    supabase.queue("pipeline_stages", { data: active, error: null });
    supabase.queueRpc("reorder_pipeline_stages", { data: null, error: { message: "nope" } });

    expect(await reorderStages(ctx(), reversed)).toMatchObject({ ok: false });
  });
});
