import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getJobPageDetails } from "@/helpers/jobs/jobId/get-job-details";
import type { TJobIdPageData } from "@/utils/types/jobs.types";
import JobPage, { generateMetadata } from "./page";

vi.mock("@/helpers/jobs/jobId/get-job-details", () => ({
  getJobPageDetails: vi.fn(),
  isJobClosed: (job: { status: string }) => job.status !== "active",
}));
vi.mock("@/components/jobs/ClosedJobView", () => ({ default: () => <div data-testid="closed" /> }));
vi.mock("@/components/JobClientHydrator", () => ({ default: () => null }));
vi.mock("@/components/jobs/JobSourceProvider", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/PageHeader", () => ({ BackLink: () => null }));
vi.mock("@/components/job-alerts/JobAlertClickTracker", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

describe("/jobs/[job_id] structured data", () => {
  it("can't be broken out of by a job's own text", async () => {
    const payload = "</script><script>alert(1)</script>";
    vi.mocked(getJobPageDetails).mockResolvedValue({
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

describe("/jobs/[job_id] for a closed job", () => {
  const JOB_ID = "d0000000-0000-4000-8000-000000000002";
  const closed = {
    id: JOB_ID,
    job_name: "Engineer",
    company_name: "Acme",
    description: "Build things.",
    status: "inactive",
    created_at: "2026-11-01T00:00:00Z",
  } as unknown as TJobIdPageData;

  it("shows the closed view, with no structured data, instead of a 404", async () => {
    vi.mocked(getJobPageDetails).mockResolvedValue(closed);
    const { container } = render(await JobPage({ params: Promise.resolve({ job_id: JOB_ID }) }));
    expect(screen.getByTestId("closed")).toBeInTheDocument();
    expect(container.querySelectorAll("script")).toHaveLength(0);
  });

  it("leaves search", async () => {
    vi.mocked(getJobPageDetails).mockResolvedValue(closed);
    const meta = await generateMetadata({ params: Promise.resolve({ job_id: JOB_ID }) });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("is still a 404 for a job that doesn't exist", async () => {
    vi.mocked(getJobPageDetails).mockResolvedValue(null);
    await expect(JobPage({ params: Promise.resolve({ job_id: JOB_ID }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
