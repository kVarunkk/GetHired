import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText("AI interview submitted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transcript" })).toHaveAttribute("href", "/interview/screening/b");
  });

  it("renders nothing without an interview to show", () => {
    const { container } = render(<MyScreeningInterviews now={NOW} interviews={[row("a", { status: "expired" })]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
