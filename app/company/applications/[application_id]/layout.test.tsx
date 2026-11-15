import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { JOB_A1, OWNER_A, memberWith, type MemberFixture } from "@/test/utils/team";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
  usePathname: () => `/company/applications/${APP}/interviews`,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/helpers/applications/application-page", () => ({
  applicationPath: (id: string) => `/company/applications/${id}`,
  loadApplicationFrame: vi.fn(),
  loadApplicationInterview: vi.fn(),
}));
vi.mock("@/components/pipeline/StagePicker", () => ({ default: () => null }));
vi.mock("@/components/interviews/ScreeningInterviewActions", () => ({ default: () => null }));
vi.mock("@/components/candidates/MergedNotice", () => ({ default: () => null }));
vi.mock("@/components/candidates/ImportedBadge", () => ({ default: () => null }));
vi.mock("@/helpers/interviews/plan", () => ({ loadSchedulingPlan: vi.fn(async () => ({})) }));

import { loadApplicationFrame, loadApplicationInterview } from "@/helpers/applications/application-page";
import { loadSchedulingPlan } from "@/helpers/interviews/plan";
import ApplicationLayout from "./layout";

const APP = "ab000000-0000-4000-8000-000000000001";

async function renderAs(
  member: MemberFixture,
  { aiInterview = false, canView }: { aiInterview?: boolean; canView?: boolean } = {},
) {
  const db = createSupabaseMock({ user: member.user });
  vi.mocked(loadApplicationFrame).mockResolvedValue({
    supabase: db.client,
    user: member.user,
    company: member.myCompany,
    application: {
      id: APP,
      stage_id: null,
      job_postings: { id: JOB_A1, title: "Backend Engineer", company_id: member.company.id },
    },
    person: { name: "One", kind: "user" },
    jobId: JOB_A1,
    mergedInto: null,
    mergedFrom: [],
  } as never);
  vi.mocked(loadApplicationInterview).mockResolvedValue({
    canView: canView ?? aiInterview,
    canManage: false,
    interview: aiInterview ? ({ id: "i", status: "completed" } as never) : null,
    config: null,
  } as never);
  render(
    <TooltipProvider>
      {await ApplicationLayout({ params: Promise.resolve({ application_id: APP }), children: <p>Section</p> })}
    </TooltipProvider>,
  );
  return screen.getAllByRole("navigation", { name: "Application sections" })[0];
}

beforeEach(() => vi.clearAllMocks());

describe("the application's interview nav items (IVT-020)", () => {
  it('labels the people interviews "Interviews" and the AI one "AI interview"', async () => {
    const nav = await renderAs(OWNER_A, { aiInterview: true });
    expect(within(nav).getByRole("link", { name: /^Interviews$/ })).toHaveAttribute(
      "href",
      `/company/applications/${APP}/interviews`,
    );
    expect(within(nav).getByRole("link", { name: /^AI interview$/ })).toHaveAttribute(
      "href",
      `/company/applications/${APP}/ai-interview`,
    );
  });

  it("shows AI interview with interviews.view even before there's an interview", async () => {
    const nav = await renderAs(memberWith(["interviews.view"]), { canView: true });
    expect(within(nav).getByRole("link", { name: /^AI interview$/ })).toHaveAttribute(
      "href",
      `/company/applications/${APP}/ai-interview`,
    );
  });

  it("hides AI interview without interviews.view", async () => {
    const nav = await renderAs(memberWith(["jobs.view", "applicants.view"]));
    expect(within(nav).queryByRole("link", { name: /^AI interview$/ })).not.toBeInTheDocument();
  });

  it("hides Interviews without scheduling.view for the job", async () => {
    const nav = await renderAs(memberWith(["jobs.view", "applicants.view"]));
    expect(within(nav).queryByRole("link", { name: /^Interviews$/ })).not.toBeInTheDocument();
  });

  it("shows Interviews with scheduling.view", async () => {
    const nav = await renderAs(memberWith(["scheduling.view"]));
    expect(within(nav).getByRole("link", { name: /^Interviews$/ })).toBeInTheDocument();
  });
});

describe("the stage picker's schedule prompt (IVT-072, D8)", () => {
  it("loads the job's plan for scheduling.manage", async () => {
    await renderAs(memberWith(["pipeline.move", "scheduling.manage"]));
    expect(loadSchedulingPlan).toHaveBeenCalledWith(expect.anything(), JOB_A1);
  });

  it("doesn't load it without scheduling.manage", async () => {
    await renderAs(memberWith(["pipeline.move", "scheduling.view"]));
    expect(loadSchedulingPlan).not.toHaveBeenCalled();
  });
});
