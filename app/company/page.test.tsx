import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import { MEMBER_A, OWNER_A } from "@/test/utils/team";
import CompanyPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/jobs/JobPostButtons", () => ({
  CreateJobPostButton: ({ disabled }: { disabled?: boolean }) => <button disabled={disabled}>Create New Job Post</button>,
}));
vi.mock("@/components/CompanyJobPostingCard", () => ({
  default: ({ job }: { job: { title: string } }) => <div>{job.title}</div>,
}));
vi.mock("@/components/agent/recruiter/AskRecruiterAgent", () => ({ default: () => null }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

/** The company, its metrics, and empty jobs and applicants lists. */
function dashboard(metrics: unknown) {
  db.queueRpc("my_company_access", { data: OWNER_A.membership, error: null });
  db.queueRpc("get_company_metrics", { data: metrics, error: null });
}

const metricCard = (label: string) => screen.getByText(label).parentElement as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  db = createSupabaseMock({ user: COMPANY_A.user });
  vi.mocked(createClient).mockResolvedValue(db.client);
});

describe("company dashboard (PLT-082 characterisation)", () => {
  it("shows get_company_metrics' job, applicant and today counts", async () => {
    dashboard([{ total_jobs: 3, total_applicants: 12, new_applicants_today: 2 }]);

    render(await CompanyPage());

    expect(within(metricCard("Job Posts")).getByText("3")).toBeInTheDocument();
    expect(within(metricCard("Total Applicants")).getByText("12")).toBeInTheDocument();
    expect(within(metricCard("New Applicants Today")).getByText("2")).toBeInTheDocument();
    expect(db.callsFor("get_company_metrics")[0].chain[0].args).toEqual([
      "get_company_metrics",
      { company_id: COMPANY_A.id },
    ]);
  });

  it("shows zeros when the RPC returns nothing", async () => {
    dashboard([]);

    render(await CompanyPage());

    expect(within(metricCard("Job Posts")).getByText("0")).toBeInTheDocument();
    expect(within(metricCard("Total Applicants")).getByText("0")).toBeInTheDocument();
  });

  it("shows the pipeline totals and the applications that need attention (PLT-082)", async () => {
    dashboard([{ total_jobs: 1, total_applicants: 3, new_applicants_today: 0 }]);
    db.queue("job_postings", { data: [], error: null }); // "Your Job Posts"
    db.queue("job_postings", { data: [{ id: "job-1", title: "Backend Engineer" }], error: null });
    db.queueRpc("get_job_funnel", {
      data: {
        stages: [
          { stage_id: "s1", name: "Applied", kind: "applied", count: 2, reached: 3, median_days: null },
          { stage_id: "s2", name: "Screening", kind: "screening", count: 1, reached: 1, median_days: null },
        ],
        sources: { applied: 3 },
        time_to_hire_days: null,
        total: 3,
      },
      error: null,
    });
    db.queue("applications", { data: [], error: null }); // "Recent Applicants"
    db.queue("applications", {
      data: [
        {
          id: "app-1",
          stage_entered_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          applicant_user_id: "user-1",
          company_candidate_id: null,
          user_info: { full_name: "Priya Sharma" },
          job_postings: { id: "job-1", title: "Backend Engineer", company_id: COMPANY_A.id },
        },
      ],
      error: null,
    });
    db.queue("application_events", { data: [], error: null });

    render(await CompanyPage());

    const strip = screen.getByRole("list", { name: "Pipeline funnel" });
    expect(within(strip).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Applied2", "Screening1"]);
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(within(attention).getByRole("link", { name: "Priya Sharma" })).toHaveAttribute(
      "href",
      "/company/applications/app-1",
    );
    expect(attention).toHaveTextContent("5 days in Applied");
    // The metrics are unchanged.
    expect(within(metricCard("Total Applicants")).getByText("3")).toBeInTheDocument();
  });

  it("still renders the dashboard when the funnel fails", async () => {
    dashboard([{ total_jobs: 1, total_applicants: 3, new_applicants_today: 0 }]);
    db.queue("job_postings", { data: [], error: null });
    db.queue("job_postings", { data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(await CompanyPage());

    expect(within(metricCard("Job Posts")).getByText("1")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Pipeline funnel" })).not.toBeInTheDocument();
  });

  it("greets the company by name", async () => {
    dashboard([{ total_jobs: 0, total_applicants: 0, new_applicants_today: 0 }]);

    render(await CompanyPage());

    expect(screen.getByRole("heading", { level: 1, name: "How are you doing today, Acme?" })).toBeInTheDocument();
  });
});

describe("company dashboard for a removed member (TMT-053, difference 14)", () => {
  it("says they're no longer part of a company instead of erroring", async () => {
    db = createSupabaseMock({ user: MEMBER_A.user });
    vi.mocked(createClient).mockResolvedValue(db.client);
    db.queueRpc("my_company_access", { data: null, error: null });

    render(await CompanyPage());

    expect(
      screen.getByText("You're no longer part of a company on GetHired. Ask your team for a new invite."),
    ).toBeInTheDocument();
    expect(db.callsFor("get_company_metrics")).toHaveLength(0);
  });
});

describe("company dashboard gating (RP-REQ-016, RPT-024)", () => {
  it("locks Create New Job Post without jobs.create", async () => {
    db.queueRpc("my_company_access", { data: MEMBER_A.membership, error: null });
    db.queueRpc("get_company_metrics", { data: [], error: null });

    render(await CompanyPage());

    expect(screen.getByRole("button", { name: "Create New Job Post" })).toBeDisabled();
  });

  it("enables it with jobs.create", async () => {
    dashboard([]);

    render(await CompanyPage());

    expect(screen.getByRole("button", { name: "Create New Job Post" })).toBeEnabled();
  });
});

describe("company dashboard careers link (CP-REQ-014, CPT-053)", () => {
  it("shows the careers page link", async () => {
    dashboard([]);
    db.queue("company_info", { data: { careers_slug: "acme", careers_published: true }, error: null });

    render(await CompanyPage());

    expect(screen.getByRole("link", { name: "gethired.devhub.co.in/careers/acme" })).toHaveAttribute("href", "/careers/acme");
  });
});

describe("company dashboard interview follow-ups (IVT-074)", () => {
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const row = (overrides: Record<string, unknown>) => ({
    interview_id: "iv-1",
    application_id: "app-1",
    job_post_id: "job-1",
    job_title: "Backend Engineer",
    candidate_name: "Priya Sharma",
    interview_name: "Tech screen",
    since: ago(48),
    owed: 1,
    mine: false,
    kind: "feedback_overdue",
    ...overrides,
  });

  it("lists overdue feedback (the member's own first, to the kit) and links nobody booked", async () => {
    dashboard([{ total_jobs: 1, total_applicants: 3, new_applicants_today: 0 }]);
    db.queueRpc("interviews_needing_attention", {
      data: [
        row({ interview_id: "iv-mine", mine: true, interview_name: "System design" }),
        row({ interview_id: "iv-team", application_id: "app-2", candidate_name: "Arjun Rao", owed: 2 }),
        row({
          kind: "awaiting_candidate",
          interview_id: "iv-link",
          application_id: "app-3",
          candidate_name: null,
          owed: 0,
          since: ago(4 * 24),
        }),
      ],
      error: null,
    });

    render(await CompanyPage());

    const region = screen.getByRole("region", { name: "Interviews needing attention" });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole("link", { name: "Your scorecard for System design" })).toHaveAttribute(
      "href",
      "/company/interviews/iv-mine",
    );
    expect(items[0]).toHaveTextContent("with Priya Sharma for Backend Engineer");
    expect(items[0]).toHaveTextContent("Ended 2 days ago");
    expect(within(items[1]).getByRole("link", { name: "Arjun Rao" })).toHaveAttribute(
      "href",
      "/company/applications/app-2/interviews",
    );
    expect(items[1]).toHaveTextContent("Tech screen for Backend Engineer");
    expect(items[1]).toHaveTextContent("2 scorecards overdue");
    expect(within(items[2]).getByRole("link", { name: "The candidate" })).toHaveAttribute(
      "href",
      "/company/applications/app-3/interviews",
    );
    expect(items[2]).toHaveTextContent("Link sent 4 days ago, not booked");
    expect(db.callsFor("interviews_needing_attention")[0].chain[0].args).toEqual([
      "interviews_needing_attention",
      { p_limit: 10 },
    ]);
  });

  it("shows nothing with nothing to follow up, and still renders when the call fails", async () => {
    dashboard([{ total_jobs: 1, total_applicants: 0, new_applicants_today: 0 }]);
    db.queueRpc("interviews_needing_attention", { data: [], error: null });
    render(await CompanyPage());
    expect(screen.queryByRole("region", { name: "Interviews needing attention" })).not.toBeInTheDocument();

    dashboard([{ total_jobs: 1, total_applicants: 0, new_applicants_today: 0 }]);
    db.queueRpc("interviews_needing_attention", { data: null, error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(await CompanyPage());
    expect(screen.getAllByText("Job Posts").length).toBeGreaterThan(0);
    expect(screen.queryByRole("region", { name: "Interviews needing attention" })).not.toBeInTheDocument();
  });
});
