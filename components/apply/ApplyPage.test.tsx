import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { mutate } from "swr";
import ApplyPage from "./ApplyPage";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("@/components/agent/AgentHandoff", () => ({ default: () => <div>handoff</div> }));
vi.mock("@/components/apply/ApplyJobSummary", () => ({ default: () => <div>summary</div> }));
const INVITE = { id: "a1000000-0000-4000-8000-000000000001", durationMinutes: 15, deadlineAt: "2026-10-24T12:00:00.000Z" };
let invite: typeof INVITE | undefined;
vi.mock("@/components/JobApplicationForm", () => ({
  default: ({ onSuccess }: { onSuccess: (i?: typeof INVITE) => void }) => (
    <button onClick={() => onSuccess(invite)}>send</button>
  ),
}));

const JOB = { id: "j1", job_name: "Backend Engineer", company_name: "Acme" } as never;
const renderPage = () => render(<ApplyPage job={JOB} userId="u1" doneHref="/jobs/j1" />);

beforeEach(() => {
  vi.clearAllMocks();
  invite = undefined;
});

describe("ApplyPage (APT-004, AP-REQ-033–036)", () => {
  it("shows the header, handoff, form and job summary", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Apply for Backend Engineer" })).toBeInTheDocument();
    expect(screen.getByText("handoff")).toBeInTheDocument();
    expect(screen.getByText("summary")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to job" })).toHaveAttribute("href", "/jobs/j1");
  });

  it("adds the application to the profile cache and goes to the job page", () => {
    renderPage();
    fireEvent.click(screen.getByText("send"));

    const update = vi.mocked(mutate).mock.calls[0][1] as (c: unknown) => { profile: { applications: unknown[] } };
    expect(update({ profile: { applications: [] } }).profile.applications).toEqual([
      { all_jobs_id: "j1", status: "submitted" },
    ]);
    expect(push).toHaveBeenCalledWith("/jobs/j1");
  });

  it("shows the screening card in place of the form, and 'Do it later' goes on", () => {
    invite = INVITE;
    renderPage();
    fireEvent.click(screen.getByText("send"));

    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText("send")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start now/i })).toHaveAttribute(
      "href",
      `/interview/screening/${INVITE.id}`,
    );
    fireEvent.click(screen.getByRole("button", { name: /do it later/i }));
    expect(push).toHaveBeenCalledWith("/jobs/j1");
  });
});
