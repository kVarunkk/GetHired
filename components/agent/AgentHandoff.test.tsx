import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH, takePendingPrompt } from "@/helpers/agent/prompt-draft";
import { jobPostHandoffPrompt, outreachHandoffPrompt } from "@/helpers/agent/handoff-prompts";
import AgentHandoff from "./AgentHandoff";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AgentHandoff", () => {
  it("opens the agent with the prompt, keeps it for after login and closes the dialog", () => {
    const onHandoff = vi.fn();
    const outer = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      // The dialog's own form must not submit when this one does.
      <div onSubmit={outer}>
        <AgentHandoff
          label="Or describe it"
          placeholder="…"
          basePath={COMPANY_AGENT_PATH}
          toPrompt={(text) => jobPostHandoffPrompt(text)}
          onHandoff={onHandoff}
        />
      </div>,
    );

    const ask = screen.getByRole("button", { name: "Open in the assistant" });
    expect(ask).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Describe it for the assistant"), { target: { value: " Go engineer " } });
    fireEvent.click(ask);

    const prompt = jobPostHandoffPrompt("Go engineer");
    expect(push).toHaveBeenCalledWith(agentPromptHref(prompt, COMPANY_AGENT_PATH));
    expect(onHandoff).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    expect(takePendingPrompt()).toBe(prompt);
  });

  it("wakes the sparkle up while the user is typing", () => {
    render(<AgentHandoff label="Or describe it" placeholder="…" basePath={COMPANY_AGENT_PATH} toPrompt={(text) => text} />);

    const mark = screen.getByTestId("agent-handoff-mark");
    expect(mark).not.toHaveAttribute("data-typing");
    expect(mark.querySelector("svg")).not.toHaveClass("agent-spark");
    expect(screen.getByRole("form", { name: "Or describe it" })).toHaveClass("agent-glow");

    const input = screen.getByLabelText("Describe it for the assistant");
    fireEvent.change(input, { target: { value: "Go engineer" } });
    expect(mark).toHaveAttribute("data-typing", "true");
    expect(mark.querySelector("svg")).toHaveClass("agent-spark");

    fireEvent.change(input, { target: { value: "   " } });
    expect(mark).not.toHaveAttribute("data-typing");
  });
});

describe("handoff prompts", () => {
  it("name what the dialog is about by id", () => {
    expect(jobPostHandoffPrompt(" Make it remote ", { id: "j1", title: "Backend" })).toBe(
      'Update my job post "Backend" (job post j1): Make it remote',
    );
    expect(outreachHandoffPrompt("Keep it short", "c1", { id: "j1", title: "Backend" })).toBe(
      'Write an outreach message to candidate c1 about my job post "Backend" (job post j1). Keep it short',
    );
    expect(outreachHandoffPrompt("Keep it short", "c1")).toBe("Write an outreach message to candidate c1. Keep it short");
  });
});
