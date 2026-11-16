import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { listPipelines, type PipelineSummary } from "@/helpers/pipeline/pipelines";
import { stagesForJob } from "@/helpers/pipeline/stages";
import { jobPipelineSwitchPath } from "@/helpers/jobs/paths";
import { pipelineEditorPath } from "@/helpers/pipeline/config";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { DEFAULT_PIPELINE_ID, DEFAULT_STAGES } from "@/test/utils/pipeline";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import JobPipelinePage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/pipelines", () => ({ listPipelines: vi.fn() }));
vi.mock("@/helpers/pipeline/stages", () => ({ stagesForJob: vi.fn() }));
vi.mock("@/app/actions/pipeline/fork-job-pipeline", () => ({ forkJobPipelineAction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const ENGINEERING_ID = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e5f";

const summary = (overrides: Partial<PipelineSummary>): PipelineSummary => ({
  id: DEFAULT_PIPELINE_ID,
  name: "Default",
  is_default: true,
  archived: false,
  jobs: 1,
  openJobs: 1,
  closedJobs: 0,
  activeStages: DEFAULT_STAGES.length,
  ...overrides,
});

let db: SupabaseMock;

function signInAs(member: MemberFixture, { pipelineId = DEFAULT_PIPELINE_ID } = {}) {
  db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("job_postings", { data: { id: JOB_A1, title: "Backend Engineer", pipeline_id: pipelineId }, error: null });
  const applied = DEFAULT_STAGES.find((s) => s.kind === "applied")!;
  db.queue("applications", {
    data: [{ stage_id: applied.id }, { stage_id: applied.id }],
    error: null,
  });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

const renderPage = async (jobId = JOB_A1) => render(await JobPipelinePage({ params: Promise.resolve({ job_id: jobId }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPipelines).mockResolvedValue([
    summary({ jobs: 3 }),
    summary({ id: ENGINEERING_ID, name: "Engineering", is_default: false, jobs: 0 }),
  ]);
  vi.mocked(stagesForJob).mockResolvedValue([...DEFAULT_STAGES]);
});

describe("/company/job-posts/[job_id]/pipeline (JPT-035)", () => {
  it("shows the job's pipeline, its stages with counts and how many jobs share it", async () => {
    signInAs(OWNER_A);
    await renderPage();

    expect(screen.getByRole("heading", { name: "Default" })).toBeInTheDocument();
    expect(screen.getByText(/Used by 3 jobs\. Changes to its stages apply to all of them\./)).toBeInTheDocument();
    const stages = within(screen.getByRole("list", { name: "Stages" })).getAllByRole("listitem");
    expect(stages).toHaveLength(DEFAULT_STAGES.length);
    expect(stages[0]).toHaveTextContent("2 candidates");
    expect(stages[1]).toHaveTextContent("0 candidates");
    expect(screen.getByRole("link", { name: "Edit stages" })).toHaveAttribute(
      "href",
      pipelineEditorPath(DEFAULT_PIPELINE_ID),
    );
    expect(vi.mocked(stagesForJob)).toHaveBeenCalledWith(OWNER_A.company.id, JOB_A1);
    // Merged applications aren't counted, as on the board.
    expect(db.callsFor("applications")[0].chain).toContainEqual({
      method: "is",
      args: ["merged_into_application_id", null],
    });
  });

  it("says when only this job uses the pipeline", async () => {
    signInAs(OWNER_A, { pipelineId: ENGINEERING_ID });
    vi.mocked(listPipelines).mockResolvedValue([
      summary({}),
      summary({ id: ENGINEERING_ID, name: "Engineering", is_default: false, jobs: 1 }),
    ]);
    await renderPage();
    expect(screen.getByRole("heading", { name: "Engineering" })).toBeInTheDocument();
    expect(screen.getByText("Only this job uses this pipeline.")).toBeInTheDocument();
  });

  it("offers both actions to the owner", async () => {
    signInAs(OWNER_A);
    await renderPage();
    expect(screen.getByRole("link", { name: "Change pipeline" })).toHaveAttribute(
      "href",
      jobPipelineSwitchPath(JOB_A1),
    );
    expect(screen.getByRole("button", { name: "Customize for this job" })).toBeInTheDocument();
  });

  it("offers Change pipeline with jobs.edit but not Customize without settings.stages", async () => {
    signInAs(memberWith(["jobs.edit"]));
    await renderPage();
    expect(screen.getByRole("link", { name: "Change pipeline" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Customize for this job" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View pipeline" })).toBeInTheDocument();
  });

  it("offers Customize with settings.stages but not Change pipeline without jobs.edit", async () => {
    signInAs(memberWith(["jobs.view", "settings.stages"]));
    await renderPage();
    expect(screen.queryByRole("link", { name: "Change pipeline" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Customize for this job" })).toBeInTheDocument();
  });

  it("is read-only with jobs.view only", async () => {
    signInAs(memberWith(["jobs.view"]));
    await renderPage();
    expect(screen.queryByRole("link", { name: "Change pipeline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Customize for this job" })).not.toBeInTheDocument();
    // No agent.use, no agent box.
    expect(screen.queryByRole("link", { name: "Explain this job's pipeline" })).not.toBeInTheDocument();
  });

  it("offers the agent's switch and customize chips by permission", async () => {
    signInAs(OWNER_A);
    const { unmount } = await renderPage();
    const switchChip = screen.getByRole("link", { name: "Switch this job to another pipeline" });
    expect(decodeURIComponent(switchChip.getAttribute("href") ?? "")).toContain(
      `"Backend Engineer" (job post ${JOB_A1})`,
    );
    expect(screen.getByRole("link", { name: "Add a stage just for this job" })).toBeInTheDocument();
    unmount();

    signInAs(memberWith(["agent.use", "jobs.edit"]));
    await renderPage();
    expect(screen.getByRole("link", { name: "Switch this job to another pipeline" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add a stage just for this job" })).not.toBeInTheDocument();
  });

  it("hides the switch chip when there's no other pipeline to move to", async () => {
    vi.mocked(listPipelines).mockResolvedValue([summary({ jobs: 3 })]);
    signInAs(OWNER_A);
    await renderPage();
    expect(screen.queryByRole("link", { name: "Switch this job to another pipeline" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a stage just for this job" })).toBeInTheDocument();
  });

  it("is a 404 for a job the role doesn't cover", async () => {
    signInAs(HIRING_MANAGER_A);
    await expect(renderPage(JOB_A2)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listPipelines).not.toHaveBeenCalled();
  });

  it("is a 404 for another company's job", async () => {
    signInAs(OWNER_A);
    db.reset();
    db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
    db.queue("job_postings", { data: null, error: null });
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 for an id that isn't a uuid", async () => {
    await expect(renderPage("nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
