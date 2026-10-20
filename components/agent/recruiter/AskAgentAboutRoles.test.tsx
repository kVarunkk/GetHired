import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import {
  agentPromptHref,
  COMPANY_AGENT_PATH,
} from "@/helpers/agent/prompt-draft";
import AskAgentAboutRoles, {
  AskAgentToCreateRole,
  newRolePrompt,
  roleQuestionPrompt,
  roleSuggestions,
} from "./AskAgentAboutRoles";
import {
  AskAgentAboutAudit,
  AskAgentAboutHiringTeams,
  AskAgentAboutTeam,
  teamSuggestions,
} from "./AskAgentAboutTeam";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const ROLE = { id: "d0000000-0000-4000-8000-000000000001", name: "Recruiter" };
let push: ReturnType<typeof vi.fn>;

beforeEach(() => {
  push = vi.fn();
  vi.mocked(useRouter).mockReturnValue({ push } as never);
});

afterEach(() => sessionStorage.clear());

describe("AskAgentAboutRoles", () => {
  it("puts the role id in every prompt about one role", () => {
    expect(roleQuestionPrompt(ROLE, " Can it publish jobs? ")).toBe(
      'About my role "Recruiter" (role d0000000-0000-4000-8000-000000000001): Can it publish jobs?',
    );
    for (const s of roleSuggestions(ROLE, { canManage: true }))
      expect(s.prompt, s.label).toContain(`(role ${ROLE.id})`);
  });

  it("only offers changes the viewer's permissions allow", () => {
    expect(
      roleSuggestions(ROLE, { canManage: false }).map((s) => s.label),
    ).toEqual(["Explain this role"]);
    expect(
      roleSuggestions(undefined, { canManage: false }).map((s) => s.label),
    ).toEqual(["Compare roles"]);
    expect(
      roleSuggestions(undefined, { canManage: true, canAssignRoles: true }).map(
        (s) => s.label,
      ),
    ).toEqual([
      "Create a role",
      "Tighten permissions",
      "Compare roles",
      "Change someone's role",
    ]);
    expect(
      teamSuggestions({
        canInvite: false,
        canAssignRoles: false,
        canAssignJobs: false,
      }).map((s) => s.label),
    ).toEqual(["Who can do what"]);
  });

  it("opens the company agent with the question", () => {
    render(<AskAgentAboutRoles role={ROLE} canManage />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), {
      target: { value: "Add outreach" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(
      agentPromptHref(
        roleQuestionPrompt(ROLE, "Add outreach"),
        COMPANY_AGENT_PATH,
      ),
    );
  });

  it("turns a description into a new-role prompt", () => {
    render(<AskAgentToCreateRole />);
    fireEvent.change(screen.getByLabelText("Question for the assistant"), {
      target: { value: "A sourcer." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(push).toHaveBeenCalledWith(
      agentPromptHref(newRolePrompt("A sourcer."), COMPANY_AGENT_PATH),
    );
  });
});

describe("AskAgentAboutTeam", () => {
  it("offers an invite only with team.invite", () => {
    expect(
      teamSuggestions({
        canInvite: true,
        canAssignRoles: false,
        canAssignJobs: false,
      }).map((s) => s.label),
    ).toEqual(["Who can do what", "Invite a teammate"]);

    const { unmount } = render(
      <AskAgentAboutTeam
        canInvite
        canAssignRoles={false}
        canAssignJobs={false}
      />,
    );
    const invite = screen.getByRole("link", { name: /Invite a teammate/ });
    expect(invite.getAttribute("href")).toMatch(/^\/company\/agent\?prompt=/);
    unmount();

    render(
      <AskAgentAboutTeam canInvite={false} canAssignRoles canAssignJobs />,
    );
    expect(
      screen.queryByRole("link", { name: /Invite a teammate/ }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /Change someone's role/ }),
    ).toBeTruthy();
  });
});

describe("hiring teams and audit entry points", () => {
  it("link their suggestions to the company agent", () => {
    render(
      <>
        <AskAgentAboutHiringTeams />
        <AskAgentAboutAudit />
      </>,
    );
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/company\/agent\?prompt=/);
    }
  });
});
