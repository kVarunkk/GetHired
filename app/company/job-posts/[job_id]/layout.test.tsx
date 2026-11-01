import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setRequestUser } from "@/test/utils/auth";
import { jobImportPath } from "@/helpers/candidates/paths";
import { createSupabaseMock } from "@/test/utils/supabase-mock";
import { HIRING_MANAGER_A, JOB_A1, OWNER_A, type MemberFixture } from "@/test/utils/team";
import JobPostLayout from "./layout";

vi.mock("@/lib/supabase/get-user-from-request", () => ({ getUserFromRequest: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  unstable_rethrow: (err: unknown) => {
    throw err;
  },
  usePathname: () => `/company/job-posts/${JOB_A1}/import/spreadsheet`,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/helpers/careers/my-careers-link", () => ({ getMyCareersLink: vi.fn(async () => null) }));
vi.mock("@/components/DeleteJobPosting", () => ({ default: () => null }));
vi.mock("@/components/FindSuitableProfilesForJobPost", () => ({ default: () => null }));
vi.mock("@/components/ShareJobPosting", () => ({ default: () => null }));
vi.mock("@/components/JobPostingsTable", () => ({ JobStatusSwitch: () => null }));

const JOB = {
  id: JOB_A1,
  job_id: "d0000000-0000-4000-8000-000000000001",
  title: "Backend Engineer",
  created_at: "2026-10-01T00:00:00.000Z",
  company_info: { name: "Acme", website: null },
};

async function renderAs(member: MemberFixture) {
  const db = createSupabaseMock({ user: member.user });
  db.queueRpc("my_company_access", { data: member.membership, error: null });
  db.queue("job_postings", { data: JOB, error: null });
  await setRequestUser(member.user, db.client);
  render(
    <TooltipProvider>
      {await JobPostLayout({ params: Promise.resolve({ job_id: JOB_A1 }), children: <p>Section</p> })}
    </TooltipProvider>,
  );
  return screen.getAllByRole("navigation", { name: "Job post sections" })[0];
}

beforeEach(() => vi.clearAllMocks());

describe("the job's Import candidates nav item (CPT-019, CP-REQ-020)", () => {
  it("is labelled Import candidates and active on every method's route", async () => {
    const nav = await renderAs(OWNER_A);
    const link = within(nav).getByRole("link", { name: /Import candidates/ });
    expect(link).toHaveAttribute("href", jobImportPath(JOB_A1));
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: /Import resumes/ })).not.toBeInTheDocument();
  });

  it("is hidden without applicants.import for the job", async () => {
    const nav = await renderAs(HIRING_MANAGER_A);
    expect(within(nav).queryByRole("link", { name: /Import candidates/ })).not.toBeInTheDocument();
  });
});
