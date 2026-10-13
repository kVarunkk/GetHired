import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, takePendingPrompt } from "@/helpers/agent/prompt-draft";
import AskAgentAboutJob, { jobQuestionPrompt, jobSuggestions } from "./AskAgentAboutJob";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const JOB = { id: "j1", job_name: "Frontend Engineer", company_name: "Acme" };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AskAgentAboutJob", () => {
  it("puts the job's link in every prompt, so the agent gets its id", () => {
    expect(jobQuestionPrompt(JOB, "  Is it remote? ")).toBe(
      "About the Frontend Engineer role at Acme (/jobs/j1): Is it remote?",
    );
    for (const { prompt } of jobSuggestions(JOB)) expect(prompt).toContain("(/jobs/j1)");
  });

  it("leaves out a missing company", () => {
    expect(jobQuestionPrompt({ ...JOB, company_name: null }, "Hi")).toBe(
      "About the Frontend Engineer role (/jobs/j1): Hi",
    );
  });

  it("opens the agent with the question and saves it for a detour through login", () => {
    render(<AskAgentAboutJob job={JOB} />);
    const prompt = jobQuestionPrompt(JOB, "Am I a fit?");

    fireEvent.change(screen.getByLabelText("Question about this job"), {
      target: { value: "Am I a fit?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(agentPromptHref(prompt));
    expect(takePendingPrompt()).toBe(prompt);
  });

  it("doesn't send an empty question", () => {
    render(<AskAgentAboutJob job={JOB} />);

    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("links each suggestion to the agent with its prompt", () => {
    render(<AskAgentAboutJob job={JOB} />);

    for (const { label, prompt } of jobSuggestions(JOB)) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", agentPromptHref(prompt));
      fireEvent.click(link);
      expect(takePendingPrompt()).toBe(prompt);
    }
  });
});
