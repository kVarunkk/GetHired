"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The roles pages' entry point to the recruiter agent (RP-REQ-032). On one
// role's page its id goes in each prompt, so the agent can pass it to
// getRole / updateRole. Every role change still asks for approval.

type RoleRef = { id: string; name: string };

const roleRef = (role: RoleRef) => `my role "${role.name}" (role ${role.id})`;

export function roleQuestionPrompt(role: RoleRef | undefined, question: string) {
  return role ? `About ${roleRef(role)}: ${question.trim()}` : `About my company's roles: ${question.trim()}`;
}

/** The new-role page: the typed text describes the role to create. */
export function newRolePrompt(description: string) {
  return `Create a new role: ${description.trim()} Pick the permissions (all jobs or assigned jobs only) and show me before saving.`;
}

/**
 * `canManage` (roles.manage, and the role within the viewer's ceiling) hides
 * the prompts that change roles; `canAssignRoles` (team.assign_roles) the one
 * that changes a member's role.
 */
export function roleSuggestions(
  role: RoleRef | undefined,
  { canManage, canAssignRoles = false }: { canManage: boolean; canAssignRoles?: boolean },
): AgentSuggestion[] {
  if (role) {
    const ref = roleRef(role);
    return [
      ...(canManage
        ? [{ label: "Change this role", prompt: `Help me change ${ref}. Ask me what should change, then update it.` }]
        : []),
      { label: "Explain this role", prompt: `Explain in plain words what ${ref} can and can't do, and who has it.` },
      ...(canManage
        ? [{ label: "Make a variant", prompt: `Create a new role based on ${ref}. Ask me what should be different first.` }]
        : []),
    ];
  }
  return [
    ...(canManage
      ? [
          {
            label: "Create a role",
            prompt: "Help me create a new role. Ask me what the person will do, then pick the permissions and save it.",
          },
          {
            label: "Tighten permissions",
            prompt: "Review my roles and point out permissions that look broader than each role needs. Suggest changes.",
          },
        ]
      : []),
    { label: "Compare roles", prompt: "Compare my company's roles: what each one can and can't do, and who has it." },
    ...(canAssignRoles
      ? [{ label: "Change someone's role", prompt: "Help me change a team member's role. List my team and roles first." }]
      : []),
  ];
}

export default function AskAgentAboutRoles({
  role,
  canManage,
  canAssignRoles,
}: {
  /** The role the page shows; omit on the list page. */
  role?: RoleRef;
  canManage: boolean;
  canAssignRoles?: boolean;
}) {
  return (
    <AskAgentBox
      title={role ? "Ask the agent about this role" : "Let the agent manage your roles"}
      placeholder={
        role
          ? canManage
            ? "Let this role send outreach, up to 20 messages a month…"
            : "Can this role move applicants between stages?…"
          : "Which roles can publish job posts?…"
      }
      basePath={COMPANY_AGENT_PATH}
      suggestions={roleSuggestions(role, { canManage, canAssignRoles })}
      toPrompt={(question) => roleQuestionPrompt(role, question)}
    />
  );
}

/** The new-role page: describe the role and the agent builds it. */
export function AskAgentToCreateRole() {
  return (
    <AskAgentBox
      title="Describe the role and let the agent set it up"
      placeholder="An interviewer who can read applicants and write notes, only on jobs they're assigned to…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={[
        {
          label: "Interviewer",
          prompt: newRolePrompt(
            "An interviewer who can read applicants and write notes and ratings, only on the jobs they're assigned to.",
          ),
        },
        {
          label: "Sourcer",
          prompt: newRolePrompt("A sourcer who can search the talent pool, save candidates and send outreach."),
        },
        {
          label: "Hiring manager",
          prompt: newRolePrompt(
            "A hiring manager who can review, screen and move applicants on their assigned jobs, but can't publish jobs.",
          ),
        },
      ]}
      toPrompt={newRolePrompt}
    />
  );
}
