import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentAboutApplication, { applicationQuestionPrompt, applicationSuggestions } from "./AskAgentAboutApplication";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const APPLICATION = {
  id: "c0000000-0000-4000-8000-000000000001",
  candidateId: "a0000000-0000-4000-8000-000000000001",
  candidateName: "Priya",
  jobPostId: "b0000000-0000-4000-8000-000000000001",
  jobTitle: "Founding Backend Engineer",
};
const ALL = { canView: true, canMatch: true, canViewNotes: true, canMove: true, canSearch: true };
const NONE = { canView: false, canMatch: false, canViewNotes: false, canMove: false, canSearch: false };
const labels = (s: { label: string }[]) => s.map((x) => x.label);

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

describe("AskAgentAboutApplication", () => {
  it("puts the application id in the prompts, and the candidate and job ids in the fit check", () => {
    expect(applicationQuestionPrompt(APPLICATION, " Should I interview her? ")).toBe(
      `About Priya's application to "Founding Backend Engineer" (application ${APPLICATION.id}): Should I interview her?`,
    );
    const [summary, fit, notes, move, similar] = applicationSuggestions(APPLICATION, ALL);
    for (const s of [summary, notes, move]) expect(s.prompt).toContain(`(application ${APPLICATION.id})`);
    expect(fit.prompt).toContain(`candidate ${APPLICATION.candidateId}`);
    expect(fit.prompt).toContain(`job post ${APPLICATION.jobPostId}`);
    expect(similar.prompt).toBe(similarCandidatesPrompt(APPLICATION.candidateId));
  });

  it("hides the chips whose tools the viewer's permissions don't allow", () => {
    expect(applicationSuggestions(APPLICATION, NONE)).toEqual([]);
    expect(labels(applicationSuggestions(APPLICATION, { ...NONE, canView: true, canMove: true }))).toEqual([
      "Summarise this applicant",
      "Move to the next stage",
    ]);
    expect(labels(applicationSuggestions(APPLICATION, ALL))).toEqual([
      "Summarise this applicant",
      "Explain the fit",
      "Summarise the notes",
      "Move to the next stage",
      "Find similar candidates",
    ]);
  });

  it("offers no fit check without a job", () => {
    expect(labels(applicationSuggestions({ ...APPLICATION, jobPostId: null }, ALL))).not.toContain("Explain the fit");
  });

  it("links the chips to the company agent and sends a typed question", () => {
    render(<AskAgentAboutApplication application={APPLICATION} {...ALL} />);

    const [first] = applicationSuggestions(APPLICATION, ALL);
    expect(screen.getByRole("link", { name: first.label })).toHaveAttribute(
      "href",
      agentPromptHref(first.prompt, COMPANY_AGENT_PATH),
    );

    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Any red flags?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(push).toHaveBeenCalledWith(
      agentPromptHref(applicationQuestionPrompt(APPLICATION, "Any red flags?"), COMPANY_AGENT_PATH),
    );
  });
});

describe("AskAgentAboutApplication: AI interview chips (SIT-072)", () => {
  it("offers the report summary only with a report to read (getInterviewReport)", () => {
    const chips = applicationSuggestions(APPLICATION, { ...NONE, interview: "report" });
    expect(labels(chips)).toEqual(["Summarise the AI interview"]);
    expect(chips[0].prompt).toContain(`(application ${APPLICATION.id})`);
  });

  it("offers the invite only when inviting is possible (inviteToInterview)", () => {
    expect(labels(applicationSuggestions(APPLICATION, { ...NONE, interview: "invite" }))).toEqual([
      "Invite to the AI interview",
    ]);
  });

  it("offers neither without the permissions", () => {
    expect(labels(applicationSuggestions(APPLICATION, { ...NONE, interview: null }))).toEqual([]);
    expect(labels(applicationSuggestions(APPLICATION, NONE))).toEqual([]);
  });
});
