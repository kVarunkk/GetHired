import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentAboutOutreach, { outreachQuestionPrompt, outreachSuggestions } from "./AskAgentAboutOutreach";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const OUTREACH = {
  id: "f0000000-0000-4000-8000-000000000001",
  subject: "Backend role at Acme",
  status: "sent" as const,
  candidateUserId: "a0000000-0000-4000-8000-000000000001",
  candidateName: "Ada Lovelace",
};
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AskAgentAboutOutreach", () => {
  it("puts the outreach id in every outreach prompt, so the agent can read it", () => {
    expect(outreachQuestionPrompt(OUTREACH, "  Why no reply? ")).toBe(
      'About my outreach "Backend role at Acme" to Ada Lovelace (outreach f0000000-0000-4000-8000-000000000001): Why no reply?',
    );
    for (const status of ["sent", "interested", "not_interested", "expired"] as const) {
      const [first, similar] = outreachSuggestions({ ...OUTREACH, status });
      expect(first.prompt, status).toContain(`(outreach ${OUTREACH.id})`);
      expect(similar.prompt).toBe(similarCandidatesPrompt(OUTREACH.candidateUserId));
    }
    expect(outreachSuggestions({ ...OUTREACH, status: "interested" })[0].label).toBe("Plan next steps");
  });

  it("opens the company agent with the question", () => {
    render(<AskAgentAboutOutreach outreach={OUTREACH} />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Why no reply?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(
      agentPromptHref(outreachQuestionPrompt(OUTREACH, "Why no reply?"), COMPANY_AGENT_PATH),
    );
  });
});
