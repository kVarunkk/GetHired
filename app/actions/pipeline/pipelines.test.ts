import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archivePipeline,
  createPipeline,
  forkJobPipeline,
  previewJobPipelineSwitch,
  renamePipeline,
  setDefaultPipeline,
  setJobPipeline,
} from "@/helpers/pipeline/pipelines";
import { setRequestUser } from "@/test/utils/auth";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import { COMPANY_A } from "@/test/utils/recruiter";
import { DEFAULT_PIPELINE_ID, PIPELINE_JOB, stageOf } from "@/test/utils/pipeline";
import { jobPipelinePath } from "@/helpers/jobs/paths";
import { pipelineEditorPath } from "@/helpers/pipeline/config";
import { createPipelineAction } from "./create-pipeline";
import { renamePipelineAction } from "./rename-pipeline";
import { setDefaultPipelineAction } from "./set-default-pipeline";
import { archivePipelineAction } from "./archive-pipeline";
import { forkJobPipelineAction } from "./fork-job-pipeline";
import { setJobPipelineAction } from "./set-job-pipeline";
import { previewJobPipelineSwitchAction } from "./preview-job-pipeline-switch";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/pipelines", () => ({
  previewJobPipelineSwitch: vi.fn(),
  createPipeline: vi.fn(),
  renamePipeline: vi.fn(),
  setDefaultPipeline: vi.fn(),
  archivePipeline: vi.fn(),
  setJobPipeline: vi.fn(),
  forkJobPipeline: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const ENGINEERING = "9e000000-0000-4000-8000-0000000000e1";
const SWITCHED = { ok: true as const, changed: true, moved: 2, planItems: 1, mapping: {} };

async function signIn(member: MemberFixture = OWNER_A) {
  const supabase = createSupabaseMock({
    user: member.user,
    fallback: (call) =>
      call.target === "my_company_access" ? { data: member.membership, error: null } : { data: null, error: null },
  });
  await setRequestUser(member.user, supabase.client);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await signIn();
  vi.mocked(createPipeline).mockResolvedValue({ ok: true, pipelineId: ENGINEERING });
  vi.mocked(renamePipeline).mockResolvedValue({ ok: true });
  vi.mocked(setDefaultPipeline).mockResolvedValue({ ok: true });
  vi.mocked(archivePipeline).mockResolvedValue({ ok: true });
  vi.mocked(setJobPipeline).mockResolvedValue(SWITCHED);
  vi.mocked(forkJobPipeline).mockResolvedValue({ ...SWITCHED, pipelineId: ENGINEERING, name: "Backend" });
});

describe("pipeline settings actions (JPT-031)", () => {
  it("pass the session company and the input to their helpers, then revalidate the settings", async () => {
    expect(await createPipelineAction({ name: "Engineering", fromPipelineId: DEFAULT_PIPELINE_ID })).toEqual({
      ok: true,
      pipelineId: ENGINEERING,
    });
    await renamePipelineAction({ pipelineId: ENGINEERING, name: "Eng" });
    await setDefaultPipelineAction({ pipelineId: ENGINEERING });
    await archivePipelineAction({ pipelineId: ENGINEERING });

    expect(vi.mocked(createPipeline).mock.calls[0][0].company.id).toBe(COMPANY_A.id);
    expect(vi.mocked(createPipeline).mock.calls[0][1]).toEqual({ name: "Engineering", fromPipelineId: DEFAULT_PIPELINE_ID });
    expect(vi.mocked(renamePipeline).mock.calls[0][1]).toEqual({ pipelineId: ENGINEERING, name: "Eng" });
    expect(vi.mocked(setDefaultPipeline).mock.calls[0][1]).toEqual({ pipelineId: ENGINEERING });
    expect(vi.mocked(archivePipeline).mock.calls[0][1]).toEqual({ pipelineId: ENGINEERING });
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings", "layout");
    // A rename shows on the job pages too.
    expect(revalidatePath).toHaveBeenCalledWith("/company/job-posts", "layout");
  });

  it("reject unknown keys and bad ids before any helper runs", async () => {
    expect(await createPipelineAction({ name: "Eng", companyId: COMPANY_A.id } as never)).toMatchObject({ ok: false });
    expect(await renamePipelineAction({ pipelineId: "nope", name: "Eng" })).toMatchObject({ ok: false });
    expect(await setDefaultPipelineAction({ pipelineId: ENGINEERING, extra: 1 } as never)).toMatchObject({ ok: false });
    expect(await archivePipelineAction({ pipelineId: "nope" })).toMatchObject({ ok: false });
    expect(createPipeline).not.toHaveBeenCalled();
    expect(renamePipeline).not.toHaveBeenCalled();
    expect(setDefaultPipeline).not.toHaveBeenCalled();
    expect(archivePipeline).not.toHaveBeenCalled();
  });

  it("return the helper's copy and skip revalidation on a refusal", async () => {
    vi.mocked(archivePipeline).mockResolvedValue({
      ok: false,
      reason: "in_use",
      jobs: 2,
      error: "2 jobs use this pipeline. Switch them to another pipeline first.",
    });
    expect(await archivePipelineAction({ pipelineId: ENGINEERING })).toEqual({
      ok: false,
      error: "2 jobs use this pipeline. Switch them to another pipeline first.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("name settings.stages, not a role, without the permission", async () => {
    await signIn(MEMBER_A);
    const result = await createPipelineAction({ name: "Engineering" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^Your role can't /) });
    expect(createPipeline).not.toHaveBeenCalled();
  });
});

describe("setJobPipelineAction (JPT-031)", () => {
  const mapping = { [stageOf("applied").id]: "e5000000-0000-4000-8000-000000000001" };

  it("switches with the mapping, revalidates the job's pages and redirects to its Pipeline section", async () => {
    await expect(setJobPipelineAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING, mapping })).rejects.toThrow(
      `NEXT_REDIRECT:${jobPipelinePath(PIPELINE_JOB.id)}`,
    );
    expect(vi.mocked(setJobPipeline).mock.calls[0][1]).toEqual({
      jobPostId: PIPELINE_JOB.id,
      pipelineId: ENGINEERING,
      mapping,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${PIPELINE_JOB.id}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings", "layout");
  });

  it("doesn't revalidate when nothing changed", async () => {
    vi.mocked(setJobPipeline).mockResolvedValue({ ...SWITCHED, changed: false, moved: 0 });
    await expect(setJobPipelineAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes the refused stage and status through", async () => {
    const stage = { id: stageOf("on_hold").id, name: "On hold", kind: "on_hold" };
    vi.mocked(setJobPipeline).mockResolvedValue({
      ok: false,
      reason: "missing_status",
      error: "No On hold stage.",
      stage,
      status: "stand_by",
    });
    expect(await setJobPipelineAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toEqual({
      ok: false,
      error: "No On hold stage.",
      stage,
      status: "stand_by",
    });
  });

  it("rejects a mapping with ids that aren't uuids", async () => {
    expect(
      await setJobPipelineAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING, mapping: { a: "b" } }),
    ).toMatchObject({ ok: false });
    expect(setJobPipeline).not.toHaveBeenCalled();
  });

  it("needs jobs.edit", async () => {
    await signIn(MEMBER_A);
    expect(await setJobPipelineAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Your role can't /),
    });
    expect(setJobPipeline).not.toHaveBeenCalled();
  });
});

describe("previewJobPipelineSwitchAction (JPT-036)", () => {
  const PREVIEW = {
    ok: true as const,
    job: { id: PIPELINE_JOB.id, title: "Backend" },
    from: { id: DEFAULT_PIPELINE_ID, name: "Default" },
    to: { id: ENGINEERING, name: "Engineering" },
    same: false,
    rows: [],
    mapping: {},
    missing: [],
  };

  it("returns the helper's preview for the session company, with no revalidation", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue(PREVIEW);
    expect(await previewJobPipelineSwitchAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toEqual(
      PREVIEW,
    );
    expect(vi.mocked(previewJobPipelineSwitch).mock.calls[0][0].company.id).toBe(COMPANY_A.id);
    expect(vi.mocked(previewJobPipelineSwitch).mock.calls[0][1]).toEqual({
      jobPostId: PIPELINE_JOB.id,
      pipelineId: ENGINEERING,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the copy on a refusal and rejects bad input", async () => {
    vi.mocked(previewJobPipelineSwitch).mockResolvedValue({
      ok: false,
      reason: "pipeline_not_found",
      error: "Pipeline not found.",
    });
    expect(await previewJobPipelineSwitchAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toEqual({
      ok: false,
      error: "Pipeline not found.",
    });
    expect(
      await previewJobPipelineSwitchAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING, x: 1 } as never),
    ).toMatchObject({ ok: false });
    expect(previewJobPipelineSwitch).toHaveBeenCalledTimes(1);
  });

  it("needs jobs.edit", async () => {
    await signIn(MEMBER_A);
    expect(await previewJobPipelineSwitchAction({ jobPostId: PIPELINE_JOB.id, pipelineId: ENGINEERING })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Your role can't /),
    });
    expect(previewJobPipelineSwitch).not.toHaveBeenCalled();
  });
});

describe("forkJobPipelineAction (JPT-031)", () => {
  it("revalidates the job and the settings, then redirects to the new pipeline's editor", async () => {
    await expect(forkJobPipelineAction({ jobPostId: PIPELINE_JOB.id })).rejects.toThrow(
      `NEXT_REDIRECT:${pipelineEditorPath(ENGINEERING)}`,
    );
    expect(vi.mocked(forkJobPipeline).mock.calls[0][1]).toEqual({ jobPostId: PIPELINE_JOB.id });
    expect(revalidatePath).toHaveBeenCalledWith(`/company/job-posts/${PIPELINE_JOB.id}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/company/settings", "layout");
  });

  it("returns the copy on a refusal", async () => {
    vi.mocked(forkJobPipeline).mockResolvedValue({ ok: false, reason: "limit_reached", error: "At most 10." });
    expect(await forkJobPipelineAction({ jobPostId: PIPELINE_JOB.id })).toEqual({ ok: false, error: "At most 10." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
