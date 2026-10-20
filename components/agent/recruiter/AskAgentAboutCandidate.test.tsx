import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentAboutCandidate, { candidateQuestionPrompt, candidateSuggestions } from "./AskAgentAboutCandidate";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const CANDIDATE = { id: "a0000000-0000-4000-8000-000000000001", name: "Priya" };
const ALL = { canSearch: true, canManageLists: true, canSendOutreach: true };
const labels = (s: { label: string }[]) => s.map((x) => x.label);

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

describe("AskAgentAboutCandidate", () => {
  it("puts the candidate id in every prompt", () => {
    expect(candidateQuestionPrompt(CANDIDATE, " Is she senior enough? ")).toBe(
      `About Priya (candidate ${CANDIDATE.id}): Is she senior enough?`,
    );
    for (const { prompt } of candidateSuggestions(CANDIDATE, ALL)) expect(prompt).toContain(CANDIDATE.id);
    expect(candidateSuggestions(CANDIDATE, ALL)[1].prompt).toBe(similarCandidatesPrompt(CANDIDATE.id));
  });

  it("hides the chips whose tools the viewer's permissions don't allow", () => {
    expect(
      labels(candidateSuggestions(CANDIDATE, { canSearch: false, canManageLists: false, canSendOutreach: false })),
    ).toEqual(["Which jobs fit them?"]);
    expect(labels(candidateSuggestions(CANDIDATE, ALL))).toEqual([
      "Which jobs fit them?",
      "Find similar candidates",
      "Add to a talent list",
      "Draft outreach",
    ]);
  });

  it("links the chips to the company agent and sends a typed question", () => {
    render(<AskAgentAboutCandidate candidate={CANDIDATE} {...ALL} />);

    expect(screen.getByRole("link", { name: "Draft outreach" })).toHaveAttribute(
      "href",
      agentPromptHref(candidateSuggestions(CANDIDATE, ALL)[3].prompt, COMPANY_AGENT_PATH),
    );

    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Any red flags?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(push).toHaveBeenCalledWith(
      agentPromptHref(candidateQuestionPrompt(CANDIDATE, "Any red flags?"), COMPANY_AGENT_PATH),
    );
  });
});
