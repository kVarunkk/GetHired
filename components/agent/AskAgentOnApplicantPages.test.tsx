import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref } from "@/helpers/agent/prompt-draft";
import {
  AskAgentAboutInterviews,
  AskAgentAboutJobs,
  AskAgentAboutOpportunities,
  AskAgentAboutResumeReviews,
  AskAgentAboutResumes,
  AskAgentAboutSettings,
  OPPORTUNITIES_SUGGESTIONS,
} from "./AskAgentOnApplicantPages";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

describe("applicant page agent helpers", () => {
  it("link every suggestion to the applicant agent", () => {
    render(
      <>
        <AskAgentAboutJobs />
        <AskAgentAboutResumes />
        <AskAgentAboutResumeReviews />
        <AskAgentAboutInterviews />
        <AskAgentAboutOpportunities />
        <AskAgentAboutSettings />
      </>,
    );
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(15);
    for (const link of links) expect(link.getAttribute("href")).toMatch(/^\/agent\?prompt=/);
  });

  it("don't promise outreach replies on the opportunities page", () => {
    // The applicant role has no outreach tools (see PROGRESS.md, T11).
    for (const { label, prompt } of OPPORTUNITIES_SUGGESTIONS) {
      expect(`${label} ${prompt}`).not.toMatch(/reply|respond|outreach|message/i);
    }
  });

  it("opens the applicant agent with the typed question", () => {
    render(<AskAgentAboutResumes />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Which one is best?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(agentPromptHref("About my resumes: Which one is best?"));
  });
});
