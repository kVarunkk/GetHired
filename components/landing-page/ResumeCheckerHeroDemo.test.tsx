import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumeCheckerHeroDemo, { DEMO_ANALYSIS_MS } from "./ResumeCheckerHeroDemo";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe("ResumeCheckerHeroDemo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the review page's analysis next to the parsed resume", () => {
    render(<ResumeCheckerHeroDemo />);

    expect(screen.getByText("Analysis Pane")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Overall Strategy")).toBeInTheDocument();
    expect(screen.getByText(/Led the React and TypeScript component library/)).toBeInTheDocument();
    // The resume line the suggestion rewrites, in the original and in the mirror.
    expect(screen.getAllByText(/Worked on the company's React component library/)).toHaveLength(2);
  });

  it("highlights the resume line a suggestion rewrites on hover", () => {
    render(<ResumeCheckerHeroDemo />);

    const card = screen.getByText(/Led the React and TypeScript component library/).closest("div.rounded-xl")!;
    fireEvent.mouseEnter(card);
    expect(document.getElementById("bullet-demo-b1")).toHaveClass("bg-brandSoft");

    fireEvent.mouseLeave(card);
    expect(document.getElementById("bullet-demo-b1")).not.toHaveClass("bg-brandSoft");
  });

  it("has nothing to apply", () => {
    render(<ResumeCheckerHeroDemo />);

    expect(screen.getAllByRole("button", { name: "Copy" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply all/ })).not.toBeInTheDocument();
  });

  it("replays the analysis when Tailor Resume is pressed", () => {
    render(<ResumeCheckerHeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Tailor Resume" }));
    expect(screen.getByText("Analyzing your Resume")).toBeInTheDocument();
    expect(screen.queryByText("82")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(DEMO_ANALYSIS_MS));
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tailor Resume" })).toBeEnabled();
  });

  it("opens the job description and needs one to tailor", () => {
    render(<ResumeCheckerHeroDemo />);

    fireEvent.click(screen.getByRole("button", { name: "Expand job description" }));
    const jd = screen.getByLabelText("Target Job Description");
    expect((jd as HTMLTextAreaElement).value).toContain("Senior Frontend Engineer");

    fireEvent.change(jd, { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Tailor Resume" })).toBeDisabled();
  });

  it("never calls the network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<ResumeCheckerHeroDemo />);
    fireEvent.click(screen.getByRole("button", { name: "Tailor Resume" }));
    act(() => vi.advanceTimersByTime(DEMO_ANALYSIS_MS));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
