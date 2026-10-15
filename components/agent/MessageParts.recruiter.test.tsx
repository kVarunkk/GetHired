import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UIMessage } from "ai";
import MessageParts from "./MessageParts";

vi.mock("@/app/actions/upload-resume-file", () => ({ uploadResumeAction: vi.fn() }));

const assistant = (parts: unknown[]): UIMessage =>
  ({ id: "a1", role: "assistant", parts }) as UIMessage;

const output = (tool: string, value: unknown, input: unknown = {}) => ({
  type: `tool-${tool}`,
  toolCallId: `c-${tool}`,
  state: "output-available",
  input,
  output: value,
});

const renderParts = (message: UIMessage) => {
  const callbacks = { onApprove: vi.fn(), onToolOutput: vi.fn() };
  render(<MessageParts message={message} {...callbacks} />);
  return callbacks;
};

const CANDIDATE = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Priya Raghunathan",
  roles: ["Frontend Engineer"],
  experienceYears: 5,
  locations: ["pune", "remote"],
  topSkills: ["React"],
  salary: "₹1500000–₹2500000",
  workStyle: [],
  url: "/company/profiles/a0000000-0000-4000-8000-000000000001?job_post=b1",
};

describe("MessageParts: recruiter results (RA-TEST-009)", () => {
  it("renders candidates as rows linking to their profile, with the match score", () => {
    renderParts(
      assistant([
        output("findMatchesForJob", {
          job: { id: "b1", title: "Frontend" },
          candidates: [{ ...CANDIDATE, rank: 1, matchScore: 88, matchSummary: "<match_explanation>\nx\n</match_explanation>" }],
        }),
      ]),
    );

    const link = screen.getByRole("link", { name: /Priya Raghunathan/ });
    expect(link).toHaveAttribute("href", CANDIDATE.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(link).getByText(/Frontend Engineer · 5 yrs/)).toBeInTheDocument();
    expect(screen.getByLabelText("Match score 88 out of 100, strong")).toBeInTheDocument();
    expect(screen.queryByText(/match_explanation/)).not.toBeInTheDocument();
  });

  it("skips candidates a comparison couldn't load", () => {
    renderParts(
      assistant([
        output("compareCandidates", {
          job: { id: "b1", title: "Frontend" },
          candidates: [CANDIDATE, { id: "x", error: "Candidate not found." }],
        }),
      ]),
    );

    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("never links a candidate URL outside the app", () => {
    renderParts(
      assistant([
        output("searchCandidates", {
          candidates: [{ ...CANDIDATE, url: "https://evil.com/x" }],
        }),
      ]),
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Priya Raghunathan")).toBeInTheDocument();
  });

  it("says when a search found no one", () => {
    renderParts(assistant([output("searchCandidates", { candidates: [] })]));

    expect(screen.getByText("No candidates found.")).toBeInTheDocument();
  });

  it("renders applicants with their job, status and fit", () => {
    renderParts(
      assistant([
        output("listApplicants", {
          applicants: [
            {
              applicationId: "e1",
              candidateId: "a1",
              name: "Ada Lovelace",
              roles: [],
              experienceYears: 4,
              job: { id: "b1", title: "Backend Engineer" },
              status: "reviewed",
              appliedAt: new Date().toISOString(),
              screening: "completed",
              fitScore: 77,
              recommendation: "yes",
              url: "/company/applicants/e1",
            },
          ],
        }),
      ]),
    );

    const link = screen.getByRole("link", { name: /Ada Lovelace/ });
    expect(link).toHaveAttribute("href", "/company/applicants/e1");
    expect(within(link).getByText(/Backend Engineer/)).toBeInTheDocument();
    expect(within(link).getByText(/Reviewed/)).toBeInTheDocument();
    expect(screen.getByLabelText("Match score 77 out of 100, strong")).toBeInTheDocument();
  });

  it("links a saved job post", () => {
    renderParts(
      assistant([
        output("createJobPost", {
          id: "b1",
          title: "Founding Engineer",
          status: "inactive",
          url: "/company/job-posts/b1",
        }),
      ]),
    );

    expect(screen.getByText(/Saved .*Founding Engineer.* as a draft/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job post" })).toHaveAttribute(
      "href",
      "/company/job-posts/b1",
    );
  });

  it("shows a plan limit with an upgrade link", () => {
    renderParts(
      assistant([
        output("screenApplicants", {
          error: "PLAN_LIMIT",
          message: "You've used 100 of 100 screenings this period.",
          upgradeUrl: "/company/billing",
        }),
      ]),
    );

    expect(screen.getByText("You've used 100 of 100 screenings this period.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/company/billing");
  });

  it("explains when matching hasn't run for a job", () => {
    renderParts(assistant([output("findMatchesForJob", { status: "not_run", jobPostId: "b1" })]));

    expect(screen.getByText("Matching hasn't run for this job yet")).toBeInTheDocument();
  });
});

describe("MessageParts: recruiter approvals (RA-REQ-005)", () => {
  const approval = (tool: string, input: unknown) => ({
    type: `tool-${tool}`,
    toolCallId: "c1",
    state: "approval-requested",
    input,
    approval: { id: "ap1" },
  });

  it("lists a status change's count, status and whether applicants get an email", async () => {
    const { onApprove } = renderParts(
      assistant([
        approval("updateApplicationStatus", {
          applicationIds: ["e1", "e2", "e3"],
          status: "rejected",
          notify: true,
        }),
      ]),
    );

    expect(screen.getByText("Move 3 applications to Rejected?")).toBeInTheDocument();
    expect(screen.getByText("Email the applicants")).toBeInTheDocument();
    expect(screen.queryByText(/e1/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith({ id: "ap1", approved: true });
  });

  it("shows a job post draft's fields with readable labels", () => {
    renderParts(
      assistant([
        approval("createJobPost", {
          title: "Founding Engineer",
          description: "Own the backend.",
          locations: ["Bengaluru"],
          jobType: "Fulltime",
          minSalary: 3000000,
          maxSalary: 4000000,
          visaSponsorship: "Not Required",
        }),
      ]),
    );

    expect(screen.getByText("Create this job post as a draft?")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Founding Engineer")).toBeInTheDocument();
    expect(screen.getByText("Visa sponsorship")).toBeInTheDocument();
  });

  it("asks before publishing a job post", () => {
    renderParts(assistant([approval("setJobPostStatus", { jobPostId: "b1", status: "active" })]));

    expect(screen.getByText("Publish this job post?")).toBeInTheDocument();
  });
});
