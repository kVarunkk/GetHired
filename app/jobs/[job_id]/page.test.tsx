import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getClosedJobSummary, getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import type { TJobIdPageData } from "@/utils/types/jobs.types";
import JobPage, { generateMetadata } from "./page";

vi.mock("@/helpers/jobs/jobId/get-job-details", () => ({ getStaticJobDetails: vi.fn(), getClosedJobSummary: vi.fn() }));
vi.mock("@/components/JobClientHydrator", () => ({ default: () => null }));
vi.mock("@/components/jobs/JobSourceProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/PageHeader", () => ({ BackLink: () => null }));
vi.mock("@/components/job-alerts/JobAlertClickTracker", () => ({ default: () => null }));
vi.mock("@/components/jobs/MyApplicationLink", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

describe("/jobs/[job_id] structured data", () => {
  it("can't be broken out of by a job's own text", async () => {
    const payload = "</script><script>alert(1)</script>";
    vi.mocked(getStaticJobDetails).mockResolvedValue({
      id: "d0000000-0000-4000-8000-000000000001",
      job_name: `Engineer ${payload}`,
      company_name: `Acme ${payload}`,
      description: "Build things.",
      status: "active",
      created_at: "2026-11-01T00:00:00Z",
    } as unknown as TJobIdPageData);

    const { container } = render(await JobPage({ params: Promise.resolve({ job_id: "d0000000-0000-4000-8000-000000000001" }) }));

    const scripts = container.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0].innerHTML).not.toContain("<");
    const data = JSON.parse(scripts[0].innerHTML);
    expect(data.title).toBe(`Engineer ${payload}`);
    expect(data.hiringOrganization.name).toBe(`Acme ${payload}`);
  });
});

describe("/jobs/[job_id] for a job that closed (JLT-025, JL-REQ-028)", () => {
  const JOB_ID = "d0000000-0000-4000-8000-000000000002";
  const params = Promise.resolve({ job_id: JOB_ID });

  it("reads the same for paused, closed and filled: no longer accepting applications", async () => {
    vi.mocked(getStaticJobDetails).mockResolvedValue(null);
    vi.mocked(getClosedJobSummary).mockResolvedValue({
      id: JOB_ID,
      jobName: "Backend Engineer",
      companyName: "Acme",
      companyId: "c0000000-0000-4000-8000-000000000001",
    });

    const { container } = render(await JobPage({ params }));

    expect(screen.getByRole("status")).toHaveTextContent("This job is no longer accepting applications.");
    expect(screen.getByRole("heading", { name: "Backend Engineer" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).not.toMatch(/filled|paused|cancel/i);
    expect((await generateMetadata({ params })).robots).toEqual({ index: false, follow: true });
  });

  it("is a 404 for a draft or a job that never existed", async () => {
    vi.mocked(getStaticJobDetails).mockResolvedValue(null);
    vi.mocked(getClosedJobSummary).mockResolvedValue(null);

    await expect(JobPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
