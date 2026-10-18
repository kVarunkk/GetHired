import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentAboutQuestionSets, {
  questionSetQuestionPrompt,
  questionSetSuggestions,
} from "./AskAgentAboutQuestionSets";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const SET = { id: "c0000000-0000-4000-8000-000000000001", name: "Engineering" };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AskAgentAboutQuestionSets", () => {
  it("puts the set id in every prompt about one set, so the agent can find it", () => {
    expect(questionSetQuestionPrompt(SET, "  Add a phone field ")).toBe(
      'About my question set "Engineering" (question set c0000000-0000-4000-8000-000000000001): Add a phone field',
    );
    for (const s of questionSetSuggestions(SET, true)) expect(s.prompt, s.label).toContain(`(question set ${SET.id})`);
  });

  it("hides the prompts that change sets without question_sets.manage", () => {
    expect(questionSetSuggestions(SET, false).map((s) => s.label)).toEqual(["Apply to a job", "Check for fairness"]);
    expect(questionSetSuggestions(undefined, false).map((s) => s.label)).toEqual(["Apply a set to a job"]);
    expect(questionSetSuggestions(undefined, true).map((s) => s.label)).toContain("Draft a new set");
  });

  it("opens the company agent with the question", () => {
    render(<AskAgentAboutQuestionSets canManage />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Make a sales set" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(
      agentPromptHref(questionSetQuestionPrompt(undefined, "Make a sales set"), COMPANY_AGENT_PATH),
    );
  });
});
