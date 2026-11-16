import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { listPipelines, type PipelineSummary } from "@/helpers/pipeline/pipelines";
import { listPipelineStages } from "@/helpers/pipeline/stages";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { DEFAULT_PIPELINE_ID, DEFAULT_STAGES } from "@/test/utils/pipeline";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import PipelineStagesPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/pipelines", () => ({ listPipelines: vi.fn() }));
vi.mock("@/helpers/pipeline/stages", () => ({ listPipelineStages: vi.fn() }));
vi.mock("@/components/pipeline/StageEditor", () => ({
  default: (props: { pipelineId: string; sharedByJobs: number; stages: unknown[] }) => (
    <input
      aria-label="Stage name"
      data-pipeline={props.pipelineId}
      data-shared={props.sharedByJobs}
      data-stages={props.stages.length}
    />
  ),
}));
vi.mock("server-only", () => ({}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", async (orig) => ({
  ...(await orig()),
  notFound: () => notFound(),
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
  useRouter: () => ({ push: vi.fn() }),
}));

const ENGINEERING_ID = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e5f";
const OTHER_COMPANY_PIPELINE = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4eee";

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
  vi.mocked(createClient).mockResolvedValue(db.client);
}

const renderPage = async (id: string) => render(await PipelineStagesPage({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPipelines).mockResolvedValue([
    summary({}),
    summary({ id: ENGINEERING_ID, name: "Engineering", is_default: false, jobs: 3 }),
  ]);
  vi.mocked(listPipelineStages).mockResolvedValue([...DEFAULT_STAGES]);
});

describe("/company/settings/pipelines/[id] (JPT-033)", () => {
  it("edits that pipeline's stages, with the job count for the shared warning", async () => {
    signInAs(OWNER_A);
    await renderPage(ENGINEERING_ID);

    expect(screen.getByRole("heading", { name: "Engineering" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to pipelines/ })).toHaveAttribute("href", "/company/settings");
    const editor = screen.getByLabelText("Stage name");
    expect(editor).toHaveAttribute("data-pipeline", ENGINEERING_ID);
    expect(editor).toHaveAttribute("data-shared", "3");
    expect(editor).toHaveAttribute("data-stages", String(DEFAULT_STAGES.length));
    expect(editor).toBeEnabled();
    expect(vi.mocked(listPipelineStages).mock.calls[0][1]).toBe(ENGINEERING_ID);
  });

  it("is a 404 for another company's (or an archived, or unknown) pipeline", async () => {
    signInAs(OWNER_A);
    await expect(renderPage(OTHER_COMPANY_PIPELINE)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listPipelineStages).not.toHaveBeenCalled();
  });

  it("is a 404 for an id that isn't a uuid", async () => {
    await expect(renderPage("default")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listPipelines).not.toHaveBeenCalled();
  });

  it("is read-only, with the reason, without settings.stages", async () => {
    signInAs(MEMBER_A);
    await renderPage(DEFAULT_PIPELINE_ID);

    expect(screen.getByText(forbiddenMessage("settings.stages"))).toBeInTheDocument();
    expect(screen.getByLabelText("Stage name")).toBeDisabled();
  });

  it("offers the agent's stage chips on every pipeline, naming the one it edits (JPT-037)", async () => {
    signInAs(OWNER_A);
    const { unmount } = await renderPage(DEFAULT_PIPELINE_ID);
    expect(screen.getByRole("link", { name: "Add a stage" })).toBeInTheDocument();
    unmount();

    signInAs(OWNER_A);
    await renderPage(ENGINEERING_ID);
    const href = decodeURIComponent(screen.getByRole("link", { name: "Add a stage" }).getAttribute("href") ?? "");
    expect(href).toContain(`(pipeline ${ENGINEERING_ID})`);
  });
});
