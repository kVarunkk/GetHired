import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InterviewReport from "./InterviewReport";
import type { ApplicationInterviewView } from "@/helpers/interview/screening/application-interview";

const TURNS = [
  { turn_id: 0, timestamp: 0, user: "", assistant: "Hi, tell me about your API work.", interrupted: false },
  { turn_id: 1, timestamp: 1, user: "I design REST APIs with versioning.", assistant: "How do you test them?", interrupted: false },
  { turn_id: 2, timestamp: 2, user: "Contract tests in CI.", assistant: "Thanks, that's all.", interrupted: false },
];

const view = (overrides: Partial<ApplicationInterviewView> = {}): ApplicationInterviewView => ({
  id: "ai1",
  status: "completed",
  jobPostId: "j1",
  deadlineAt: "2026-10-24T00:00:00.000Z",
  attemptsUsed: 2,
  maxAttempts: 2,
  attemptGranted: false,
  deadlineExtensions: 0,
  accommodationRequest: null,
  invitedVia: "fit_threshold",
  completedAt: "2026-10-20T00:00:00.000Z",
  createdAt: "2026-10-19T00:00:00.000Z",
  durationMinutes: 15,
  competencies: [
    { name: "APIs", description: "Designs clean APIs." },
    { name: "Testing", description: "Tests well." },
  ],
  questions: ["Why us?"],
  attempts: [
    { id: "s1", startedAt: "2026-10-19T10:00:00Z", endedAt: "2026-10-19T10:01:00Z", endReason: "client_disconnect", durationSeconds: 45, status: "ineligible", turns: [] },
    { id: "s2", startedAt: "2026-10-20T10:00:00Z", endedAt: "2026-10-20T10:13:00Z", endReason: "completed", durationSeconds: 780, status: "completed", turns: TURNS },
  ],
  report: {
    status: "completed",
    sessionId: "s2",
    result: {
      competencies: [
        { name: "APIs", score: 4, rationale: "Explains versioning clearly.", evidence: [{ turnId: 1, quote: "I design REST APIs with versioning." }] },
        { name: "Testing", score: null, rationale: "Not assessed.", evidence: [] },
      ],
      questionCoverage: [{ question: "Why us?", asked: false, turnId: null }],
      summary: "Strong API background.",
      strengths: ["API design"],
      concerns: ["Little on testing depth"],
      followUpQuestions: ["How do you deprecate endpoints?"],
      overallScore: 4,
    },
  },
  ...overrides,
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("InterviewReport (SIT-063, SI-REQ-031/033)", () => {
  it("labels the report as AI-generated and a screening signal only", () => {
    render(<InterviewReport interview={view()} />);
    expect(screen.getByText(/ai-generated, verify before deciding/i)).toBeInTheDocument();
    expect(screen.getByText(/screening signal only/i)).toBeInTheDocument();
  });

  it("shows the overall score and each competency, with Not assessed for null", () => {
    render(<InterviewReport interview={view()} />);
    expect(screen.getByText("4.0 / 5")).toBeInTheDocument();
    const apis = screen.getByRole("region", { name: "APIs" });
    expect(within(apis).getByText("4 / 5")).toBeInTheDocument();
    expect(within(apis).getByText("Explains versioning clearly.")).toBeInTheDocument();
    const testing = screen.getByRole("region", { name: "Testing" });
    expect(within(testing).getByText("Not assessed")).toBeInTheDocument();
  });

  it("shows the attempt history with end reasons and durations", () => {
    render(<InterviewReport interview={view()} />);
    const history = within(screen.getByRole("list", { name: "Attempts" }));
    expect(history.getByText(/connection dropped/i)).toBeInTheDocument();
    expect(history.getByText(/45s/)).toBeInTheDocument();
    expect(history.getByText(/interviewer finished/i)).toBeInTheDocument();
    expect(history.getByText(/13m 0s/)).toBeInTheDocument();
  });

  it("shows coverage, summary, strengths, concerns and follow-ups", () => {
    render(<InterviewReport interview={view()} />);
    expect(screen.getByText("Why us?")).toBeInTheDocument();
    expect(screen.getByText("Not asked")).toBeInTheDocument();
    expect(screen.getByText("Strong API background.")).toBeInTheDocument();
    expect(screen.getByText("API design")).toBeInTheDocument();
    expect(screen.getByText("Little on testing depth")).toBeInTheDocument();
    expect(screen.getByText("How do you deprecate endpoints?")).toBeInTheDocument();
  });

  it("scrolls the transcript to the quoted turn", async () => {
    render(<InterviewReport interview={view()} />);
    await userEvent.click(screen.getByRole("button", { name: /I design REST APIs with versioning/ }));
    const turn = document.getElementById("interview-turn-1");
    expect(turn).not.toBeNull();
    expect(turn!.scrollIntoView).toHaveBeenCalled();
  });

  it("shows the full transcript of the scored session", () => {
    render(<InterviewReport interview={view()} />);
    const transcript = within(screen.getByRole("region", { name: "Transcript" }));
    expect(transcript.getByText("Contract tests in CI.")).toBeInTheDocument();
    expect(transcript.getByText("Hi, tell me about your API work.")).toBeInTheDocument();
  });

  it("never shows a recommendation", () => {
    const { container } = render(<InterviewReport interview={view()} />);
    expect(container.textContent).not.toMatch(/recommend|hire|reject/i);
  });

  it("shows Interview incomplete (technical) when completed without a report", () => {
    render(
      <InterviewReport
        interview={view({
          report: null,
          attempts: [view().attempts[0], { ...view().attempts[0], id: "s3", endReason: "error" }],
        })}
      />,
    );
    expect(screen.getByText("Interview incomplete (technical)")).toBeInTheDocument();
  });

  it("shows the report being prepared", () => {
    render(<InterviewReport interview={view({ report: { status: "processing", sessionId: "s2", result: null } })} />);
    expect(screen.getByText(/preparing the report/i)).toBeInTheDocument();
  });

  it.each([
    ["invited", /waiting for the applicant/i],
    ["in_progress", /taking the interview now/i],
    ["expired", /deadline passed/i],
    ["declined", /declined the interview/i],
    ["cancelled", /cancelled/i],
  ])("shows the %s state", (status, text) => {
    render(<InterviewReport interview={view({ status, report: null, attempts: [] })} />);
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it("shows the accommodation request while paused", () => {
    render(
      <InterviewReport
        interview={view({ status: "paused", report: null, attempts: [], accommodationRequest: "I have a stutter." })}
      />,
    );
    expect(screen.getByText("I have a stutter.")).toBeInTheDocument();
  });
});
