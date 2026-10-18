"use client";

import { COMPANY_AGENT_PATH } from "@/helpers/agent/prompt-draft";
import AskAgentBox, { type AgentSuggestion } from "../AskAgentBox";

// The Team, Hiring teams and Audit log pages' entry points to the recruiter
// agent (RP-REQ-032). Each prompt only asks for what the viewer's permissions
// give the agent tools for; role and hiring-team changes still ask first.

export function teamSuggestions({
  canInvite,
  canAssignRoles,
  canAssignJobs,
}: {
  canInvite: boolean;
  canAssignRoles: boolean;
  canAssignJobs: boolean;
}): AgentSuggestion[] {
  return [
    {
      label: "Who can do what",
      prompt:
        "Summarise my team: who's on it, their roles and what each role lets them do.",
    },
    // inviteTeamMember (team.invite) always asks before the email goes out.
    ...(canInvite
      ? [
          {
            label: "Invite a teammate",
            prompt:
              "Help me invite a teammate. Ask me for their email and which role to give them, then send the invite.",
          },
        ]
      : []),
    ...(canAssignRoles
      ? [
          {
            label: "Change someone's role",
            prompt:
              "Help me change a team member's role. List my team and roles first.",
          },
        ]
      : []),
    ...(canAssignJobs
      ? [
          {
            label: "Staff a job",
            prompt:
              "Help me add team members to a job's hiring team. List my jobs and team first.",
          },
        ]
      : []),
  ];
}

export function AskAgentAboutTeam(props: {
  canInvite: boolean;
  canAssignRoles: boolean;
  canAssignJobs: boolean;
}) {
  return (
    <AskAgentBox
      title="Ask the agent about your team"
      placeholder={
        props.canAssignRoles
          ? "Give Priya the Recruiter role…"
          : "Who on my team can publish job posts?…"
      }
      basePath={COMPANY_AGENT_PATH}
      suggestions={teamSuggestions(props)}
      toPrompt={(question) => `About my team: ${question.trim()}`}
    />
  );
}

export const HIRING_TEAM_SUGGESTIONS: AgentSuggestion[] = [
  {
    label: "Who's on each job",
    prompt: "Show me the hiring team for each of my jobs.",
  },
  {
    label: "Jobs with nobody assigned",
    prompt:
      "Which of my active jobs have nobody on the hiring team? Suggest who to add based on their roles.",
  },
  {
    label: "Assign someone",
    prompt:
      "Add a team member to a job's hiring team. Ask me who and which job.",
  },
];

export function AskAgentAboutHiringTeams() {
  return (
    <AskAgentBox
      title="Let the agent staff your jobs"
      placeholder="Add Sam to every active engineering job…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={HIRING_TEAM_SUGGESTIONS}
      toPrompt={(question) => `About my hiring teams: ${question.trim()}`}
    />
  );
}

export const AUDIT_SUGGESTIONS: AgentSuggestion[] = [
  {
    label: "This week's changes",
    prompt: "Summarise the changes in my audit log from the last 7 days.",
  },
  {
    label: "Permission changes",
    prompt:
      "Who changed roles or permissions in the last 30 days, and what exactly changed?",
  },
  {
    label: "Changes by the agent",
    prompt: "Which changes in my audit log were made with the recruiter agent?",
  },
];

export function AskAgentAboutAudit() {
  return (
    <AskAgentBox
      title="Ask the agent about the audit log"
      placeholder="Who removed Sam from the team, and when?…"
      basePath={COMPANY_AGENT_PATH}
      suggestions={AUDIT_SUGGESTIONS}
      toPrompt={(question) => `About my audit log: ${question.trim()}`}
    />
  );
}
