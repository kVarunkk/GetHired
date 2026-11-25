import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { loadApplyPage } from "@/helpers/applications/apply-page";
import { getCareersPage } from "@/helpers/careers/get-careers-page";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import CareersApplyPage, { metadata } from "./page";

vi.mock("@/components/careers/CareersAccount", () => ({ default: () => null }));
vi.mock("server-only", () => ({}));
vi.mock("@/helpers/applications/apply-page", () => ({ loadApplyPage: vi.fn() }));
vi.mock("@/helpers/careers/get-careers-page", () => ({ getCareersPage: vi.fn() }));
vi.mock("@/helpers/jobs/jobId/get-job-details", () => ({ getStaticJobDetails: vi.fn() }));
vi.mock("@/components/apply/ApplyPage", () => ({
  default: (props: Record<string, unknown>) => <div data-testid="apply" data-props={JSON.stringify(props)} />,
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
  permanentRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_PERMANENT ${url}`);
  }),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_")) throw err;
  },
}));

const COMPANY_ID = "c0000000-0000-4000-8000-000000000001";
const JOB_ID = "d0000000-0000-4000-8000-000000000001";
const PAGE = { id: COMPANY_ID, slug: "acme", name: "Acme", accentColor: null } as never;
const JOB = { id: JOB_ID, job_postings: [{ company_id: COMPANY_ID }] } as never;

const show = async (searchParams: Record<string, string> = {}) =>
  render(
    await CareersApplyPage({
      params: Promise.resolve({ slug: "acme", job_id: JOB_ID }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCareersPage).mockResolvedValue({ page: PAGE });
  vi.mocked(getStaticJobDetails).mockResolvedValue(JOB);
  vi.mocked(loadApplyPage).mockResolvedValue({
    kind: "form",
    job: JOB,
    userId: "u1",
    source: "careers_page",
    ref: "linkedin",
    doneHref: `/careers/acme/jobs/${JOB_ID}?ref=linkedin`,
  });
});

describe("/careers/[slug]/jobs/[job_id]/apply (APT-005, AP-REQ-002/020)", () => {
  it("is noindex", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("renders the shared page in the careers frame with the careers route as source", async () => {
    await show({ ref: "LinkedIn", src: "indeed" });

    expect(vi.mocked(loadApplyPage).mock.calls[0][1].careers).toEqual({ slug: "acme" });
    expect(JSON.parse(screen.getByTestId("apply").dataset.props!)).toMatchObject({
      source: "careers_page",
      sourceRef: "linkedin",
      doneHref: `/careers/acme/jobs/${JOB_ID}?ref=linkedin`,
      backLabel: "Back to Acme careers",
    });
  });

  it("is a 404 for another company's job, a scraped job and an unknown page", async () => {
    vi.mocked(getStaticJobDetails).mockResolvedValueOnce({ ...(JOB as object), job_postings: [{ company_id: "other" }] } as never);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(getStaticJobDetails).mockResolvedValueOnce({ ...(JOB as object), job_postings: [] } as never);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
    vi.mocked(getCareersPage).mockResolvedValueOnce(null);
    await expect(show()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadApplyPage).not.toHaveBeenCalled();
  });

  it("redirects a renamed slug permanently, keeping the ref", async () => {
    vi.mocked(getCareersPage).mockResolvedValue({ redirect: "acme-inc" } as never);
    await expect(show({ ref: "x" })).rejects.toThrow(`NEXT_PERMANENT /careers/acme-inc/jobs/${JOB_ID}/apply?ref=x`);
  });

  it("follows loadApplyPage's redirects", async () => {
    vi.mocked(loadApplyPage).mockResolvedValue({ kind: "redirect", to: "/get-started" });
    await expect(show()).rejects.toThrow("NEXT_REDIRECT /get-started");
  });
});
