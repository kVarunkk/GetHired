import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import JobInterviewPanel from "./JobInterviewPanel";
import type { InterviewFunnel } from "@/helpers/interview/screening/funnel";

vi.mock("./InterviewConfigSection", () => ({
  default: ({ canEdit }: { canEdit: boolean }) => <p>config {canEdit ? "editable" : "read-only"}</p>,
}));

const FUNNEL: InterviewFunnel = {
  invited: 12,
  waiting: 4,
  inProgress: 1,
  completed: 5,
  expired: 1,
  declined: 1,
  avgScore: 3.6,
};
const CONFIG = {
  enabled: true,
  invite_rule: "fit_threshold" as const,
  fit_threshold: 70,
  questions: [],
  competencies: [{ name: "APIs", description: "" }],
  duration_minutes: 15 as const,
  deadline_days: 5,
  language: "en" as const,
};

const renderPanel = (props: Partial<Parameters<typeof JobInterviewPanel>[0]> = {}) =>
  render(
    <JobInterviewPanel
      jobPostId="j1"
      config={CONFIG}
      funnel={FUNNEL}
      uninvitedAboveThreshold={0}
      canEdit
      {...props}
    />,
  );

describe("JobInterviewPanel (SIT-061)", () => {
  it("shows each funnel count and the average score", () => {
    renderPanel();
    const funnel = within(screen.getByLabelText("Interview funnel"));
    expect(funnel.getByText("Invited").nextSibling).toHaveTextContent("12");
    expect(funnel.getByText("Waiting").nextSibling).toHaveTextContent("4");
    expect(funnel.getByText("Completed").nextSibling).toHaveTextContent("5");
    expect(funnel.getByText("Average score").nextSibling).toHaveTextContent("3.6 / 5");
  });

  it("shows a dash without scored reports", () => {
    renderPanel({ funnel: { ...FUNNEL, avgScore: null } });
    expect(screen.getByText("Average score").nextSibling).toHaveTextContent("–");
  });

  it("has no funnel before the interview was ever used", () => {
    renderPanel({ config: null, funnel: { ...FUNNEL, invited: 0 } });
    expect(screen.queryByLabelText("Interview funnel")).not.toBeInTheDocument();
    expect(screen.getByText("config editable")).toBeInTheDocument();
  });

  it("warns about applicants above the bar who weren't invited", () => {
    renderPanel({ uninvitedAboveThreshold: 2 });
    expect(screen.getByRole("status")).toHaveTextContent("2 applicants scored above the bar");
  });

  it("passes read-only through", () => {
    renderPanel({ canEdit: false });
    expect(screen.getByText("config read-only")).toBeInTheDocument();
  });
});
