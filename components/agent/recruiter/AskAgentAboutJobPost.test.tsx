import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref as appAgentHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentAboutJobPost, { jobPostQuestionPrompt, jobPostSuggestions } from "./AskAgentAboutJobPost";
import AskRecruiterAgent from "./AskRecruiterAgent";
import { similarCandidatesPrompt } from "./FindSimilarCandidates";
import { AGENT_ROLE_UI } from "../roles";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

/** Recruiter entry points open the company agent. */
const agentPromptHref = (text: string) => appAgentHref(text, COMPANY_AGENT_PATH);

const JOB = { id: "b0000000-0000-4000-8000-000000000001", title: "Founding Backend Engineer" };
const ALL = { canMatch: true, canViewApplicants: true };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AskAgentAboutJobPost (RA-REQ-009)", () => {
  it("puts the job post's title and id in every prompt, so the agent can look it up", () => {
    expect(jobPostQuestionPrompt(JOB, "  Is the salary competitive? ")).toBe(
      'About my job post "Founding Backend Engineer" (job post b0000000-0000-4000-8000-000000000001): Is the salary competitive?',
    );
    const suggestions = jobPostSuggestions(JOB, ALL);
    expect(suggestions[0].prompt).toBe(
      'Find and rank the best candidates for "Founding Backend Engineer" (job post b0000000-0000-4000-8000-000000000001).',
    );
    for (const { prompt } of suggestions) expect(prompt).toContain(`(job post ${JOB.id})`);
  });

  it("opens the agent with the question", () => {
    render(<AskAgentAboutJobPost job={JOB} {...ALL} />);

    fireEvent.change(screen.getByLabelText("Question for the assistant"), {
      target: { value: "Who applied this week?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(agentPromptHref(jobPostQuestionPrompt(JOB, "Who applied this week?")));
  });

  it("hides the chips whose tools the viewer's permissions don't allow", () => {
    expect(jobPostSuggestions(JOB, { canMatch: false, canViewApplicants: false }).map((s) => s.label)).toEqual([
      "Improve the post",
    ]);
    expect(jobPostSuggestions(JOB, ALL).map((s) => s.label)).toEqual([
      "Find candidates",
      "Strongest applicants",
      "Improve the post",
    ]);
  });

  it("links each suggestion to the agent with its prompt", () => {
    render(<AskAgentAboutJobPost job={JOB} {...ALL} />);

    const [first] = jobPostSuggestions(JOB, ALL);
    expect(screen.getByRole("link", { name: first.label })).toHaveAttribute(
      "href",
      agentPromptHref(first.prompt),
    );
  });
});

describe("AskRecruiterAgent on the dashboard", () => {
  it("offers the recruiter starters and sends a typed question as is", () => {
    render(<AskRecruiterAgent />);

    for (const starter of AGENT_ROLE_UI.company.starters) {
      expect(screen.getByRole("link", { name: starter })).toHaveAttribute("href", agentPromptHref(starter));
    }

    fireEvent.change(screen.getByLabelText("Question for the assistant"), {
      target: { value: "  Draft a post for a designer  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(push).toHaveBeenCalledWith(agentPromptHref("Draft a post for a designer"));
  });
});

describe("similarCandidatesPrompt", () => {
  it("asks for job-related similarity only, by candidate id", () => {
    const prompt = similarCandidatesPrompt("a0000000-0000-4000-8000-000000000001");
    expect(prompt).toBe(
      "Find candidates with similar roles, skills and experience to candidate a0000000-0000-4000-8000-000000000001.",
    );
  });
});

describe("AskAgentAboutJobPost: AI interview chips (SIT-072)", () => {
  const NO = { canMatch: false, canViewApplicants: false };

  it("offers setup with interviews.manage (configureScreeningInterview) and results with interviews.view", () => {
    const labels = (p: Parameters<typeof jobPostSuggestions>[1]) => jobPostSuggestions(JOB, p).map((s) => s.label);
    expect(labels({ ...NO, canManageInterviews: true, canViewInterviews: true })).toEqual([
      "Set up an AI interview",
      "AI interview results",
      "Improve the post",
    ]);
    expect(labels({ ...NO, canViewInterviews: true })).toEqual(["AI interview results", "Improve the post"]);
    expect(labels(NO)).toEqual(["Improve the post"]);
  });

  it("puts the job post id in the interview prompts", () => {
    for (const s of jobPostSuggestions(JOB, { ...NO, canManageInterviews: true, canViewInterviews: true })) {
      expect(s.prompt).toContain(`(job post ${JOB.id})`);
    }
  });
});
