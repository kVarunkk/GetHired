import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { getCareersPage } from "@/helpers/careers/get-careers-page";
import { getJobPageDetails } from "@/helpers/jobs/jobId/get-job-details";
import { useApplicationSource } from "@/components/jobs/ApplicationSourceContext";
import CareersJobPage, { generateMetadata } from "./page";

vi.mock("@/components/careers/CareersAccount", () => ({ default: () => null }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/careers/get-careers-page", () => ({ getCareersPage: vi.fn() }));
vi.mock("@/helpers/jobs/jobId/get-job-details", () => ({
  getJobPageDetails: vi.fn(),
  isJobClosed: (job: { status: string }) => job.status !== "active",
}));
vi.mock("@/components/jobs/ClosedJobView", () => ({
  default: ({ browseHref }: { browseHref: string }) => <div data-testid="closed" data-browse={browseHref} />,
}));
vi.mock("@/helpers/jobs/jobId/jsonld", () => ({ buildJobPostingJsonLd: () => ({ "@type": "JobPosting" }) }));
vi.mock("@/components/JobClientHydrator", () => ({
  default: function Hydrator({ job }: { job: { job_name: string } }) {
    const source = useApplicationSource();
    return <div data-testid="job" data-source={JSON.stringify(source)}>{job.job_name}</div>;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_")) throw err;
  },
}));

const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";
const JOB_ID = "d0000000-0000-4000-8000-000000000001";
const PAGE = { id: COMPANY_ID, slug: "acme", name: "Acme", accentColor: null } as never;
const JOB = { id: JOB_ID, job_name: "Backend Engineer", status: "active", job_postings: [{ company_id: COMPANY_ID }] } as never;

const show = async (searchParams: Record<string, string> = {}) =>
  render(await CareersJobPage({ params: Promise.resolve({ slug: "acme", job_id: JOB_ID }), searchParams: Promise.resolve(searchParams) }));

beforeEach(() => {
  vi.mocked(getCareersPage).mockResolvedValue({ page: PAGE });
  vi.mocked(getJobPageDetails).mockResolvedValue(JOB);
});

describe("/careers/[slug]/jobs/[job_id] (CPT-046, CP-DEC-001)", () => {
  it("shows the job in the company's frame, with a careers-page source for Apply", async () => {
    await show({ ref: "LinkedIn" });

    expect(screen.getByTestId("job")).toHaveTextContent("Backend Engineer");
    expect(JSON.parse(screen.getByTestId("job").dataset.source!)).toEqual({
      source: "careers_page",
      ref: "linkedin",
      returnTo: `/careers/acme/jobs/${JOB_ID}?ref=linkedin`,
      applyHref: `/careers/acme/jobs/${JOB_ID}/apply?ref=linkedin`,
    });
    expect(screen.getByRole("link", { name: "Back to Acme careers" })).toHaveAttribute("href", "/careers/acme?ref=linkedin");
  });

  it("is a 404 for another company's job", async () => {
    vi.mocked(getJobPageDetails).mockResolvedValue({ ...(JOB as object), job_postings: [{ company_id: "other" }] } as never);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("is a 404 for a scraped job with no posting", async () => {
    vi.mocked(getJobPageDetails).mockResolvedValue({ ...(JOB as object), job_postings: [] } as never);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a closed job as closed, in the company's frame, instead of a 404", async () => {
    vi.mocked(getJobPageDetails).mockResolvedValue({ ...(JOB as object), status: "inactive" } as never);
    await show({ ref: "LinkedIn" });

    expect(screen.queryByTestId("job")).toBeNull();
    expect(screen.getByTestId("closed")).toHaveAttribute("data-browse", "/careers/acme?ref=linkedin");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "acme", job_id: JOB_ID }) });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });

  it("keeps /jobs/[id] canonical (CP-REQ-011)", async () => {
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "acme", job_id: JOB_ID }) });
    expect(meta.alternates?.canonical).toBe(`https://gethired.devhub.co.in/jobs/${JOB_ID}`);
    expect(meta.title).toBe("Backend Engineer at Acme");
    expect(meta.robots).toBeUndefined();
  });
});
