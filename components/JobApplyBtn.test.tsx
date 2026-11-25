import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { appliedJobFor } from "@/helpers/tracker/applied-state";
import JobApplyBtn from "./JobApplyBtn";

vi.mock("./jobs/ApplicationSourceContext", () => ({
  useLoginToApplyHref: () => "/auth/login",
  useApplyHref: () => "/jobs/j1/apply",
}));
vi.mock("@/app/actions/deduct-application-credits", () => ({ deductApplicationCreditsAction: vi.fn() }));
vi.mock("@/helpers/jobs/JobStatusDialog", () => ({ default: () => null }));
vi.mock("swr", () => ({ mutate: vi.fn() }));

const external = { id: "j1", job_name: "Engineer", company_name: "Acme", is_platform_job: false, job_url: "https://acme.com/jobs/1" } as never;
const platform = { id: "j1", job_name: "Engineer", company_name: "Acme", is_platform_job: true, status: "active" } as never;

const renderBtn = (job: never, profile: Parameters<typeof appliedJobFor>[0]) =>
  render(
    <JobApplyBtn
      isCompanyUser={false}
      userId="u1"
      job={job}
      isOnboardingComplete
      appliedJob={appliedJobFor(profile, "j1", Boolean((job as { is_platform_job: boolean }).is_platform_job))}
      isJobIdPage
      isLoading={false}
      hasCredits
    />,
  );

describe("JobApplyBtn's applied state (AT-REQ-034)", () => {
  it("shows a tracked card's label", () => {
    renderBtn(external, { tracked_applications: [{ all_jobs_id: "j1", status: "interviewing" }] });
    expect(screen.getByRole("button", { name: "Interviewing" })).toBeDisabled();
  });

  it("offers Apply for a saved card", () => {
    renderBtn(external, { tracked_applications: [{ all_jobs_id: "j1", status: "saved" }] });
    expect(screen.getByRole("button", { name: /Apply Now/ })).toBeEnabled();
  });

  it("shows an old external row through the mapping", () => {
    renderBtn(external, { applications: [{ all_jobs_id: "j1", status: "selected" }] });
    expect(screen.getByRole("button", { name: "Offer" })).toBeDisabled();
  });

  it("shows a GetHired application's status unchanged", () => {
    renderBtn(platform, { applications: [{ all_jobs_id: "j1", status: "reviewed" }] });
    expect(screen.getByRole("button", { name: "reviewed" })).toBeDisabled();
  });

  it("links Easy Apply to the apply page for an untouched GetHired job", () => {
    renderBtn(platform, {});
    expect(screen.getByRole("link", { name: /Easy Apply/ })).toHaveAttribute("href", "/jobs/j1/apply");
  });

  it("offers Apply with nothing tracked", () => {
    renderBtn(external, {});
    expect(screen.getByRole("button", { name: /Apply Now/ })).toBeEnabled();
  });
});
