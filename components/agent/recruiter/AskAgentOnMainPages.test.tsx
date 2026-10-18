import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { agentPromptHref, COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import {
  applicantsSuggestions,
  AskAgentAboutApplicants,
  AskAgentAboutBilling,
  AskAgentAboutJobPosts,
  AskAgentAboutOutreachList,
  AskAgentAboutProfiles,
  AskAgentAboutSettings,
  jobPostsSuggestions,
  outreachSuggestions,
  profilesSuggestions,
  settingsSuggestions,
} from "./AskAgentOnMainPages";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

const labels = (s: { label: string }[]) => s.map((x) => x.label);

describe("main page agent helpers", () => {
  it("hide the suggestions the viewer's permissions don't allow", () => {
    expect(
      labels(jobPostsSuggestions({ canCreate: false, canViewApplicants: false, canPublish: false, canMatch: false })),
    ).toEqual([]);
    expect(
      labels(jobPostsSuggestions({ canCreate: true, canViewApplicants: true, canPublish: true, canMatch: true })),
    ).toEqual(["Draft a job post", "Which jobs need attention?", "Find candidates for a job", "Close stale jobs"]);

    expect(labels(applicantsSuggestions({ canView: true, canScreen: false, canMove: false }))).toEqual([
      "Who should I review first?",
      "Where is each job stuck?",
    ]);
    expect(labels(applicantsSuggestions({ canView: true, canScreen: true, canMove: true }))).toContain(
      "Move applicants",
    );

    expect(labels(profilesSuggestions({ canSearch: true, canMatch: false, canManageLists: false }))).toEqual([
      "Find candidates",
      "Compare candidates",
    ]);

    expect(
      labels(settingsSuggestions({ canEditStages: false, canEditTemplates: false, canEditCareers: false, canViewTeam: true })),
    ).toEqual(["Who's on my team"]);
    expect(
      labels(settingsSuggestions({ canEditStages: true, canEditTemplates: true, canEditCareers: true, canViewTeam: false })),
    ).toEqual(["Add a pipeline stage", "Write an email template", "Review my templates", "Improve my careers page"]);
  });

  it("offer outreach chips the outreach tools back, matching only with matching.run", () => {
    expect(labels(outreachSuggestions({ canMatch: false }))).toEqual([
      "Find candidates and draft outreach",
      "Who hasn't replied?",
      "How is my outreach doing?",
    ]);
    expect(outreachSuggestions({ canMatch: true })[0].prompt).toMatch(/best-matching candidates for one of my active job posts/);
    expect(outreachSuggestions({ canMatch: false })[0].prompt).toMatch(/talent pool/);
  });

  it("link every suggestion to the company agent", () => {
    render(
      <>
        <AskAgentAboutJobPosts canCreate canViewApplicants canPublish canMatch />
        <AskAgentAboutApplicants canView canScreen canMove />
        <AskAgentAboutProfiles canSearch canMatch canManageLists />
        <AskAgentAboutOutreachList canMatch />
        <AskAgentAboutBilling />
        <AskAgentAboutSettings canEditStages canEditTemplates canEditCareers canViewTeam />
      </>,
    );
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) expect(link.getAttribute("href")).toMatch(/^\/company\/agent\?prompt=/);
  });

  it("opens the company agent with the typed question", () => {
    render(<AskAgentAboutBilling />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), { target: { value: "Credits left?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(
      agentPromptHref("About my plan and usage: Credits left?", COMPANY_AGENT_PATH),
    );
  });
});
