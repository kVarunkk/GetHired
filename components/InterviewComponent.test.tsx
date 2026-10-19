/**
 * Characterisation tests for InterviewComponent in practice mode (SIT-003).
 * They pin the retake button, the analysis link and the transcript before the
 * component gains a screening mode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import InterviewComponent from "./InterviewComponent";
import { useVoiceAgent } from "@/hooks/useVoiceAgent";

vi.mock("@/hooks/useVoiceAgent", () => ({ useVoiceAgent: vi.fn() }));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn(), success: vi.fn() } }));
vi.mock("./ModifiedLink", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

type Props = ComponentProps<typeof InterviewComponent>;
type Agent = ReturnType<typeof useVoiceAgent>;

const INTERVIEW_ID = "int-1";

const interview = (overrides: Partial<Props["interview"]> = {}) =>
  ({
    id: INTERVIEW_ID,
    name: "Stripe backend practice",
    job_id: "job-1",
    resume_id: "res-1",
    turns: [],
    all_jobs: { job_name: "Backend Engineer" },
    resumes: { name: "Main resume" },
    interview_sessions: [
      {
        id: "s-1",
        turns: [
          { turn_id: 1, user: "", assistant: "Tell me about yourself." },
          { turn_id: 2, user: "I build payment APIs.", assistant: "Which stack?" },
        ],
      },
    ],
    ...overrides,
  }) as Props["interview"];

const agent = (overrides: Partial<Agent> = {}): Agent => ({
  status: "idle",
  errorMessage: null,
  lines: [],
  analysisSession: null,
  start: vi.fn(),
  stop: vi.fn(),
  ...overrides,
});

const renderComponent = (props: Partial<Props> = {}) =>
  render(
    <InterviewComponent
      interviewId={INTERVIEW_ID}
      interview={interview()}
      sessionHistory={[]}
      {...props}
    />,
  );

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(useVoiceAgent).mockReturnValue(agent());
});

describe("InterviewComponent (practice)", () => {
  it("starts the interview from the idle state", async () => {
    const start = vi.fn();
    vi.mocked(useVoiceAgent).mockReturnValue(agent({ start }));
    renderComponent();

    await userEvent.click(screen.getByRole("button", { name: /start interview/i }));

    expect(useVoiceAgent).toHaveBeenCalledWith(INTERVIEW_ID);
    expect(start).toHaveBeenCalled();
  });

  it.each(["stopped", "error"] as const)("offers a retake once %s", (status) => {
    vi.mocked(useVoiceAgent).mockReturnValue(agent({ status }));
    renderComponent();

    expect(screen.getByRole("button", { name: /restart interview/i })).toBeInTheDocument();
  });

  it("shows End Conversation while live, and it stops the interview", async () => {
    const stop = vi.fn();
    vi.mocked(useVoiceAgent).mockReturnValue(agent({ status: "live", stop }));
    renderComponent();

    expect(screen.queryByRole("button", { name: /start interview/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /end conversation/i }));

    expect(stop).toHaveBeenCalled();
  });

  it("links to the analysis of the latest analysed session", () => {
    renderComponent({
      sessionHistory: [
        { id: "s-0", started_at: "2026-10-01T10:00:00Z", status: "completed", analysisStatus: "completed" },
        { id: "s-1", started_at: "2026-10-02T10:00:00Z", status: "completed", analysisStatus: "pending" },
      ],
    });

    expect(screen.getByRole("link", { name: "Analysis" })).toHaveAttribute(
      "href",
      `/interview/${INTERVIEW_ID}/analysis/s-1`,
    );
  });

  it("links to the session the hook just finalized", () => {
    vi.mocked(useVoiceAgent).mockReturnValue(
      agent({ status: "stopped", analysisSession: { sessionId: "s-new", status: "completed" } }),
    );
    renderComponent();

    expect(screen.getByRole("link", { name: "Analysis" })).toHaveAttribute(
      "href",
      `/interview/${INTERVIEW_ID}/analysis/s-new`,
    );
  });

  it("has no analysis link before any session is analysed", () => {
    renderComponent();

    expect(screen.queryByRole("link", { name: "Analysis" })).not.toBeInTheDocument();
  });

  it("renders the latest session's saved transcript when not active", () => {
    renderComponent({
      sessionHistory: [
        { id: "s-1", started_at: "2026-10-02T10:00:00Z", status: "completed", analysisStatus: null },
      ],
    });

    expect(screen.getByText("Historical Transcript")).toBeInTheDocument();
    expect(screen.getByText("Tell me about yourself.")).toBeInTheDocument();
    expect(screen.getByText("I build payment APIs.")).toBeInTheDocument();
    expect(screen.getByText("Which stack?")).toBeInTheDocument();
  });

  it("renders the streamed lines while live", () => {
    vi.mocked(useVoiceAgent).mockReturnValue(
      agent({
        status: "live",
        lines: [
          { role: "assistant", turn_id: "1", text: "Hello, ready?", streaming: false },
          { role: "user", turn_id: "1", text: "Yes", streaming: true },
        ],
      }),
    );
    renderComponent({
      sessionHistory: [
        { id: "s-1", started_at: "2026-10-02T10:00:00Z", status: "completed", analysisStatus: null },
      ],
    });

    expect(screen.getByText("Live Transcript")).toBeInTheDocument();
    expect(screen.getByText("Hello, ready?")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.queryByText("Tell me about yourself.")).not.toBeInTheDocument();
  });

  it("shows the five-minute timer", () => {
    renderComponent();

    expect(screen.getByText("05:00")).toBeInTheDocument();
  });
});

describe("InterviewComponent (screening, SIT-052)", () => {
  const screening = (overrides: Partial<NonNullable<Props["screening"]>> = {}): NonNullable<Props["screening"]> => ({
    applicationInterviewId: "ai-1",
    companyName: "Acme",
    jobTitle: "Backend Engineer",
    durationMinutes: 15,
    status: "invited",
    attemptsUsed: 0,
    maxAttempts: 2,
    ...overrides,
  });
  const renderScreening = (overrides: Partial<NonNullable<Props["screening"]>> = {}, props: Partial<Props> = {}) =>
    renderComponent({ screening: screening(overrides), ...props });

  it("starts in screening mode with the application interview id", async () => {
    const start = vi.fn();
    vi.mocked(useVoiceAgent).mockReturnValue(agent({ start }));
    renderScreening();

    await userEvent.click(screen.getByRole("button", { name: /start interview/i }));

    expect(useVoiceAgent).toHaveBeenCalledWith(INTERVIEW_ID, { mode: "screening", applicationInterviewId: "ai-1" });
    expect(start).toHaveBeenCalled();
  });

  it("shows a countdown of the interview's length, and no analysis link or retake", () => {
    renderScreening({}, {
      sessionHistory: [
        { id: "s-1", started_at: "2026-10-02T10:00:00Z", status: "completed", analysisStatus: "completed" },
      ],
    });

    expect(screen.getByText("15:00")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Analysis" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart interview/i })).not.toBeInTheDocument();
  });

  it("shows Submitted and the transcript once the interview is completed", () => {
    renderScreening(
      { status: "completed", attemptsUsed: 1 },
      { sessionHistory: [{ id: "s-1", started_at: "2026-10-02T10:00:00Z", status: "completed", analysisStatus: null }] },
    );

    expect(screen.getByText("Interview submitted", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("Your interview has been submitted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /find jobs/i })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: /view applications/i })).toHaveAttribute("href", "/jobs?tab=applied");
    expect(screen.getByText("I build payment APIs.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start|restart|try again/i })).not.toBeInTheDocument();
  });

  it("tells the page when an attempt ends, and shows saving while it checks", () => {
    const onEnded = vi.fn();
    vi.mocked(useVoiceAgent).mockReturnValue(agent({ status: "live" }));
    const view = renderScreening({ status: "invited", onEnded });
    expect(onEnded).not.toHaveBeenCalled();

    vi.mocked(useVoiceAgent).mockReturnValue(agent({ status: "stopped" }));
    view.rerender(
      <InterviewComponent
        interviewId={INTERVIEW_ID}
        interview={interview()}
        sessionHistory={[]}
        screening={screening({ status: "invited", onEnded, checking: true })}
      />,
    );

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/saving your interview/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start|try again/i })).not.toBeInTheDocument();
  });

  it("shows saving while the server still has the attempt in progress", () => {
    renderScreening({ status: "in_progress", attemptsUsed: 1 });
    expect(screen.getByText(/saving your interview/i)).toBeInTheDocument();
  });

  it("shows this visit's transcript over an older saved attempt", () => {
    vi.mocked(useVoiceAgent).mockReturnValue(
      agent({ status: "stopped", lines: [{ role: "user", turn_id: "1", text: "Second try answer" }] }),
    );
    renderScreening(
      { status: "completed", attemptsUsed: 2 },
      { sessionHistory: [{ id: "s-1", started_at: "2026-10-02T10:00:00Z", status: "ineligible", analysisStatus: null }] },
    );
    expect(screen.getByText("Second try answer")).toBeInTheDocument();
    expect(screen.queryByText("I build payment APIs.")).not.toBeInTheDocument();
  });

  it("offers the remaining attempt after a dropped connection", async () => {
    const start = vi.fn();
    vi.mocked(useVoiceAgent).mockReturnValue(agent({ status: "stopped", start }));
    renderScreening({ status: "invited", attemptsUsed: 1 });

    expect(screen.getByText("Your connection dropped. You have one more attempt.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(start).toHaveBeenCalled();
  });

  it("shows the busy message with a retry", () => {
    vi.mocked(useVoiceAgent).mockReturnValue(
      agent({ status: "error", errorMessage: "Our interview server is busy. Please try again in a minute." }),
    );
    renderScreening();

    expect(screen.getAllByText("Our interview server is busy. Please try again in a minute.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
