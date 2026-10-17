import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, takePendingPrompt } from "@/helpers/agent/prompt-draft";
import AskApplicantAgent from "./AskApplicantAgent";
import { APPLICANT_STARTERS } from "./roles";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AskApplicantAgent", () => {
  it("opens the applicant agent with the question", () => {
    render(<AskApplicantAgent />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), {
      target: { value: "  Remote React jobs " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(agentPromptHref("Remote React jobs"));
    expect(agentPromptHref("x")).toMatch(/^\/agent\?/);
    expect(takePendingPrompt()).toBe("Remote React jobs");
  });

  it("links each applicant starter to the applicant agent", () => {
    render(<AskApplicantAgent />);
    for (const prompt of APPLICANT_STARTERS) {
      expect(screen.getByRole("link", { name: prompt })).toHaveAttribute("href", agentPromptHref(prompt));
    }
  });
});
