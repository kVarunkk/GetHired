import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import type { TJobIdPageData } from "@/utils/types/jobs.types";
import JobPage from "./page";

vi.mock("@/helpers/jobs/jobId/get-job-details", () => ({ getStaticJobDetails: vi.fn() }));
vi.mock("@/components/JobClientHydrator", () => ({ default: () => null }));
vi.mock("@/components/PageHeader", () => ({ BackLink: () => null }));
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
