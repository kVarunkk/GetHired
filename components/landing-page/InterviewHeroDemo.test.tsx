import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InterviewHeroDemo, { DEMO_CONNECT_MS } from "./InterviewHeroDemo";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// The voice hook must never run: the demo drives the view itself.
vi.mock("@/hooks/useVoiceAgent", () => ({
  useVoiceAgent: () => {
    throw new Error("useVoiceAgent called");
  },
}));

describe("InterviewHeroDemo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the interview page with the saved transcript before starting", () => {
    render(<InterviewHeroDemo />);

    expect(screen.getByText("Lumen Labs frontend practice")).toBeInTheDocument();
    expect(screen.getByText("Senior Frontend Engineer, Lumen Labs")).toBeInTheDocument();
    expect(screen.getByText("Ready to start interview")).toBeInTheDocument();
    expect(screen.getByText("Historical Transcript")).toBeInTheDocument();
    expect(screen.getByText(/tell me about a component library/)).toBeInTheDocument();
    // No links out to a job, resume, analysis or back to a list that doesn't exist.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("connects, goes live and streams the scripted conversation", () => {
    render(<InterviewHeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: /start interview/i }));
    expect(screen.getByText("Establishing connection...")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(DEMO_CONNECT_MS));
    expect(screen.getByText("AI Interviewer is active")).toBeInTheDocument();
    expect(screen.getByText("Live Transcript")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText(/Walk me through a time you improved page performance/)).toBeInTheDocument();
    expect(screen.getByText(/brought it to 1.8 seconds/)).toBeInTheDocument();
    expect(screen.getByText("04:40")).toBeInTheDocument();
  });

  it("ends the conversation and keeps what was said", () => {
    render(<InterviewHeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: /start interview/i }));
    act(() => vi.advanceTimersByTime(DEMO_CONNECT_MS + 10_000));
    fireEvent.click(screen.getByRole("button", { name: /end conversation/i }));

    expect(screen.getByText("Interview Concluded")).toBeInTheDocument();
    expect(screen.getByText(/Walk me through a time you improved page performance/)).toBeInTheDocument();
    expect(screen.queryByText(/tell me about a component library/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart interview/i })).toBeInTheDocument();

    // Nothing more streams in after it ends.
    const text = document.body.textContent;
    act(() => vi.advanceTimersByTime(30_000));
    expect(document.body.textContent).toBe(text);
  });

  it("never calls the network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<InterviewHeroDemo />);
    fireEvent.click(screen.getByRole("button", { name: /start interview/i }));
    act(() => vi.advanceTimersByTime(30_000));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
