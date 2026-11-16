import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { listPipelines, type PipelineSummary } from "@/helpers/pipeline/pipelines";
import { jobPipelinePath } from "@/helpers/jobs/paths";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { DEFAULT_PIPELINE_ID } from "@/test/utils/pipeline";
import { HIRING_MANAGER_A, JOB_A1, JOB_A2, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";
import JobPipelineSwitchPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/pipelines", () => ({ listPipelines: vi.fn() }));
vi.mock("@/components/pipeline/PipelineSwitchForm", () => ({
  default: (props: {
    current: { name: string };
    pipelines: { name: string }[];
    initialTargetId: string | null;
    newPipeline?: { sources: unknown[]; atLimit: boolean };
  }) => (
    <p
      data-testid="form"
      data-target={props.initialTargetId ?? ""}
      data-new={props.newPipeline ? `${props.newPipeline.sources.length}:${props.newPipeline.atLimit}` : ""}
    >
      {props.current.name} → {props.pipelines.map((p) => p.name).join(",")}
    </p>
  ),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
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
  activeStages: 7,
  ...overrides,
});

function signInAs(member: MemberFixture) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("job_postings", { data: { id: JOB_A1, pipeline_id: DEFAULT_PIPELINE_ID }, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

const renderPage = async (jobId = JOB_A1, to?: string) =>
  render(
    await JobPipelineSwitchPage({
      params: Promise.resolve({ job_id: jobId }),
      searchParams: Promise.resolve(to ? { to } : {}),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPipelines).mockResolvedValue([
    summary({}),
    summary({ id: ENGINEERING_ID, name: "Engineering", is_default: false }),
  ]);
});

describe("/company/job-posts/[job_id]/pipeline/switch (JPT-036)", () => {
  it("offers the company's other pipelines, with a back link to the section", async () => {
    signInAs(OWNER_A);
    await renderPage();
    expect(screen.getByTestId("form")).toHaveTextContent("Default → Engineering");
    expect(screen.getByTestId("form")).toHaveAttribute("data-target", "");
    expect(screen.getByRole("link", { name: /Back to pipeline/ })).toHaveAttribute("href", jobPipelinePath(JOB_A1));
  });

  it("preselects a valid ?to= and ignores an unknown one", async () => {
    signInAs(OWNER_A);
    const { unmount } = await renderPage(JOB_A1, ENGINEERING_ID);
    expect(screen.getByTestId("form")).toHaveAttribute("data-target", ENGINEERING_ID);
    unmount();

    signInAs(OWNER_A);
    await renderPage(JOB_A1, DEFAULT_PIPELINE_ID);
    expect(screen.getByTestId("form")).toHaveAttribute("data-target", "");
  });

  it("offers New pipeline… in the list with settings.stages, every pipeline as a source", async () => {
    signInAs(OWNER_A);
    await renderPage();
    expect(screen.getByTestId("form")).toHaveAttribute("data-new", "2:false");
  });

  it("leaves New pipeline… out without settings.stages", async () => {
    signInAs(memberWith(["jobs.view", "jobs.edit"]));
    await renderPage();
    expect(screen.getByTestId("form")).toHaveAttribute("data-new", "");
  });

  it("still shows the form with no other pipeline, so one can be created from the list", async () => {
    vi.mocked(listPipelines).mockResolvedValue([summary({})]);
    signInAs(OWNER_A);
    await renderPage();
    expect(screen.getByTestId("form")).toHaveTextContent("Default →");
    expect(screen.getByTestId("form")).toHaveAttribute("data-new", "1:false");
  });

  it("explains the missing permission with no other pipeline and no settings.stages", async () => {
    vi.mocked(listPipelines).mockResolvedValue([summary({})]);
    signInAs(memberWith(["jobs.view", "jobs.edit"]));
    await renderPage();
    expect(screen.queryByTestId("form")).not.toBeInTheDocument();
    expect(screen.getByText(/no other pipeline yet\./)).toBeInTheDocument();
  });

  it("is a 404 without jobs.edit on the job", async () => {
    signInAs(memberWith(["jobs.view"]));
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    signInAs(HIRING_MANAGER_A);
    await expect(renderPage(JOB_A2)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listPipelines).not.toHaveBeenCalled();
  });
});
