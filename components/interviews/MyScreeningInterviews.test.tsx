import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/app/actions/interviews/dismiss-screening-interview", () => ({
  dismissScreeningInterviewAction: vi.fn(),
}));

import MyScreeningInterviews from "./MyScreeningInterviews";
import type { MyScreeningInterview } from "@/helpers/interview/screening/my-interviews";

const NOW = new Date("2026-10-19T12:00:00.000Z");
const row = (id: string, overrides: Partial<MyScreeningInterview> = {}) =>
  ({
    id,
    status: "invited",
    attempts_used: 0,
    max_attempts: 2,
    deadline_at: "2026-10-22T13:00:00.000Z",
    completed_at: null,
    created_at: "2026-10-01T12:00:00.000Z",
    paused_at: null,
    dismissed: false,
    company_name: "Acme",
    job_title: `Role ${id}`,
    ...overrides,
  }) as MyScreeningInterview;

describe("MyScreeningInterviews (SIT-054)", () => {
  it("shows each open interview's status, deadline and CTA", () => {
    render(
      <MyScreeningInterviews
        now={NOW}
        interviews={[row("a"), row("b", { status: "completed", completed_at: "2026-10-18T00:00:00.000Z" })]}
      />,
    );

    expect(screen.getByText("AI interview due in 3 days")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start interview" })).toHaveAttribute("href", "/interview/screening/a");
    expect(screen.getByText("AI interview submitted yesterday")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transcript" })).toHaveAttribute("href", "/interview/screening/b");
  });

  it("offers to remove only interviews the applicant doesn't still have to take", () => {
    render(
      <MyScreeningInterviews
        now={NOW}
        interviews={[row("a"), row("b", { status: "paused", paused_at: "2026-10-14T12:00:00.000Z" })]}
      />,
    );

    expect(screen.getByText("Alternative format requested 5 days ago: waiting for Acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Role b from dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Role a from dashboard" })).not.toBeInTheDocument();
  });

  it("renders nothing without an interview to show", () => {
    const { container } = render(<MyScreeningInterviews now={NOW} interviews={[row("a", { status: "expired" })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links to every AI interview on the Interviews page", () => {
    render(<MyScreeningInterviews now={NOW} interviews={[row("a")]} />);
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/interview?tab=companies");
  });

  it("on the Interviews page lists every interview, closed ones too, newest first, without remove buttons", () => {
    render(
      <MyScreeningInterviews
        now={NOW}
        variant="all"
        interviews={[
          row("old", { status: "expired", created_at: "2026-09-01T12:00:00.000Z" }),
          row("new", { status: "paused", created_at: "2026-10-10T12:00:00.000Z" }),
        ]}
      />,
    );

    const titles = screen.getAllByText(/^Role /).map((el) => el.textContent);
    expect(titles).toEqual(["Role new", "Role old"]);
    expect(screen.getByText("AI interview expired: the deadline passed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all" })).not.toBeInTheDocument();
  });

  it("on the Interviews page says where invites will show when there are none", () => {
    render(<MyScreeningInterviews now={NOW} variant="all" interviews={[]} />);
    expect(screen.getByText(/invites you to an AI interview, it shows up here/)).toBeInTheDocument();
  });
});
