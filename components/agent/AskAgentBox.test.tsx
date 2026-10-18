import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, takePendingPrompt } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { TYPEWRITER } from "./AskAgentBox";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const BASE = "/company/agent";
const SUGGESTIONS = [
  { label: "Who applied?", prompt: "List the applicants" },
  { label: "Draft outreach", prompt: "Draft an outreach message" },
];

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => {
  sessionStorage.clear();
  vi.useRealTimers();
});

function renderBox(toPrompt?: (question: string) => string) {
  return render(
    <AskAgentBox
      title="Ask the assistant"
      placeholder="Ask anything"
      basePath={BASE}
      suggestions={SUGGESTIONS}
      toPrompt={toPrompt}
    />,
  );
}

const box = () => screen.getByLabelText("Question for the assistant");

/** Runs the next `count` typewriter timers, letting each step's effect re-arm. */
function steps(count: number) {
  for (let i = 0; i < count; i++) {
    act(() => {
      vi.advanceTimersToNextTimer();
    });
  }
}

const FIRST = SUGGESTIONS[0].label;

describe("AskAgentBox", () => {
  it("opens the agent with the question through toPrompt", () => {
    renderBox((question) => `About the job: ${question.trim()}`);
    fireEvent.change(box(), { target: { value: " Who is a fit? " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    const prompt = "About the job: Who is a fit?";
    expect(push).toHaveBeenCalledWith(agentPromptHref(prompt, BASE));
    expect(takePendingPrompt()).toBe(prompt);
  });

  it("sends on Enter but not on Shift+Enter, and not when empty", () => {
    renderBox();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();

    fireEvent.change(box(), { target: { value: "Remote roles" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(push).not.toHaveBeenCalled();

    fireEvent.keyDown(box(), { key: "Enter" });
    expect(push).toHaveBeenCalledWith(agentPromptHref("Remote roles", BASE));
  });

  it("links each suggestion to the agent and saves its prompt", () => {
    renderBox();
    for (const { label, prompt } of SUGGESTIONS) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", agentPromptHref(prompt, BASE));
    }
    fireEvent.click(screen.getByRole("link", { name: "Draft outreach" }));
    expect(takePendingPrompt()).toBe("Draft an outreach message");
  });

  it("types the suggestions into the placeholder, one after another", () => {
    vi.useFakeTimers();
    renderBox();
    expect(box()).toHaveAttribute("placeholder", "Ask anything");

    act(() => {
      vi.advanceTimersByTime(TYPEWRITER.start - 1);
    });
    expect(box()).toHaveAttribute("placeholder", "Ask anything");

    steps(1);
    expect(box()).toHaveAttribute("placeholder", "W");

    steps(FIRST.length - 1);
    expect(box()).toHaveAttribute("placeholder", FIRST);

    // The hold keeps the full label, then it's erased.
    steps(1);
    expect(box()).toHaveAttribute("placeholder", FIRST);
    steps(FIRST.length);
    expect(box()).toHaveAttribute("placeholder", "");

    steps(5);
    expect(box()).toHaveAttribute("placeholder", "Draft");
  });

  it("shows the static placeholder while focused and resumes on blur", () => {
    vi.useFakeTimers();
    renderBox();
    act(() => {
      vi.advanceTimersByTime(TYPEWRITER.start);
    });
    steps(2);
    expect(box()).toHaveAttribute("placeholder", "Who");

    fireEvent.focus(box());
    expect(box()).toHaveAttribute("placeholder", "Ask anything");
    steps(5);
    expect(box()).toHaveAttribute("placeholder", "Ask anything");

    fireEvent.blur(box());
    expect(box()).toHaveAttribute("placeholder", "Who");
    steps(1);
    expect(box()).toHaveAttribute("placeholder", "Who ");
  });

  it("stops the examples for good once the user types", () => {
    vi.useFakeTimers();
    renderBox();
    fireEvent.change(box(), { target: { value: "x" } });
    fireEvent.change(box(), { target: { value: "" } });
    steps(FIRST.length);
    expect(box()).toHaveAttribute("placeholder", "Ask anything");
  });
});
