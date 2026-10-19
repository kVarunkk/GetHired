import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentAboutInterview, { interviewQuestionPrompt, interviewSuggestions } from "./AskAgentAboutInterview";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Founding Backend Engineer" };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

describe("AskAgentAboutInterview (SIT-072)", () => {
  it("puts the job post's title and id in every prompt", () => {
    for (const { prompt } of interviewSuggestions(JOB, { canManage: true })) {
      expect(prompt).toContain(`"${JOB.title}" (job post ${JOB.id})`);
    }
    expect(interviewQuestionPrompt(JOB, "  Screen for Go ")).toBe(
      `About the AI screening interview for my job post "${JOB.title}" (job post ${JOB.id}): Screen for Go`,
    );
  });

  it("offers the set-up chip only with edit rights", () => {
    expect(interviewSuggestions(JOB, { canManage: true }).map((s) => s.label)).toEqual([
      "Set up the interview",
      "How is it going?",
      "Compare candidates",
    ]);
    expect(interviewSuggestions(JOB, { canManage: false }).map((s) => s.label)).toEqual([
      "How is it going?",
      "Compare candidates",
    ]);
  });

  it("opens the company agent with the question", () => {
    render(<AskAgentAboutInterview job={JOB} canManage />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Make it 10 minutes" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(push).toHaveBeenCalledWith(
      agentPromptHref(interviewQuestionPrompt(JOB, "Make it 10 minutes"), COMPANY_AGENT_PATH),
    );
  });
});
