import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import {
  listPipelines,
  previewJobPipelineSwitch,
  type JobPipelineSwitchPreview,
  type PipelineSummary,
  type SwitchPreviewRow,
} from "./pipelines";
import {
  mappingFromPairs,
  previewAgentCustomizeJobPipeline,
  previewAgentJobPipelineSwitch,
} from "./preview-agent-pipeline";

vi.mock("server-only", () => ({}));
vi.mock("./pipelines", () => ({ listPipelines: vi.fn(), previewJobPipelineSwitch: vi.fn() }));

const JOB = "b0000000-0000-4000-8000-000000000001";
const DEFAULT = "9e000000-0000-4000-8000-000000000001";
const ENG = "9e000000-0000-4000-8000-000000000002";
const APPLIED = "90000000-0000-4000-8000-000000000001";
const INTERVIEW = "90000000-0000-4000-8000-000000000002";
const ON_HOLD = "90000000-0000-4000-8000-000000000003";
const ENG_APPLIED = "91000000-0000-4000-8000-000000000001";
const ENG_TECH = "91000000-0000-4000-8000-000000000002";
const ENG_ONSITE = "91000000-0000-4000-8000-000000000003";

const row = (overrides: Partial<SwitchPreviewRow> & Pick<SwitchPreviewRow, "stage">): SwitchPreviewRow => ({
  status: "reviewed",
  applications: 0,
  planItems: 0,
  inUse: false,
  options: [],
  defaultTargetId: null,
  ...overrides,
});

const INTERVIEW_OPTIONS = [
  { id: ENG_TECH, name: "Tech interview", kind: "interview" as const },
  { id: ENG_ONSITE, name: "Onsite", kind: "interview" as const },
];

const switchPreview = (overrides: Partial<JobPipelineSwitchPreview> = {}): JobPipelineSwitchPreview => ({
  ok: true,
  job: { id: JOB, title: "Backend Engineer" },
  from: { id: DEFAULT, name: "Default" },
  to: { id: ENG, name: "Engineering" },
  same: false,
  rows: [
    row({
      stage: { id: APPLIED, name: "Applied", kind: "applied", archived: false },
      status: "submitted",
      applications: 2,
      inUse: true,
      options: [{ id: ENG_APPLIED, name: "Applied", kind: "applied" }],
      defaultTargetId: ENG_APPLIED,
    }),
    row({
      stage: { id: INTERVIEW, name: "Interview", kind: "interview", archived: false },
      applications: 1,
      planItems: 2,
      inUse: true,
      options: INTERVIEW_OPTIONS,
      defaultTargetId: ENG_TECH,
    }),
    // Empty: needs no entry.
    row({ stage: { id: ON_HOLD, name: "On hold", kind: "on_hold", archived: false }, status: "stand_by" }),
  ],
  mapping: { [APPLIED]: ENG_APPLIED, [INTERVIEW]: ENG_TECH },
  missing: [],
  ...overrides,
});

let db: SupabaseMock;
const ctx = () => ({ supabase: db.client, company: { id: COMPANY_A.id } });

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock();
});

describe("mappingFromPairs", () => {
  it("turns the tool's pairs into the RPC's mapping, and nothing into undefined", () => {
    expect(mappingFromPairs([{ fromStageId: APPLIED, toStageId: ENG_APPLIED }])).toEqual({ [APPLIED]: ENG_APPLIED });
    expect(mappingFromPairs([])).toBeUndefined();
    expect(mappingFromPairs(undefined)).toBeUndefined();
  });
});

describe("previewAgentJobPipelineSwitch (JPT-041)", () => {
  it("shows where each stage in use goes with the default mapping, and reads only", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(switchPreview());

    const result = await previewAgentJobPipelineSwitch(ctx(), { jobPostId: JOB, pipelineId: ENG });

    expect(vi.mocked(previewJobPipelineSwitch).mock.calls[0][1]).toEqual({ jobPostId: JOB, pipelineId: ENG });
    expect(result).toEqual({
      ok: true,
      jobTitle: "Backend Engineer",
      from: "Default",
      to: "Engineering",
      applications: 3,
      moves: [
        { stage: "Applied", to: "Applied", applications: 2, planItems: 0 },
        { stage: "Interview", to: "Tech interview", applications: 1, planItems: 2 },
      ],
    });
    expect(db.calls).toEqual([]);
  });

  it("applies the agent's pairs over the default", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(switchPreview());

    const result = await previewAgentJobPipelineSwitch(ctx(), {
      jobPostId: JOB,
      pipelineId: ENG,
      mapping: [{ fromStageId: INTERVIEW, toStageId: ENG_ONSITE }],
    });

    expect(result).toMatchObject({ ok: true, moves: [{ to: "Applied" }, { stage: "Interview", to: "Onsite" }] });
  });

  it("refuses a target with another candidate status, as the RPC would", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(switchPreview());

    const result = await previewAgentJobPipelineSwitch(ctx(), {
      jobPostId: JOB,
      pipelineId: ENG,
      mapping: [{ fromStageId: INTERVIEW, toStageId: ENG_APPLIED }],
    });

    expect(result).toEqual({
      ok: false,
      error: '"Interview" must map to a stage that shows candidates the same status.',
    });
  });

  it("refuses a stage that isn't the job's", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(switchPreview());

    const result = await previewAgentJobPipelineSwitch(ctx(), {
      jobPostId: JOB,
      pipelineId: ENG,
      mapping: [{ fromStageId: ENG_TECH, toStageId: ENG_ONSITE }],
    });

    expect(result).toEqual({ ok: false, error: "A stage in the mapping isn't in this job's pipeline." });
  });

  it("names the stage whose status the new pipeline lacks (JP-TEST-006)", async () => {
    const preview = switchPreview();
    preview.rows[2] = { ...preview.rows[2], applications: 1, inUse: true };
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(preview);

    const result = await previewAgentJobPipelineSwitch(ctx(), { jobPostId: JOB, pipelineId: ENG });

    expect(result).toEqual({
      ok: false,
      error: 'The new pipeline has no stage that shows candidates "On hold", which "On hold" needs. Add one to it first.',
    });
  });

  it("refuses a switch to the pipeline the job already uses", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(
      switchPreview({ same: true, to: { id: DEFAULT, name: "Default" }, mapping: {} }),
    );

    expect(await previewAgentJobPipelineSwitch(ctx(), { jobPostId: JOB, pipelineId: DEFAULT })).toEqual({
      ok: false,
      error: "This job already uses Default.",
    });
  });

  it("passes the helper's refusal through, and refuses input it can't read", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue({ ok: false, reason: "not_found", error: "Job not found." });

    expect(await previewAgentJobPipelineSwitch(ctx(), { jobPostId: JOB, pipelineId: ENG })).toEqual({
      ok: false,
      error: "Job not found.",
    });
    expect(await previewAgentJobPipelineSwitch(ctx(), { jobPostId: "nope" })).toEqual({
      ok: false,
      error: "Couldn't read the proposed switch.",
    });
  });
});

const summary = (overrides: Partial<PipelineSummary>): PipelineSummary => ({
  id: DEFAULT,
  name: "Default",
  is_default: true,
  archived: false,
  jobs: 3,
  openJobs: 3,
  closedJobs: 0,
  activeStages: 7,
  ...overrides,
});

describe("previewAgentCustomizeJobPipeline (JPT-041)", () => {
  it("names the copy after the job and counts the jobs that keep the old pipeline", async () => {
    db.queue("job_postings", { data: { id: JOB, title: "  Backend Engineer ", pipeline_id: DEFAULT }, error: null });
    vi.mocked(listPipelines).mockResolvedValue([summary({})]);

    const result = await previewAgentCustomizeJobPipeline(ctx(), { jobPostId: JOB });

    expect(db.callsFor("job_postings")[0].chain).toContainEqual({ method: "eq", args: ["company_id", COMPANY_A.id] });
    expect(result).toEqual({
      ok: true,
      jobTitle: "  Backend Engineer ",
      from: "Default",
      name: "Backend Engineer",
      stages: 7,
      otherJobs: 2,
    });
  });

  it("refuses at the pipeline limit, as the RPC would", async () => {
    db.queue("job_postings", { data: { id: JOB, title: "Backend", pipeline_id: DEFAULT }, error: null });
    vi.mocked(listPipelines).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => summary({ id: i === 0 ? DEFAULT : `p${i}`, name: `P${i}` })),
    );

    expect(await previewAgentCustomizeJobPipeline(ctx(), { jobPostId: JOB })).toEqual({
      ok: false,
      error: "A company can have at most 10 pipelines. Archive one first.",
    });
  });

  it("refuses a job that isn't the company's", async () => {
    db.queue("job_postings", { data: null, error: null });

    expect(await previewAgentCustomizeJobPipeline(ctx(), { jobPostId: JOB })).toEqual({
      ok: false,
      error: "Job not found.",
    });
  });
});
