import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { listPipelines, type PipelineSummary } from "@/helpers/pipeline/pipelines";
import { forbiddenMessage } from "@/helpers/companies/permissions";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { DEFAULT_PIPELINE_ID } from "@/test/utils/pipeline";
import { MEMBER_A, OWNER_A, type MemberFixture } from "@/test/utils/team";
import CompanySettingsPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/helpers/pipeline/pipelines", () => ({ listPipelines: vi.fn() }));
vi.mock("@/components/ui/select", () => import("@/test/utils/select-mock"));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", async (orig) => ({ ...(await orig()), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const ENGINEERING_ID = "7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e5f";

const summary = (overrides: Partial<PipelineSummary>): PipelineSummary => ({
  id: DEFAULT_PIPELINE_ID,
  name: "Default",
  is_default: true,
  archived: false,
  jobs: 0,
  openJobs: 0,
  closedJobs: 0,
  activeStages: 7,
  ...overrides,
});

const PIPELINES = [
  summary({ jobs: 4, openJobs: 3, closedJobs: 1 }),
  summary({ id: ENGINEERING_ID, name: "Engineering", is_default: false, activeStages: 9 }),
];

function signInAs(member: MemberFixture) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  vi.mocked(createClient).mockResolvedValue(db.client);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPipelines).mockResolvedValue(PIPELINES);
});

describe("/company/settings, pipelines (JPT-032)", () => {
  it("lists each pipeline with its default badge, jobs and stages, linking to its editor", async () => {
    signInAs(OWNER_A);
    render(await CompanySettingsPage());

    const table = screen.getByRole("table", { name: "Pipelines" });
    const [, defaultRow, engineeringRow] = within(table).getAllByRole("row");
    expect(within(defaultRow).getByRole("link", { name: "Default" })).toHaveAttribute(
      "href",
      `/company/settings/pipelines/${DEFAULT_PIPELINE_ID}`,
    );
    expect(within(defaultRow).getByText("Default", { selector: "div" })).toBeInTheDocument();
    expect(within(defaultRow).getByText("4 jobs")).toBeInTheDocument();
    expect(within(defaultRow).getByText("7 stages")).toBeInTheDocument();
    expect(within(engineeringRow).getByRole("link", { name: "Engineering" })).toBeInTheDocument();
    expect(within(engineeringRow).getByText("0 jobs")).toBeInTheDocument();
    expect(within(engineeringRow).queryByText("Default", { selector: "div" })).not.toBeInTheDocument();
  });

  it("offers New pipeline and the row actions with settings.stages", async () => {
    signInAs(OWNER_A);
    render(await CompanySettingsPage());

    expect(screen.getByRole("button", { name: "New pipeline" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Actions for Engineering" })).toBeInTheDocument();
    expect(screen.getByText("2 of 10 pipelines used.")).toBeInTheDocument();
    expect(screen.queryByText(forbiddenMessage("settings.stages"))).not.toBeInTheDocument();
  });

  it("disables New pipeline at the limit", async () => {
    vi.mocked(listPipelines).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        summary({ id: `7d1a3c2e-4b5f-8a6d-9e9f-0a1b2c3d4e${i.toString().padStart(2, "0")}`, name: `P${i}`, is_default: i === 0 }),
      ),
    );
    signInAs(OWNER_A);
    render(await CompanySettingsPage());

    expect(screen.getByRole("button", { name: "New pipeline" })).toBeDisabled();
  });

  it("is read-only, with the reason, without settings.stages", async () => {
    signInAs(MEMBER_A);
    render(await CompanySettingsPage());

    expect(screen.getByText(forbiddenMessage("settings.stages"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New pipeline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View" })).toHaveLength(2);
  });

  it("offers only pipeline chips, and the editing ones only with settings.stages", async () => {
    signInAs(OWNER_A);
    const { unmount } = render(await CompanySettingsPage());
    expect(screen.getByRole("link", { name: "Add a stage" })).toHaveAttribute(
      "href",
      expect.stringMatching(/^\/company\/agent\?prompt=/),
    );
    expect(screen.queryByRole("link", { name: "Write an email template" })).not.toBeInTheDocument();
    unmount();

    signInAs(MEMBER_A);
    render(await CompanySettingsPage());
    expect(screen.queryByRole("link", { name: "Add a stage" })).not.toBeInTheDocument();
  });
});
