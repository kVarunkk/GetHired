import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import {
  AskAgentAboutInterviewAnalysis,
  AskAgentAboutResume,
  AskAgentAboutResumeReview,
  interviewAnalysisSuggestions,
  resumeReviewSuggestions,
  resumeSuggestions,
} from "./AskAgentOnApplicantIdPages";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const RESUME = { id: "r1", name: "Backend CV", isPrimary: false, parsingFailed: false };
const REVIEW = { id: "rv1", name: "Stripe review", jobId: "j1" };
const SESSION = { interviewId: "i1", sessionId: "s2", interviewName: "Frontend", hasEarlier: true };

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

const labels = (suggestions: { label: string }[]) => suggestions.map(({ label }) => label);

describe("applicant id page agent helpers", () => {
  it("put the entity's id in every prompt and link to the applicant agent", () => {
    render(
      <>
        <AskAgentAboutResume resume={RESUME} />
        <AskAgentAboutResumeReview review={REVIEW} />
        <AskAgentAboutInterviewAnalysis session={SESSION} />
      </>,
    );
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/agent\?prompt=/);
    }
    for (const { prompt } of resumeSuggestions(RESUME)) expect(prompt).toContain("resume r1");
    for (const { prompt } of resumeReviewSuggestions(REVIEW)) expect(prompt).toContain("review rv1");
    for (const { prompt } of interviewAnalysisSuggestions(SESSION)) {
      expect(prompt).toContain("interview i1, session s2");
    }
  });

  it("only offers what the resume's state allows", () => {
    expect(labels(resumeSuggestions(RESUME))).toEqual([
      "Review it for a job",
      "Mock interview with it",
      "Make it my primary resume",
    ]);
    // startResumeReview and createInterview refuse a resume that failed to parse.
    expect(labels(resumeSuggestions({ ...RESUME, isPrimary: true, parsingFailed: true }))).toEqual([]);
  });

  it("drop the job and comparison chips when there's nothing to use", () => {
    expect(labels(resumeReviewSuggestions({ ...REVIEW, jobId: null }))).not.toContain("Similar jobs");
    expect(labels(resumeReviewSuggestions(REVIEW))).toContain("Similar jobs");
    expect(labels(interviewAnalysisSuggestions({ ...SESSION, hasEarlier: false }))).not.toContain(
      "Am I improving?",
    );
  });

  it("opens the agent with the typed question about the resume", () => {
    render(<AskAgentAboutResume resume={RESUME} />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), {
      target: { value: "Is it too long?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(
      agentPromptHref('About my resume "Backend CV" (resume r1): Is it too long?'),
    );
  });
});
