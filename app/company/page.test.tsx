import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseMock, type SupabaseMock } from "@/test/utils/supabase-mock";
import { COMPANY_A } from "@/test/utils/recruiter";
import CompanyPage from "./page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/components/CreateJobPostingDialog", () => ({ default: () => null }));
vi.mock("@/components/CompanyJobPostingCard", () => ({
  default: ({ job }: { job: { title: string } }) => <div>{job.title}</div>,
}));
vi.mock("@/components/agent/recruiter/AskRecruiterAgent", () => ({ default: () => null }));
vi.mock("server-only", () => ({}));

let db: SupabaseMock;

/** The company, its metrics, and empty jobs and applicants lists. */
function dashboard(metrics: unknown) {
  db.queue("company_info", { data: { id: COMPANY_A.id, name: "Acme" }, error: null });
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
      "/company/applicants/app-1",
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

    expect(screen.getByText("How are you doing today, Acme?")).toBeInTheDocument();
  });
});
