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
