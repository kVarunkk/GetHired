import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
}));
vi.mock("@/helpers/applications/application-page", () => ({
  loadApplicationFrame: vi.fn(),
  loadApplicationInterview: vi.fn(),
}));
vi.mock("@/components/interviews/InterviewReport", () => ({ default: () => <p>Report</p> }));
vi.mock("@/components/interviews/InviteToInterviewButton", () => ({
  default: ({ applicationId, candidateName }: { applicationId: string; candidateName: string }) => (
    <button type="button">
      Invite {candidateName} ({applicationId})
    </button>
  ),
}));

import { loadApplicationFrame, loadApplicationInterview } from "@/helpers/applications/application-page";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import ApplicationInterviewPage from "./page";

const APP = "ab000000-0000-4000-8000-000000000001";
const JOB = "b1000000-0000-4000-8000-000000000001";
const JOB_HREF = `/company/job-posts/${JOB}/interview`;

async function renderWith({
  canView = true,
  canManage = false,
  interview = null as unknown,
  enabled = false as boolean | null,
  stageKind = "active" as string | null,
  mergedInto = null as unknown,
} = {}) {
  const mock = createSupabaseMock();
  mock.queue("pipeline_stages", { data: stageKind ? { kind: stageKind } : null, error: null });
  vi.mocked(loadApplicationFrame).mockResolvedValue({
    jobId: JOB,
    supabase: mock.client,
    mergedInto,
    application: { id: APP, stage_id: "s1" },
    person: { name: "Ada" },
  } as never);
  vi.mocked(loadApplicationInterview).mockResolvedValue({
    canView,
    canManage,
    interview,
    config: enabled === null ? null : { enabled },
  } as never);
  render(await ApplicationInterviewPage({ params: Promise.resolve({ application_id: APP }) }));
}

beforeEach(() => vi.clearAllMocks());

describe("the application's AI interview page", () => {
  it("shows when the job's AI interview is off, with a link to turn it on", async () => {
    await renderWith({ enabled: false });
    expect(screen.getByText("The AI interview is off for this job")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up the AI interview" })).toHaveAttribute("href", JOB_HREF);
  });

  it("treats a job with no config as off", async () => {
    await renderWith({ enabled: null });
    expect(screen.getByRole("link", { name: "Set up the AI interview" })).toHaveAttribute("href", JOB_HREF);
  });

  it("says the candidate isn't invited yet when it's on", async () => {
    await renderWith({ enabled: true });
    expect(screen.getByText("Not invited yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AI interview settings/ })).toHaveAttribute("href", JOB_HREF);
  });

  it("offers the invite here, for interviews.manage, when it's on and nobody is invited", async () => {
    await renderWith({ enabled: true, canManage: true });
    expect(screen.getByRole("button", { name: `Invite Ada (${APP})` })).toBeInTheDocument();
  });

  it.each([
    ["without interviews.manage", { enabled: true, canManage: false }],
    ["while the job's AI interview is off", { enabled: false, canManage: true }],
    ["in a Rejected stage", { enabled: true, canManage: true, stageKind: "rejected" }],
    ["in a Hired stage", { enabled: true, canManage: true, stageKind: "hired" }],
    ["for a merged import", { enabled: true, canManage: true, mergedInto: { id: "x" } }],
    ["once there's an interview", { enabled: true, canManage: true, interview: { id: "i", status: "invited" } }],
  ])("offers no invite %s", async (_, options) => {
    await renderWith(options);
    expect(screen.queryByRole("button", { name: /Invite/ })).toBeNull();
  });

  it("shows the report when there's an interview", async () => {
    await renderWith({ enabled: true, interview: { id: "i", status: "completed" } });
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AI interview settings/ })).toHaveAttribute("href", JOB_HREF);
  });

  it("is not found without interviews.view", async () => {
    await expect(renderWith({ canView: false })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
